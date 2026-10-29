/**
 * TokenEconomizer for opencode (anomalyco/opencode) 2.x, as a server plugin.
 *
 * opencode 2.x has no hook protocol -- a plugin is a module whose default export is
 * `{ id, setup(ctx) }`, and its hooks are functions on the server -- so, as the Pi extension
 * does, this plugin speaks the one the Claude Code and Codex integrations use: every event below
 * becomes one call of the shared dispatcher (`../scripts/te-hook --host opencode`, JSON in, JSON
 * out), and the answer is applied with opencode's own levers. All of the mechanism logic lives
 * in the dispatcher; this file only translates.
 *
 *   first prompt of a session   -> SessionStart       the learned manual, kept for the session
 *                                                     and added to every request's system prompt
 *                                                     (`session.hook("context")`); opencode does
 *                                                     not store that text, so a session picked up
 *                                                     again after a restart is given it again
 *   session.hook("prompt")      -> UserPromptSubmit   opens a prompt-turn
 *   tool.hook("execute.after")  -> PostToolUse        the guard; a redirect is a synthetic message
 *                                                     delivered at the next step ("steer")
 *   session.execution.succeeded / .failed / .interrupted
 *                               -> Stop               closes the turn; the dispatcher copies the
 *                                                     session out of opencode's database
 *
 * There is no SessionEnd: opencode's server outlives its sessions, so a session is folded once
 * its copy has gone quiet. A notice is a synthetic message that starts no turn, the one way a
 * server plugin can show the person a line (the model reads it too). A subagent's session
 * (`parentID`) is left alone, as subagents are on the hook hosts.
 *
 * Like the hooks on the other agents it fails open: a dispatcher that is missing, slow or broken
 * answers "no change", and an opencode without one of the levers below goes without it. It does
 * nothing under TE_SIDECALL=1 (the plugin's own side calls, on a private server) or TE_DISABLE=1
 * in the server's environment. `/te <command>` runs the `te` command line for this repository.
 */
