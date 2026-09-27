/**
 * /goal for OpenCode — a persistent objective the session keeps working on
 * until it is met, blocked, paused or out of budget.
 *
 * OpenCode runs one turn per user message. This plugin adds the loop:
 *
 *   ctx.command.transform   owns /goal: stores the objective and submits the
 *                           message the model receives
 *   ctx.event.subscribe     session.execution — the turn ended, account it,
 *                           then send the next continuation prompt while the
 *                           goal is active
 *   goal_finish tool        the only way the model can end the loop itself
 *
 * State lives in one JSON file per session under $XDG_DATA_HOME/opencode-goal,
 * so it survives compaction; it does not survive a restart on purpose (see
 * RUNTIME below).
 */

import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const COMMAND = "goal"

const DATA_HOME = process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share")
const STATE_DIR = path.join(DATA_HOME, "opencode-goal")
const LOOP_STATE_DIR = path.join(DATA_HOME, "opencode-loop")

// A goal only auto-continues under the process that started it. Reopening an
// old session after a restart finds a foreign runtime id and pauses instead,
// so autonomous work never resumes behind the user's back.
const RUNTIME = `${process.pid}-${Date.now()}`

const DEFAULT_MAX_TURNS = 1000
const STATE_TTL_MS = 30 * 24 * 60 * 60 * 1000

const USAGE = `/goal <objective>              start pursuing an objective
/goal --tokens 50k <objective> stop after roughly 50k tokens
/goal --turns 10 <objective>   stop after 10 turns
/goal                          show the current goal
/goal pause | resume | clear   control it`

// ------------------------------------------------------------------- state

const statePath = (sessionID) => path.join(STATE_DIR, `${sessionID}.json`)

// /loop and /goal both continue a session on idle. Two owners would take turns
// spending tokens on each other's behalf, so neither starts while the other is
// active; this reads the state file the loop plugin writes.
function loopIsActive(sessionID) {
  try {
    const state = JSON.parse(fs.readFileSync(path.join(LOOP_STATE_DIR, `${sessionID}.json`), "utf8"))
    return state.status === "active"
  } catch {
    return false
  }
}

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

