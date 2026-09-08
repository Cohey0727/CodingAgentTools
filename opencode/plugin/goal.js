/**
 * /goal for OpenCode — a persistent objective the session keeps working on
 * until it is met, blocked, paused or out of budget.
 *
 * OpenCode runs one turn per user message. This plugin adds the loop:
 *
 *   command.execute.before  intercepts /goal, stores the objective, and
 *                           replaces the message the model receives
 *   session.idle            the turn ended — account it, then send the next
 *                           continuation prompt while the goal is active
 *   goal_finish             the only way the model can end the loop itself
 *
 * State lives in one JSON file per session under $XDG_DATA_HOME/opencode-goal,
 * so it survives compaction; it does not survive a restart on purpose (see
 * RUNTIME below).
 */

import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const COMMAND = "goal"

const STATE_DIR = path.join(
  process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share"),
  "opencode-goal",
)

// A goal only auto-continues under the process that started it. Reopening an
// old session after a restart finds a foreign runtime id and pauses instead,
// so autonomous work never resumes behind the user's back.
const RUNTIME = `${process.pid}-${Date.now()}`

const DEFAULT_MAX_TURNS = 40
const STATE_TTL_MS = 30 * 24 * 60 * 60 * 1000

const USAGE = `/goal <objective>              start pursuing an objective
/goal --tokens 50k <objective> stop after roughly 50k tokens
/goal --turns 10 <objective>   stop after 10 turns
/goal                          show the current goal
/goal pause | resume | clear   control it`

// ------------------------------------------------------------------- state

const statePath = (sessionID) => path.join(STATE_DIR, `${sessionID}.json`)

function readState(sessionID) {
  try {
    return JSON.parse(fs.readFileSync(statePath(sessionID), "utf8"))
  } catch {
    return null
  }
}

function writeState(sessionID, state) {
  fs.mkdirSync(STATE_DIR, { recursive: true })
  const file = statePath(sessionID)
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2))
  fs.renameSync(tmp, file)
  return state
}

function dropState(sessionID) {
  try {
    fs.unlinkSync(statePath(sessionID))
  } catch {}
}

// Sessions are never reused, so their goal files would pile up forever.
function pruneState() {
  try {
    const cutoff = Date.now() - STATE_TTL_MS
    for (const name of fs.readdirSync(STATE_DIR)) {
      const file = path.join(STATE_DIR, name)
      if (fs.statSync(file).mtimeMs < cutoff) fs.unlinkSync(file)
    }
  } catch {}
}

// ------------------------------------------------------------------ parsing

function parseTokenBudget(raw) {
  const match = /^(\d+(?:\.\d+)?)([km])?$/i.exec(raw ?? "")
  if (!match) return null
  const scale = { k: 1e3, m: 1e6 }[match[2]?.toLowerCase()] ?? 1
  return Math.round(Number(match[1]) * scale)
}

function parseTurns(raw) {
  const n = Number(raw)
  return Number.isInteger(n) && n > 0 ? n : null
}

/**
 * `/goal pause` is a control word; `/goal pause the rollout until Friday` is an
 * objective. Only a bare control word wins, so a real objective is never eaten.
 */
function parseArguments(raw) {
  const text = (raw ?? "").trim()
  if (!text) return { action: "status" }

  const words = text.split(/\s+/)
  if (words.length === 1) {
    const word = words[0].toLowerCase()
    if (["status", "pause", "resume", "clear", "help"].includes(word)) return { action: word }
  }

  let rest = words
  let tokenBudget = null
  let maxTurns = null
  while (rest.length) {
    const [flag, ...tail] = rest
    const [name, inline] = flag.includes("=") ? [flag.slice(0, flag.indexOf("=")), flag.slice(flag.indexOf("=") + 1)] : [flag, null]
    if (name !== "--tokens" && name !== "--turns") break
    const value = inline ?? tail[0]
    const parsed = name === "--tokens" ? parseTokenBudget(value) : parseTurns(value)
    if (parsed === null) return { action: "error", message: `not a valid ${name} value: ${value ?? "(missing)"}` }
    if (name === "--tokens") tokenBudget = parsed
    else maxTurns = parsed
    rest = inline ? tail : tail.slice(1)
  }

  const objective = rest.join(" ").trim()
  if (!objective) return { action: "error", message: "no objective given" }
  return { action: "set", objective, tokenBudget, maxTurns }
}

// ------------------------------------------------------------------ display

function formatTokens(n) {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `${Math.round(n / 1e3)}k`
  return String(n)
}