import { spawn } from "node:child_process"
import { realpathSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

// opencode loads a plugin from a link in its plugin folder; the launchers sit beside the real file.
const HERE = dirname(realpathSync(fileURLToPath(import.meta.url)))
const SCRIPTS = join(HERE, "..", "scripts")
const HOOK_TIMEOUT_MS = 60_000
const ID = "tokeneconomizer"
const STOP_EVENTS = [
  "session.execution.succeeded",
  "session.execution.failed",
  "session.execution.interrupted",
] as const

const truthy = (v: string | undefined) => ["1", "true", "yes", "on"].includes((v ?? "").trim().toLowerCase())

/** Where the dispatcher keeps its copy of a session: under the state root `paths.state_root`
 * names, `$TOKENECONOMIZER_HOME` or `~/.tokeneconomizer`. */
function transcriptPath(sessionID: string): string {
  const root = process.env.TOKENECONOMIZER_HOME || join(homedir(), ".tokeneconomizer")
  return join(root, "hosts", "opencode", "sessions", `${sessionID}.jsonl`)
}

/** Run one of the plugin's launchers with `input` on stdin; resolve to its stdout. */
function run(script: string, args: string[], input: string, extra: Record<string, string> = {}): Promise<string> {
  return new Promise((resolve) => {
    let out = ""
    let child
    try {
      child = spawn(join(SCRIPTS, script), args, {
        env: { ...process.env, ...extra },
        stdio: ["pipe", "pipe", "ignore"],
      })
    } catch {
      resolve("")
      return
    }
    const timer = setTimeout(() => {
      child.kill("SIGKILL")
      resolve("")
    }, HOOK_TIMEOUT_MS)
    child.stdout.on("data", (d: Buffer) => (out += d.toString()))
    child.on("error", () => {
      clearTimeout(timer)
      resolve("")
    })
    child.on("close", () => {
      clearTimeout(timer)
      resolve(out)
    })
    child.stdin.on("error", () => {})
    child.stdin.end(input)
  })
}

/** One dispatcher call; `{}` (no change) on any failure. */
async function hook(payload: Record<string, unknown>): Promise<any> {
  if (truthy(process.env.TE_SIDECALL) || truthy(process.env.TE_DISABLE)) return {}
  const out = await run("te-hook", ["--host", "opencode"], JSON.stringify(payload))
  try {
    return JSON.parse(out.trim().split("\n").pop() || "{}") ?? {}
  } catch {
    return {}
  }
}

const text = (content: unknown): string =>
  typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content
          .filter((c: any) => c?.type === "text")
          .map((c: any) => c.text)
          .join("\n")
      : ""

export default {
  id: ID,
  setup: async (ctx: any) => {
    const manual = new Map<string, string>()
    const prompts = new Map<string, number>()
    const turns = new Map<string, string>()
    const cwds = new Map<string, string>()
    // Each session's verdict, asked once: null for a subagent's, which the plugin leaves alone.
    const known = new Map<string, Promise<string | null>>()
    const stop = new AbortController()

    const base = (sessionID: string) => ({
      session_id: sessionID,
      transcript_path: transcriptPath(sessionID),
      cwd: cwds.get(sessionID) ?? ctx.location?.directory ?? process.cwd(),
    })

    const say = async (sessionID: string, line: unknown) => {
      if (typeof line !== "string" || !line) return
      try {
        await ctx.session.synthetic({ sessionID, text: line, resume: false })
      } catch {}
    }

    /** SessionStart, the first time this server sees a session's prompt: "startup" for a session
     * with nothing in it yet, "resume" for one picked up again. */
    const start = (sessionID: string): Promise<string | null> => {
      let pending = known.get(sessionID)
      if (pending) return pending
      pending = (async () => {
        let info: any = {}
        try {
          info = (await ctx.session.get({ sessionID })) ?? {}
        } catch {}
        if (info.parentID) return null
        cwds.set(sessionID, info.location?.directory ?? ctx.location?.directory ?? process.cwd())
        // A new session already holds the system messages opencode writes at its start; a
        // conversation is one with a prompt in it.
        let carried = false
        try {
          const messages = (await ctx.session.context({ sessionID })) ?? []
          carried = messages.some((m: any) => m?.type === "user" || m?.type === "assistant")
        } catch {}
        const out = await hook({
          ...base(sessionID),
          hook_event_name: "SessionStart",
          source: carried ? "resume" : "startup",
        })
        manual.set(sessionID, out?.hookSpecificOutput?.additionalContext ?? "")
        await say(sessionID, out?.systemMessage)
        return sessionID
      })()
      known.set(sessionID, pending)
      return pending
    }

    const guard = async (name: string, register: () => Promise<unknown>) => {
      try {
        await register()
      } catch (e) {
        console.error(`tokeneconomizer: ${name} unavailable: ${e}`)
      }
    }

    await guard("prompt hook", () =>
      ctx.session.hook("prompt", async (e: any) => {
        if (!(await start(e.sessionID))) return
        const n = (prompts.get(e.sessionID) ?? 0) + 1
        prompts.set(e.sessionID, n)
        turns.set(e.sessionID, `${e.sessionID}:${n}`)
        const out = await hook({
          ...base(e.sessionID),
          hook_event_name: "UserPromptSubmit",
          prompt_id: turns.get(e.sessionID),
          prompt: e.prompt?.text ?? "",
        })
        // The repository map arrives on a session's first prompt; it joins the manual for the
        // rest of the session, since the manual is added to every request.
        const extra = out?.hookSpecificOutput?.additionalContext
        if (extra) {
          const kept = manual.get(e.sessionID)
          manual.set(e.sessionID, kept ? `${kept}\n\n${extra}` : extra)
        }
        await say(e.sessionID, out?.systemMessage)
      }),
    )

    await guard("context hook", () =>
      ctx.session.hook("context", (e: any) => {
        const text = manual.get(e.sessionID)
        if (text) e.system.push({ type: "text", text })
      }),
    )

    await guard("tool hook", () =>
      ctx.tool.hook("execute.after", async (e: any) => {
        if (!turns.has(e.sessionID)) return // a subagent's call, or a turn begun before this server
        const ok = e.status === "completed"
        const meta = (ok ? e.result?.metadata : e.error?.metadata) ?? {}
        const out = await hook({
          ...base(e.sessionID),
          hook_event_name: "PostToolUse",
          prompt_id: turns.get(e.sessionID),
          tool_name: e.tool,
          tool_use_id: e.id,
          tool_input: e.input ?? {},
          tool_response: {
            content: ok ? text(e.result?.content) : String(e.error?.message ?? ""),
            isError: !ok,
            exit_code: meta.exit ?? e.result?.output?.exit,
          },
        })
        const nudge = out?.hookSpecificOutput?.additionalContext
        if (nudge) {
          try {
            await ctx.session.synthetic({ sessionID: e.sessionID, text: nudge, delivery: "steer" })
          } catch {}
        }
        await say(e.sessionID, out?.systemMessage)
      }),
    )

    await guard("command", () =>
      ctx.command.transform((editor: any) =>
        editor.add({
          name: "te",
          description: "TokenEconomizer: status | microskills | config | repos (what it learned here, what it did)",
          execute: async ({ sessionID, prompt }: any) => {
            const argv = String(prompt?.text ?? "")
              .replace(/^\/te\b/, "")
              .trim()
              .split(/\s+/)
              .filter(Boolean)
            const cwd = cwds.get(sessionID) ?? ctx.location?.directory ?? process.cwd()
            // The session id lets `te status` say when this session is recorded under the
            // repository it started in rather than the one it is in now.
            const out = await run("te", ["--host", "opencode", "--cwd", cwd, ...(argv.length ? argv : ["status"])], "", {
              TE_SESSION_ID: sessionID,
            })
            await say(sessionID, out.trim() || "te: no output (is Python 3.10+ on PATH?)")
          },
        }),
      ),
    )

    void (async () => {
      try {
        for await (const ev of ctx.event.subscribe({ types: [...STOP_EVENTS], signal: stop.signal })) {
          const sessionID = ev?.data?.sessionID
          if (!sessionID || !turns.has(sessionID)) continue
          await hook({
            ...base(sessionID),
            hook_event_name: "Stop",
            prompt_id: turns.get(sessionID),
            stop_hook_active: false,
          })
        }
      } catch {}
    })()

    return () => stop.abort()
  },
}