// The default export is a plain object on purpose: importing @opencode/plugin
// would make OpenCode resolve an npm package from where this file really lives,
// and as a symlink it lives in the repo, outside the config dir. Everything the
// plugin needs — client, command, tool and event registration — is on ctx.
export default {
  id: "goal",

  async setup(ctx) {
    pruneState()

    // The last finished step of each session: v2 reports the assistant message
    // per step with the token accounting, so the turn-end handler can tell a
    // completed turn from an aborted one without a round trip to the server.
    const lastStep = new Map()

    const toast = async (message, variant = "info") => {
      try {
        await ctx.client.tui.showToast({ body: { title: COMMAND, message, variant } })
      } catch {}
    }

    const sumTokens = (t) =>
      !t ? 0 : (t.input ?? 0) + (t.output ?? 0) + (t.reasoning ?? 0) + (t.cache?.read ?? 0) + (t.cache?.write ?? 0)

    // Idempotent across the plugin's instances, which all see the same event:
    // the status check re-reads the file and the write lands in the same
    // synchronous section, so the second instance finds the goal already stopped.
    const stop = async (sessionID, state, status, reason) => {
      const current = readState(sessionID)
      if (!current || current.status !== "active") return
      writeState(sessionID, { ...state, status, reason, updatedAt: Date.now() })
      await toast(`${status}${reason ? ` — ${reason}` : ""}`, status === "complete" ? "success" : "warning")
    }

    // Every /goal subcommand still costs a turn, and that turn ends in a
    // turn-end event. Answering "what is my goal" must not be what starts the
    // next lap.
    const holdNextIdle = (sessionID, state) => {
      if (state?.status === "active") writeState(sessionID, { ...state, skipNextIdle: true })
    }

    await ctx.tool.transform((editor) => {
      editor.add({
        name: "goal_finish",
        description:
          "End the persistent session goal. Use status 'complete' when the objective is met and you can name the evidence, or 'blocked' when no defensible path remains. Has no effect when no goal is active.",
        input: {
          type: "object",
          properties: {
            status: {
              type: "string",
              enum: ["complete", "blocked"],
              description: "complete when the objective is met, blocked when it cannot be",
            },
            summary: {
              type: "string",
              description: "what was achieved and what proves it, or what is blocking and what would unblock it",
            },
          },
          required: ["status", "summary"],
          additionalProperties: false,
        },
        async execute(args, context) {
          const sessionID = context?.sessionID
          const state = readState(sessionID)
          if (!state || state.status !== "active") return { content: "No goal is active in this session; nothing to finish." }
          writeState(sessionID, { ...state, status: args.status, summary: args.summary, updatedAt: Date.now() })
          await toast(`${args.status}: ${args.summary}`, args.status === "complete" ? "success" : "warning")
          return { content: `Goal marked ${args.status}. The session will stop continuing on its own.` }
        },
      })
    })

    await ctx.command.transform((editor) => {
      editor.add({
        name: COMMAND,
        description: "keep working on one objective across turns until it is met, blocked or out of budget",
        execute: async (invocation) => {
          const sessionID = invocation.sessionID
          const state = readState(sessionID)
          const parsed = parseArguments(invocation.prompt?.text)
          // The command owns what the model receives: whatever the case decides
          // is submitted as the turn's prompt, in the delivery the user chose.
          const reply = (text) => ctx.session.prompt({ sessionID, text, delivery: invocation.delivery })

          switch (parsed.action) {
            case "help":
            case "error": {
              const head = parsed.action === "error" ? `/goal: ${parsed.message}` : "/goal usage"
              holdNextIdle(sessionID, state)
              await reply(`Show the user this usage text verbatim and do nothing else this turn:\n\n${head}\n\n${USAGE}`)
              return
            }

            case "status": {
              holdNextIdle(sessionID, state)
              await reply(ackPrompt("The user asked for the goal status.", state))
              return
            }

            case "pause": {
              if (state?.status !== "active") {
                await reply(ackPrompt("The user asked to pause the goal, but none is active.", state))
                return
              }
              const paused = writeState(sessionID, { ...state, status: "paused", reason: "paused by the user", updatedAt: Date.now() })
              await toast("paused")
              await reply(ackPrompt("The user paused the goal. Stop working on it.", paused))
              return
            }

            case "resume": {
              if (!state || state.status === "active") {
                holdNextIdle(sessionID, state)
                await reply(ackPrompt("The user asked to resume the goal.", state))
                return
              }
              if (loopIsActive(sessionID)) {
                await toast("a loop is active in this session", "warning")
                await reply(ackPrompt("The user asked to resume the goal, but a loop is active in this session. One session runs one continuation loop at a time; the loop must be paused or cleared first.", state))
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
              await reply(continuePrompt(resumed))
              return
            }

            case "clear": {
              dropState(sessionID)
              await toast("cleared")
              await reply(ackPrompt("The user cleared the goal. Stop working on it.", null))
              return
            }

            case "set": {
              if (loopIsActive(sessionID)) {
                await toast("a loop is active in this session", "warning")
                await reply(ackPrompt("The user tried to set a goal, but a loop is active in this session. One session runs one continuation loop at a time; the loop must be paused or cleared first.", state))
                return
              }
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
              await reply(startPrompt(next))
              return
            }
          }
        },
      })
    })

    const handleEvent = async (event) => {
      const data = event.data ?? {}
      if (event.type === "session.step.ended") {
        if (data.assistantMessageID) {
          lastStep.set(data.sessionID, { id: data.assistantMessageID, tokens: data.tokens })
        }
        return
      }
      if (event.type === "session.execution.failed" || event.type === "session.execution.interrupted") {
        const failed = readState(data.sessionID)
        if (failed?.status === "active") {
          await stop(data.sessionID, failed, "paused", "the turn was aborted or failed")
        }
        return
      }
      if (event.type !== "session.execution.succeeded") return

      const sessionID = data.sessionID
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

      const last = lastStep.get(sessionID)
      // The turn that just finished identifies the lap, so a second delivery
      // of the same turn-end — or the plugin's other instances seeing it too —
      // only ever continues once.
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
      // Not awaited: the continuation is queued and this handler keeps
      // consuming events while the turn runs.
      void ctx.session
        .prompt({ sessionID, text: continuePrompt(next), delivery: "queue" })
        .catch((error) => stop(sessionID, next, "paused", `could not continue: ${error?.message ?? error}`))
        .catch(() => {})
    }

    const controller = new AbortController()
    void (async () => {
      for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
        await handleEvent(event)
      }
    })().catch(() => {})

    return () => controller.abort()
  },
}