function budgetLine(state) {
  const turns = `turn ${state.turns} of ${state.maxTurns}`
  const tokens = state.tokenBudget
    ? `tokens ${formatTokens(state.tokensUsed)} of ${formatTokens(state.tokenBudget)}`
    : `tokens ${formatTokens(state.tokensUsed)} (no budget)`
  return `${turns} · ${tokens}`
}

function statusBlock(state) {
  if (!state) return "No goal is set for this session."
  return [
    `Status: ${state.status}${state.reason ? ` (${state.reason})` : ""}`,
    `Objective: ${state.objective}`,
    `Progress: ${budgetLine(state)}`,
    state.summary ? `Summary: ${state.summary}` : null,
  ]
    .filter(Boolean)
    .join("\n")
}

// ------------------------------------------------------------------ prompts

const CONTRACT = `How the loop works:
- After every turn you are automatically asked to continue. The user is not waiting to answer questions; do not stop to ask whether you should keep going.
- Work in small steps you can verify. Prefer evidence over assertion: run the project's own checks, re-read what you changed, and look at real output before you claim a result.
- Call the \`goal_finish\` tool with status "complete" only when the objective is met and you can point at the evidence that proves it.
- Call \`goal_finish\` with status "blocked" when no defensible path remains — a missing credential, an external failure, a decision only the user can make. Say exactly what would unblock it.
- Never call \`goal_finish\` just because the work is long, and never invent evidence to justify finishing.`

const startPrompt = (state) => `A persistent goal is now active for this session.

Objective:
${state.objective}

Budget: ${budgetLine(state)}

${CONTRACT}

Start now: name the first concrete step, then take it.`

const continuePrompt = (state) => `Continue working toward the session goal.

Objective:
${state.objective}

Progress: ${budgetLine(state)}

Check what the previous turn actually produced before choosing the next action — read the output, the diff or the failing test rather than assuming it worked. Then take the next step that moves the objective forward.

${CONTRACT}`

const ackPrompt = (headline, state) => `${headline}

${statusBlock(state)}

Report that back to the user in a line or two and do nothing else this turn.`

// -------------------------------------------------------------------- plugin

/**
 * `tool` arrives from the generated shim in OpenCode's plugin directory rather
 * than from an import here: OpenCode resolves a plugin's npm imports from where
 * the file really lives, and this file lives in the repo, outside the config
 * dir where OpenCode installs @opencode-ai/plugin.
 */
