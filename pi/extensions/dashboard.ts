/**
 * Dashboard — a richer pi TUI: live tokens/s, context window usage, the
 * current topic, and a to-do list the model keeps while it works.
 *
 * It adds:
 *   - a two-line footer replacing pi's built-in one: model, thinking level,
 *     context bar, session tokens and cost, tokens/s, git branch; then the
 *     topic, to-do progress and whatever other extensions put in the status
 *     area (/loop, /goal)
 *   - a `todo` tool the model uses to plan multi-step work, rendered as a
 *     widget above the editor while items are open
 *   - /panel      toggle a side panel with the full to-do list and session stats
 *                 (also ctrl+alt+p)
 *   - /todos      toggle the to-do widget above the editor
 *   - /topic TEXT name the session; the topic line shows an active /goal first,
 *                 then the session name, then the first prompt
 *
 * To-do state lives in the `todo` tool results, so branching a session
 * restores the list that belonged to that point in history.
 */

import type { AssistantMessage, AssistantMessageEvent } from "@earendil-works/pi-ai";
import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { Text, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { Type } from "typebox";

// ---------------------------------------------------------------------------
// To-do state

type TodoStatus = "pending" | "active" | "done";

interface Todo {
	id: number;
	text: string;
	status: TodoStatus;
}

interface TodoDetails {
	action: string;
	todos: Todo[];
	nextId: number;
	error?: string;
}

const TodoParams = Type.Object({
	action: StringEnum(["set", "add", "start", "done", "remove", "clear", "list"] as const, {
		description:
			"set: replace the whole list with `items` · add: append `text` · start: mark `id` as the one in progress · done: complete `id` · remove: drop `id` · clear: empty the list · list: show it",
	}),
	items: Type.Optional(Type.Array(Type.String(), { description: "Every item, in order (for set)" })),
	text: Type.Optional(Type.String({ description: "Item text (for add)" })),
	id: Type.Optional(Type.Number({ description: "Item id (for start, done, remove)" })),
});

const TODO_GUIDANCE = `
You have a \`todo\` tool. For any task that takes more than two or three steps, call \`todo set\` first with the steps in order, call \`todo start\` on each step as you begin it and \`todo done\` when it is finished, and add steps you discover with \`todo add\`. Keep items short (one line each). The list is shown to the user live, so keep it truthful: never mark something done that you have not verified.`;

// ---------------------------------------------------------------------------
// Live stats

interface Stream {
	firstDeltaAt: number | null; // tokens/s leaves out the wait for the first token
	chars: number;
}

interface Stats {
	tps: number | null; // tokens/s of the last finished assistant message
	stream: Stream | null; // the assistant message currently streaming
	runStartedAt: number | null; // from the prompt to the agent going idle
	sessionStartedAt: number;
	toolsRunning: number;
}

interface Totals {
	input: number; // every prompt token sent, cached or not
	output: number;
	cacheRead: number;
	cost: number;
	assistantMessages: number;
	toolCalls: number;
	cacheHit: number | null; // share of the latest request's prompt served from cache
}

const fmtTokens = (n: number) => (n < 1000 ? `${n}` : n < 1_000_000 ? `${(n / 1000).toFixed(1)}k` : `${(n / 1_000_000).toFixed(2)}M`);

const fmtDuration = (ms: number) => {
	const s = Math.floor(ms / 1000);
	if (s < 60) return `${s}s`;
	const m = Math.floor(s / 60);
	if (m < 60) return `${m}m${(s % 60).toString().padStart(2, "0")}s`;
	return `${Math.floor(m / 60)}h${(m % 60).toString().padStart(2, "0")}m`;
};

// Rough live estimate while streaming; the exact figure replaces it when the
// message ends and the provider reports its output token count.
const estimateTokens = (chars: number) => Math.round(chars / 3.5);

// A reply this short is mostly latency; its rate would drag the figure down.
const MIN_TOKENS_FOR_RATE = 24;

function bar(percent: number, cells: number): string {
	const filled = Math.round((Math.min(100, Math.max(0, percent)) / 100) * cells);
	return "▰".repeat(filled) + "▱".repeat(cells - filled);
}

function contextTone(percent: number | null): "success" | "warning" | "error" | "dim" {
	if (percent === null) return "dim";
	if (percent >= 85) return "error";
	if (percent >= 65) return "warning";
	return "success";
}

// ---------------------------------------------------------------------------

export default function dashboard(pi: ExtensionAPI) {
	let todos: Todo[] = [];
	let nextId = 1;
	let widgetEnabled = true;
	let lastCtx: ExtensionContext | null = null;
	let requestRender: (() => void) | null = null;
	let panel: { hide: () => void } | null = null;

	const stats: Stats = {
		tps: null,
		stream: null,
		runStartedAt: null,
		sessionStartedAt: Date.now(),
		toolsRunning: 0,
	};

	type Topic = { text: string; source: "goal" | "name" | "prompt" };
	interface Snapshot {
		totals: Totals;
		topic: Topic | null;
	}

	// The footer re-renders on every streamed token, so the branch walk is
	// cached until the branch grows or the session is renamed.
	let snapshotKey = "";
	let snapshot: Snapshot | null = null;
	const invalidate = () => {
		snapshotKey = "";
	};

	const computeSnapshot = (ctx: ExtensionContext): Snapshot => {
		const branch = ctx.sessionManager.getBranch();
		const name = pi.getSessionName();
		const key = `${branch.length}|${name ?? ""}`;
		if (snapshot && key === snapshotKey) return snapshot;

		const totals: Totals = { input: 0, output: 0, cacheRead: 0, cost: 0, assistantMessages: 0, toolCalls: 0, cacheHit: null };
		let goal: Topic | null = null;
		let goalSeen = false;
		let firstPrompt: Topic | null = null;

		for (let i = branch.length - 1; i >= 0; i--) {
			const entry = branch[i];
			if (entry.type === "custom" && !goalSeen) {
				const custom = entry as { customType?: string; data?: { goal?: { objective?: string; status?: string } | null } };
				if (custom.customType === "pi-goal") {
					goalSeen = true;
					const g = custom.data?.goal;
					if (g?.objective && g.status === "active") goal = { text: g.objective, source: "goal" };
				}
				continue;
			}
			if (entry.type !== "message") continue;
			const msg = entry.message;
			if (msg.role === "assistant") {
				const m = msg as AssistantMessage;
				const prompt = m.usage.input + m.usage.cacheRead + m.usage.cacheWrite;
				if (totals.assistantMessages === 0 && prompt > 0) totals.cacheHit = m.usage.cacheRead / prompt;
				totals.input += prompt;
				totals.output += m.usage.output;
				totals.cacheRead += m.usage.cacheRead;
				totals.cost += m.usage.cost.total;
				totals.assistantMessages += 1;
			} else if (msg.role === "toolResult") {
				totals.toolCalls += 1;
			} else if (msg.role === "user") {
				const content = msg.content;
				const text = typeof content === "string" ? content : content.map((c) => (c.type === "text" ? c.text : "")).join(" ");
				const line = text.replace(/\s+/g, " ").trim();
				if (line) firstPrompt = { text: line, source: "prompt" };
			}
		}

		// An active /goal objective wins, then the session name, then the
		// first prompt on this branch.
		const topic = goal ?? (name ? { text: name, source: "name" as const } : firstPrompt);
		snapshot = { totals, topic };
		snapshotKey = key;
		return snapshot;
	};

	const getTotals = (ctx: ExtensionContext) => computeSnapshot(ctx).totals;
	const getTopic = (ctx: ExtensionContext) => computeSnapshot(ctx).topic;

	const liveTps = (): number | null => {
		const s = stats.stream;
		if (!s || s.firstDeltaAt === null) return stats.tps;
		const seconds = (Date.now() - s.firstDeltaAt) / 1000;
		const tokens = estimateTokens(s.chars);
		if (seconds < 0.5 || tokens < MIN_TOKENS_FOR_RATE) return stats.tps;
		return tokens / seconds;
	};

	const refresh = () => requestRender?.();

	// -----------------------------------------------------------------------
	// State from the session

	const reconstruct = (ctx: ExtensionContext) => {
		todos = [];
		nextId = 1;
		for (const entry of ctx.sessionManager.getBranch()) {
			if (entry.type !== "message") continue;
			const msg = entry.message;
			if (msg.role !== "toolResult" || msg.toolName !== "todo") continue;
			const details = msg.details as TodoDetails | undefined;
			if (details && !details.error) {
				todos = details.todos;
				nextId = details.nextId;
			}
		}
		invalidate();
		lastCtx = ctx;
		syncWidget(ctx);
	};

	// -----------------------------------------------------------------------
	// To-do rendering

	const todoLine = (t: Todo, th: Theme, width: number, active: boolean) => {
		const mark = t.status === "done" ? th.fg("success", "✓") : t.status === "active" ? th.fg("accent", "▶") : th.fg("dim", "○");
		const text = t.status === "done" ? th.fg("dim", t.text) : active ? th.bold(th.fg("text", t.text)) : th.fg("muted", t.text);
		return truncateToWidth(`  ${mark} ${text}`, width);
	};

	const todoSummary = (th: Theme) => {
		if (todos.length === 0) return null;
		const done = todos.filter((t) => t.status === "done").length;
		const active = todos.find((t) => t.status === "active");
		let text = th.fg("muted", `todo ${done}/${todos.length}`);
		if (active) text += th.fg("dim", " · ") + th.fg("accent", "▶ ") + th.fg("text", active.text);
		return text;
	};

	const syncWidget = (ctx: ExtensionContext) => {
		if (!ctx.hasUI) return;
		if (!widgetEnabled || !todos.some((t) => t.status !== "done")) {
			ctx.ui.setWidget("dashboard-todo", undefined);
			return;
		}
		ctx.ui.setWidget("dashboard-todo", (_tui, theme) => ({
			render(width: number): string[] {
				const done = todos.filter((t) => t.status === "done").length;
				const open = todos.filter((t) => t.status !== "done");
				const head =
					theme.fg("borderMuted", "─ ") +
					theme.fg("accent", "todo") +
					theme.fg("dim", ` ${done}/${todos.length}`) +
					theme.fg("borderMuted", " " + "─".repeat(Math.max(0, width - 12 - String(done).length - String(todos.length).length)));
				const lines = [truncateToWidth(head, width)];
				const shown = open.slice(0, 6);
				for (const t of shown) lines.push(todoLine(t, theme, width, t.status === "active"));
				const hidden = open.length - shown.length;
				if (hidden > 0) lines.push(truncateToWidth(theme.fg("dim", `  … ${hidden} more (/panel)`), width));
				return lines;
			},
			invalidate() {},
		}));
	};

	// -----------------------------------------------------------------------
	// Footer

	const installFooter = (ctx: ExtensionContext) => {
		if (!ctx.hasUI) return;
		ctx.ui.setFooter((tui, theme, footerData) => {
			requestRender = () => tui.requestRender();
			const unsubBranch = footerData.onBranchChange(() => tui.requestRender());
			// While a message streams, the tokens/s figure moves on its own.
			const ticker = setInterval(() => {
				if (stats.stream || stats.runStartedAt) tui.requestRender();
			}, 500);
			return {
				dispose() {
					unsubBranch();
					clearInterval(ticker);
					if (requestRender) requestRender = null;
				},
				invalidate() {},
				render(width: number): string[] {
					const th = theme;
					const c = lastCtx ?? ctx;
					const sep = th.fg("dim", " · ");
					const parts: string[] = [];

					const model = c.model;
					const modelLabel = model ? `${model.id}` : "no model";
					const thinking = c.thinkingLevel && c.thinkingLevel !== "off" ? th.fg("dim", ` ${c.thinkingLevel}`) : "";
					parts.push(th.fg("accent", "◆ ") + th.fg("text", modelLabel) + thinking);

					const usage = c.getContextUsage();
					if (usage) {
						const pct = usage.percent;
						const tone = contextTone(pct);
						const pctText = pct === null ? "—" : `${Math.round(pct)}%`;
						const used = usage.tokens === null ? "?" : fmtTokens(usage.tokens);
						parts.push(
							th.fg("muted", "ctx ") +
								th.fg(tone, bar(pct ?? 0, 8)) +
								th.fg(tone, ` ${pctText}`) +
								th.fg("dim", ` ${used}/${fmtTokens(usage.contextWindow)}`),
						);
					}

					const t = getTotals(c);
					parts.push(
						th.fg("dim", `↑${fmtTokens(t.input)} ↓${fmtTokens(t.output)}`) +
							(t.cacheHit !== null ? th.fg("dim", ` CH ${Math.round(t.cacheHit * 100)}%`) : "") +
							(t.cost > 0 ? th.fg("dim", ` $${t.cost.toFixed(3)}`) : ""),
					);

					const tps = liveTps();
					if (tps !== null) {
						const live = stats.stream !== null;
						parts.push((live ? th.fg("accent", "⚡ ") : th.fg("dim", "⚡ ")) + th.fg(live ? "text" : "muted", `${tps.toFixed(1)} tok/s`));
					}

					if (stats.runStartedAt) {
						let running = th.fg("dim", `⏱ ${fmtDuration(Date.now() - stats.runStartedAt)}`);
						if (stats.toolsRunning > 0) running += th.fg("warning", ` ⚙ ${stats.toolsRunning}`);
						parts.push(running);
					}

					const branch = footerData.getGitBranch();
					if (branch) parts.push(th.fg("dim", ` ${branch}`));

					const line1 = truncateToWidth(parts.join(sep), width);

					const parts2: string[] = [];
					const topic = getTopic(c);
					if (topic) {
						const icon = topic.source === "goal" ? th.fg("warning", "◎ ") : th.fg("accent", "▶ ");
						const room = Math.max(20, Math.floor(width * 0.45));
						parts2.push(icon + th.fg("text", truncateToWidth(topic.text, room, "…")));
					}
					const summary = todoSummary(th);
					if (summary) parts2.push(summary);
					for (const [key, text] of footerData.getExtensionStatuses()) {
						if (!text || key.startsWith("dashboard")) continue;
						parts2.push(text);
					}
					if (parts2.length === 0) parts2.push(th.fg("dim", "/topic to name this session · /panel for details"));

					const line2 = truncateToWidth(parts2.join(sep), width);
					return [line1, line2];
				},
			};
		});
	};

	// -----------------------------------------------------------------------
	// Side panel

	// Non-capturing, so typing stays in the editor while the panel is up.
	class PanelComponent {
		private th: Theme;
		private getCtx: () => ExtensionContext;
		constructor(th: Theme, getCtx: () => ExtensionContext) {
			this.th = th;
			this.getCtx = getCtx;
		}
		invalidate(): void {}
		render(width: number): string[] {
			const th = this.th;
			const c = this.getCtx();
			const inner = Math.max(10, width - 4);
			const row = (s: string) => {
				const body = truncateToWidth(s, inner, "…");
				return th.fg("border", "│ ") + body + " ".repeat(Math.max(0, inner - visibleWidth(body))) + th.fg("border", " │");
			};
			const rule = (title?: string) => {
				const body = title ? `─ ${title} ` : "";
				return truncateToWidth(th.fg("border", "├") + th.fg("accent", body) + th.fg("border", "─".repeat(Math.max(0, width - 2 - visibleWidth(body))) + "┤"), width);
			};
			const kv = (k: string, v: string) => row(th.fg("muted", k.padEnd(10)) + v);

			const lines: string[] = [];
			lines.push(truncateToWidth(th.fg("border", "╭") + th.fg("accent", " dashboard ") + th.fg("border", "─".repeat(Math.max(0, width - 13)) + "╮"), width));

			const topic = getTopic(c);
			lines.push(rule("topic"));
			lines.push(row(topic ? th.fg("text", topic.text) : th.fg("dim", "none — /topic TEXT")));
			if (topic?.source === "goal") lines.push(row(th.fg("dim", "from /goal")));

			lines.push(rule(`todo ${todos.filter((t) => t.status === "done").length}/${todos.length}`));
			if (todos.length === 0) lines.push(row(th.fg("dim", "nothing planned yet")));
			for (const t of todos) lines.push(row(todoLine(t, th, inner, t.status === "active").slice(2)));

			lines.push(rule("session"));
			const model = c.model;
			lines.push(kv("model", th.fg("text", model ? model.id : "—")));
			lines.push(kv("thinking", th.fg("text", c.thinkingLevel ?? "—")));
			const usage = c.getContextUsage();
			if (usage) {
				const tone = contextTone(usage.percent);
				lines.push(
					kv(
						"context",
						th.fg(tone, bar(usage.percent ?? 0, 12)) +
							th.fg(tone, ` ${usage.percent === null ? "—" : `${Math.round(usage.percent)}%`}`) +
							th.fg("dim", ` ${usage.tokens === null ? "?" : fmtTokens(usage.tokens)}/${fmtTokens(usage.contextWindow)}`),
					),
				);
			}
			const t = getTotals(c);
			lines.push(kv("sent", th.fg("text", fmtTokens(t.input)) + th.fg("dim", ` (${fmtTokens(t.cacheRead)} from cache)`)));
			if (t.cacheHit !== null) lines.push(kv("cache hit", th.fg("text", `${Math.round(t.cacheHit * 100)}%`) + th.fg("dim", " last request")));
			lines.push(kv("received", th.fg("text", fmtTokens(t.output))));
			lines.push(kv("cost", t.cost > 0 ? th.fg("text", `$${t.cost.toFixed(4)}`) : th.fg("dim", "not reported")));
			const tps = liveTps();
			lines.push(kv("speed", tps === null ? th.fg("dim", "—") : th.fg("text", `${tps.toFixed(1)} tok/s`) + (stats.stream ? th.fg("accent", " live") : "")));
			lines.push(kv("replies", th.fg("text", `${t.assistantMessages}`) + th.fg("dim", ` · ${t.toolCalls} tool calls`)));
			lines.push(kv("elapsed", th.fg("text", fmtDuration(Date.now() - stats.sessionStartedAt))));

			lines.push(rule());
			lines.push(row(th.fg("dim", "/panel or ctrl+alt+p hides this")));
			lines.push(truncateToWidth(th.fg("border", "╰" + "─".repeat(Math.max(0, width - 2)) + "╯"), width));
			return lines;
		}
	}

	const togglePanel = (ctx: ExtensionContext) => {
		lastCtx = ctx;
		if (panel) {
			panel.hide();
			panel = null;
			return;
		}
		if (ctx.mode !== "tui") {
			ctx.ui.notify("/panel needs the interactive TUI", "error");
			return;
		}
		void ctx.ui.custom<void>((_tui, theme) => new PanelComponent(theme, () => lastCtx ?? ctx), {
			overlay: true,
			overlayOptions: {
				anchor: "top-right",
				width: "34%",
				minWidth: 44,
				maxHeight: "80%",
				margin: { top: 1, right: 1 },
				nonCapturing: true,
				visible: (termWidth) => termWidth >= 100,
			},
			onHandle: (handle) => {
				panel = { hide: () => handle.hide() };
			},
		});
	};

	// -----------------------------------------------------------------------
	// Events

	pi.on("session_start", async (_event, ctx) => {
		stats.sessionStartedAt = Date.now();
		stats.tps = null;
		stats.stream = null;
		stats.runStartedAt = null;
		reconstruct(ctx);
		installFooter(ctx);
	});
	pi.on("session_tree", async (_event, ctx) => reconstruct(ctx));
	pi.on("session_compact", async (_event, ctx) => {
		invalidate();
		lastCtx = ctx;
		refresh();
	});
	pi.on("session_info_changed", async (_event, ctx) => {
		lastCtx = ctx;
		refresh();
	});
	pi.on("model_select", async (_event, ctx) => {
		lastCtx = ctx;
		refresh();
	});

	pi.on("before_agent_start", async (event, ctx) => {
		lastCtx = ctx;
		return { systemPrompt: `${event.systemPrompt}\n${TODO_GUIDANCE}` };
	});

	pi.on("agent_start", async (_event, ctx) => {
		lastCtx = ctx;
		stats.runStartedAt = Date.now();
		refresh();
	});
	pi.on("turn_end", async (_event, ctx) => {
		lastCtx = ctx;
		invalidate();
		refresh();
	});
	pi.on("agent_end", async (_event, ctx) => {
		lastCtx = ctx;
		stats.runStartedAt = null;
		stats.stream = null;
		stats.toolsRunning = 0;
		invalidate();
		refresh();
	});

	pi.on("message_start", async (event, ctx) => {
		lastCtx = ctx;
		if (event.message.role === "assistant") stats.stream = { firstDeltaAt: null, chars: 0 };
	});
	pi.on("message_update", async (event) => {
		const e = event.assistantMessageEvent as AssistantMessageEvent | undefined;
		if (!stats.stream || !e) return;
		if (e.type !== "text_delta" && e.type !== "thinking_delta" && e.type !== "toolcall_delta") return;
		stats.stream.firstDeltaAt ??= Date.now();
		stats.stream.chars += e.delta.length;
	});
	pi.on("message_end", async (event, ctx) => {
		lastCtx = ctx;
		if (event.message.role !== "assistant") return;
		const m = event.message as AssistantMessage;
		const s = stats.stream;
		stats.stream = null;
		if (s?.firstDeltaAt) {
			const seconds = (Date.now() - s.firstDeltaAt) / 1000;
			const output = m.usage?.output || estimateTokens(s.chars);
			if (seconds > 0 && output >= MIN_TOKENS_FOR_RATE) stats.tps = output / seconds;
		}
		invalidate();
		refresh();
	});

	pi.on("tool_execution_start", async () => {
		stats.toolsRunning += 1;
		refresh();
	});
	pi.on("tool_execution_end", async () => {
		stats.toolsRunning = Math.max(0, stats.toolsRunning - 1);
		refresh();
	});

	// -----------------------------------------------------------------------
	// The todo tool

	const result = (action: string, text: string, error?: string) => ({
		content: [{ type: "text" as const, text }],
		details: { action, todos: todos.map((t) => ({ ...t })), nextId, error } as TodoDetails,
	});

	const listText = () =>
		todos.length === 0
			? "No todo items."
			: todos.map((t) => `[${t.status === "done" ? "x" : t.status === "active" ? ">" : " "}] #${t.id} ${t.text}`).join("\n");

	pi.registerTool({
		name: "todo",
		label: "Todo",
		description:
			"Plan and track the steps of the current task. The list is shown to the user live. Actions: set (items), add (text), start (id), done (id), remove (id), clear, list.",
		parameters: TodoParams,

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			lastCtx = ctx;
			let out: ReturnType<typeof result>;
			switch (params.action) {
				case "set": {
					const items = (params.items ?? []).map((s) => s.trim()).filter(Boolean);
					if (items.length === 0) {
						out = result("set", "Error: items required for set", "items required");
						break;
					}
					todos = items.map((text) => ({ id: nextId++, text, status: "pending" as TodoStatus }));
					out = result("set", `Planned ${todos.length} items:\n${listText()}`);
					break;
				}
				case "add": {
					const text = params.text?.trim();
					if (!text) {
						out = result("add", "Error: text required for add", "text required");
						break;
					}
					const t: Todo = { id: nextId++, text, status: "pending" };
					todos.push(t);
					out = result("add", `Added #${t.id} ${t.text}`);
					break;
				}
				case "start":
				case "done":
				case "remove": {
					const t = params.id === undefined ? undefined : todos.find((x) => x.id === params.id);
					if (!t) {
						out = result(params.action, `Error: item #${params.id ?? "?"} not found`, "not found");
						break;
					}
					if (params.action === "remove") {
						todos = todos.filter((x) => x !== t);
						out = result("remove", `Removed #${t.id} ${t.text}`);
					} else if (params.action === "start") {
						for (const x of todos) if (x.status === "active") x.status = "pending";
						t.status = "active";
						out = result("start", `Started #${t.id} ${t.text}`);
					} else {
						t.status = "done";
						const next = todos.find((x) => x.status !== "done");
						out = result("done", `Completed #${t.id} ${t.text}` + (next ? `\nNext: #${next.id} ${next.text}` : "\nAll items done."));
					}
					break;
				}
				case "clear":
					todos = [];
					nextId = 1;
					out = result("clear", "Cleared the todo list.");
					break;
				case "list":
				default:
					out = result("list", listText());
			}
			syncWidget(ctx);
			refresh();
			return out;
		},

		renderCall(args, theme) {
			let text = theme.fg("toolTitle", theme.bold("todo ")) + theme.fg("muted", args.action);
			if (args.items) text += theme.fg("dim", ` (${args.items.length} items)`);
			if (args.text) text += ` ${theme.fg("dim", `"${args.text}"`)}`;
			if (args.id !== undefined) text += ` ${theme.fg("accent", `#${args.id}`)}`;
			return new Text(text, 0, 0);
		},

		renderResult(res, { expanded }, theme) {
			const details = res.details as TodoDetails | undefined;
			if (!details) {
				const first = res.content[0];
				return new Text(first?.type === "text" ? first.text : "", 0, 0);
			}
			if (details.error) return new Text(theme.fg("error", `Error: ${details.error}`), 0, 0);

			const list = details.todos;
			const done = list.filter((t) => t.status === "done").length;
			let out = theme.fg("muted", `${done}/${list.length} done`);
			const open = list.filter((t) => t.status !== "done");
			const shown = expanded ? list : open.slice(0, 5);
			for (const t of shown) {
				const mark = t.status === "done" ? theme.fg("success", "✓") : t.status === "active" ? theme.fg("accent", "▶") : theme.fg("dim", "○");
				out += `\n${mark} ${theme.fg("accent", `#${t.id}`)} ${t.status === "done" ? theme.fg("dim", t.text) : theme.fg("muted", t.text)}`;
			}
			if (!expanded && open.length > shown.length) out += `\n${theme.fg("dim", `… ${open.length - shown.length} more`)}`;
			return new Text(out, 0, 0);
		},
	});

	// -----------------------------------------------------------------------
	// Commands

	pi.registerCommand("panel", {
		description: "Toggle the dashboard side panel (todo list, context, tokens/s)",
		handler: async (_args, ctx) => togglePanel(ctx),
	});

	pi.registerShortcut("ctrl+alt+p", {
		description: "Toggle the dashboard side panel",
		handler: (ctx) => togglePanel(ctx),
	});

	pi.registerCommand("todos", {
		description: "Toggle the todo widget above the editor",
		handler: async (_args, ctx) => {
			lastCtx = ctx;
			widgetEnabled = !widgetEnabled;
			syncWidget(ctx);
			ctx.ui.notify(widgetEnabled ? "todo widget on" : "todo widget off (list still in /panel)", "info");
		},
	});

	pi.registerCommand("topic", {
		description: "Name this session; shown in the footer as the topic",
		handler: async (args, ctx) => {
			lastCtx = ctx;
			const text = (args ?? "").trim();
			if (!text) {
				const topic = getTopic(ctx);
				ctx.ui.notify(topic ? `topic: ${topic.text}` : "no topic — /topic TEXT", "info");
				return;
			}
			pi.setSessionName(text);
			refresh();
		},
	});
}