export const plugin = ({ tool }) => async ({ client }) => {
  pruneState()

  // The assistant message each session finished last, kept so `session.idle`
  // can tell a completed turn from an aborted or failed one, and account its
  // tokens, without another round trip to the server.
  const lastAssistant = new Map()

  const toast = async (message, variant = "info") => {
    try {
      await client.tui.showToast({ body: { title: "goal", message, variant } })
    } catch {}
  }

  const sumTokens = (t) =>
    !t ? 0 : (t.input ?? 0) + (t.output ?? 0) + (t.reasoning ?? 0) + (t.cache?.read ?? 0) + (t.cache?.write ?? 0)

  const stop = async (sessionID, state, status, reason) => {
    writeState(sessionID, { ...state, status, reason, updatedAt: Date.now() })
    await toast(`${status}${reason ? ` — ${reason}` : ""}`, status === "complete" ? "success" : "warning")
  }

  // Every /goal subcommand still costs a turn, and that turn ends in an idle
  // event. Answering "what is my goal" must not be what starts the next lap.
  const holdNextIdle = (sessionID, state) => {
    if (state?.status === "active") writeState(sessionID, { ...state, skipNextIdle: true })
  }

  return {
    tool: {
      goal_finish: tool({
        description:
          "End the persistent session goal. Use status 'complete' when the objective is met and you can name the evidence, or 'blocked' when no defensible path remains. Has no effect when no goal is active.",
        args: {
          status: tool.schema.enum(["complete", "blocked"]).describe("complete when the objective is met, blocked when it cannot be"),
          summary: tool.schema.string().describe("what was achieved and what proves it, or what is blocking and what would unblock it"),
        },
        async execute(args, ctx) {
          const state = readState(ctx.sessionID)
          if (!state || state.status !== "active") return "No goal is active in this session; nothing to finish."
          writeState(ctx.sessionID, { ...state, status: args.status, summary: args.summary, updatedAt: Date.now() })
          await toast(`${args.status}: ${args.summary}`, args.status === "complete" ? "success" : "warning")
          return `Goal marked ${args.status}. The session will stop continuing on its own.`
        },
      }),
    },

    "command.execute.before": async (input, output) => {
      if (input.command !== COMMAND) return

      const sessionID = input.sessionID
      const state = readState(sessionID)
      const parsed = parseArguments(input.arguments)
      // OpenCode reads the parts array it handed us, so it has to be mutated
      // in place — replacing output.parts is silently ignored.
      const reply = (text) => output.parts.splice(0, output.parts.length, { type: "text", text })

      switch (parsed.action) {
        case "help":
        case "error": {
          const head = parsed.action === "error" ? `/goal: ${parsed.message}` : "/goal usage"
          holdNextIdle(sessionID, state)
          reply(`Show the user this usage text verbatim and do nothing else this turn:\n\n${head}\n\n${USAGE}`)
          return
        }

        case "status": {
          holdNextIdle(sessionID, state)
          reply(ackPrompt("The user asked for the goal status.", state))
          return
        }

        case "pause": {
          if (state?.status !== "active") {
            reply(ackPrompt("The user asked to pause the goal, but none is active.", state))
            return
          }
          const paused = writeState(sessionID, { ...state, status: "paused", reason: "paused by the user", updatedAt: Date.now() })
          await toast("paused")
          reply(ackPrompt("The user paused the goal. Stop working on it.", paused))
          return
        }

        case "resume": {
          if (!state || state.status === "active") {
            holdNextIdle(sessionID, state)
            reply(ackPrompt("The user asked to resume the goal.", state))
            return
          }
          // A goal that stopped on its budget resumes with a fresh window;
          // one that was paused picks up where it left off.
          const spent = state.turns >= state.maxTurns || (state.tokenBudget && state.tokensUsed >= state.tokenBudget)
          const resumed = writeState(sessionID, {
            ...state,
            status: "active",
            reason: null,
            runtime: RUNTIME,
            skipNextIdle: false,
            turns: spent ? 1 : state.turns,
            tokensUsed: spent ? 0 : state.tokensUsed,
            updatedAt: Date.now(),
          })
          await toast("resumed")
          reply(continuePrompt(resumed))
          return
        }

        case "clear": {
          dropState(sessionID)
          await toast("cleared")
          reply(ackPrompt("The user cleared the goal. Stop working on it.", null))
          return
        }

        case "set": {
          const next = writeState(sessionID, {
            objective: parsed.objective,
            status: "active",
            reason: null,
            summary: null,
            tokenBudget: parsed.tokenBudget,
            maxTurns: parsed.maxTurns ?? DEFAULT_MAX_TURNS,
            turns: 1,
            tokensUsed: 0,
            runtime: RUNTIME,
            skipNextIdle: false,
            lastTurn: null,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          })
          await toast(`active — ${budgetLine(next)}`, "success")
          reply(startPrompt(next))
          return
        }
      }
    },

    event: async ({ event }) => {
      if (event.type === "message.updated") {
        const info = event.properties?.info
        if (info?.role === "assistant") lastAssistant.set(info.sessionID, info)
        return
      }
      if (event.type !== "session.idle") return

      const sessionID = event.properties.sessionID
      const state = readState(sessionID)
      if (!state || state.status !== "active") return

      if (state.runtime !== RUNTIME) {
        await stop(sessionID, state, "paused", "opencode restarted — /goal resume to continue")
        return
      }
      if (state.skipNextIdle) {
        writeState(sessionID, { ...state, skipNextIdle: false })
        return
      }

      const last = lastAssistant.get(sessionID)
      if (last?.error) {
        await stop(sessionID, state, "paused", "the turn was aborted or failed")
        return
      }
      // Idle can be reported more than once for the same turn; the message that
      // just finished identifies the lap so it is only ever continued once.
      if (last?.id && last.id === state.lastTurn) return

      // The turn that just ended is accounted either way; only a turn that is
      // actually about to run raises the count, so a goal stopped by its budget
      // reports the turns it really spent.
      const spent = { ...state, tokensUsed: state.tokensUsed + sumTokens(last?.tokens) }

      if (spent.turns + 1 > spent.maxTurns) {
        await stop(sessionID, spent, "budget", `turn limit reached (${spent.maxTurns})`)
        return
      }
      if (spent.tokenBudget && spent.tokensUsed >= spent.tokenBudget) {
        await stop(sessionID, spent, "budget", `token budget reached (${formatTokens(spent.tokenBudget)})`)
        return
      }

      const next = {
        ...spent,
        turns: spent.turns + 1,
        lastTurn: last?.id ?? null,
        updatedAt: Date.now(),
      }

      writeState(sessionID, next)
      try {
        await client.session.promptAsync({
          path: { id: sessionID },
          body: { parts: [{ type: "text", text: continuePrompt(next) }] },
        })
      } catch (error) {
        await stop(sessionID, next, "paused", `could not continue: ${error?.message ?? error}`)
      }
    },
  }
}
