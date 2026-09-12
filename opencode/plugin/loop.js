/**
 * /loop for OpenCode — repeat one prompt, turn after turn, until the task is
 * done, a stop condition is met, or a budget runs out.
 *
 * OpenCode runs one turn per user message. This plugin adds the repetition:
 *
 *   command.execute.before  intercepts /loop, stores the task, and replaces
 *                           the message the model receives
 *   session.idle            the turn ended — check the stop conditions, then
 *                           send the next iteration while the loop is active
 *   loop_finish             the only way the model can end the loop itself
 *
 * State lives in one JSON file per session under $XDG_DATA_HOME/opencode-loop,
 * so it survives compaction; it does not survive a restart on purpose (see
 * RUNTIME below). A /loop and a /goal both continue a session on idle, so each
 * refuses to start while the other is active in the same session.
 */

import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const COMMAND = "loop"

const DATA_HOME = process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share")
const STATE_DIR = path.join(DATA_HOME, "opencode-loop")
const GOAL_STATE_DIR = path.join(DATA_HOME, "opencode-goal")

// A loop only auto-continues under the process that started it. Reopening an
// old session after a restart finds a foreign runtime id and pauses instead,
// so autonomous work never resumes behind the user's back.
const RUNTIME = `${process.pid}-${Date.now()}`

const DEFAULT_MAX = 40
const STATE_TTL_MS = 30 * 24 * 60 * 60 * 1000

const USAGE = `/loop <task>                   repeat the task every turn until done
/loop --max 20 <task>          stop after 20 turns (default ${DEFAULT_MAX})
/loop --until "TEXT" <task>    stop when a reply contains TEXT
/loop --until-stable 2 <task>  stop when the same reply repeats
/loop --timeout 30m <task>     stop after 30 minutes
/loop --every 5m <task>        wait 5 minutes between turns
/loop 5m <task>                shorthand for --every 5m
/loop                          show the current loop
/loop pause | resume | clear   control it`

// ------------------------------------------------------------------- state

const statePath = (sessionID) => path.join(STATE_DIR, `${sessionID}.json`)

function readJSON(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"))
  } catch {
    return null
  }
}

const readState = (sessionID) => readJSON(statePath(sessionID))
const goalIsActive = (sessionID) => readJSON(path.join(GOAL_STATE_DIR, `${sessionID}.json`))?.status === "active"

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

// Sessions are never reused, so their loop files would pile up forever.
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

/**
 * A duration is one or more `<number><unit>` segments with units s, m, h and
 * d, so `30s`, `5m`, `2h30m` and `1d` all work and nothing else does — a task
 * that starts with something duration-shaped like `5x` stays part of the task.
 */
function parseDuration(raw) {
  const text = (raw ?? "").trim()
  const pattern = /(\d+(?:\.\d+)?)([smhd])/gi
  const scale = { s: 1e3, m: 6e4, h: 36e5, d: 864e5 }
  let total = 0
  let end = 0
  let match
  while ((match = pattern.exec(text))) {
    if (match.index !== end) return null
    end += match[0].length
    total += Number(match[1]) * scale[match[2].toLowerCase()]
  }
  return end === text.length && total > 0 ? Math.round(total) : null
}

function parseCount(raw, min) {
  const n = Number(raw)
  return Number.isInteger(n) && n >= min ? n : null
}

/**
 * OpenCode hands the command line through as one raw string, so a quoted
 * --until value has to survive as one token here: `"all tests pass"` must not
 * be split on the spaces inside it.
 */
function tokenize(text) {
  const tokens = []
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g
  let match
  while ((match = pattern.exec(text))) tokens.push(match[1] ?? match[2] ?? match[3])
  return tokens
}

/**
 * Flags come before the task and only a bare control word is a control word,
 * so a task that literally starts with "pause" or "status" is never eaten.
 * An unknown `--flag` ends the flags and starts the task, like the goal's.
 */
function parseArguments(raw) {
  const text = (raw ?? "").trim()
  if (!text) return { action: "status" }

  const words = tokenize(text)
  if (words.length === 1) {
    const word = words[0].toLowerCase()
    if (["status", "pause", "resume", "clear", "help"].includes(word)) return { action: word }
  }

  let rest = words
  let max = null
  let until = []
  let untilStable = null
  let timeoutMs = null
  let everyMs = null

  // A leading duration is the omitted --every: `/loop 5m <task>`.
  const leading = parseDuration(rest[0])
  if (leading !== null) {
    everyMs = leading
    rest = rest.slice(1)
  }

  while (rest.length) {
    const [flag, ...tail] = rest
    const [name, inline] = flag.includes("=")
      ? [flag.slice(0, flag.indexOf("=")), flag.slice(flag.indexOf("=") + 1)]
      : [flag, null]
    if (name !== "--max" && name !== "--until" && name !== "--until-stable" && name !== "--timeout" && name !== "--every") break

    const value = inline ?? tail[0]
    if (value === undefined) return { action: "error", message: `${name} needs a value` }
    if (name === "--max") {
      const parsed = parseCount(value, 1)
      if (parsed === null) return { action: "error", message: `not a turn count: ${value}` }
      max = parsed
    } else if (name === "--until") {
      until.push(value)
    } else if (name === "--until-stable") {
      const parsed = parseCount(value, 2)
      if (parsed === null) return { action: "error", message: `--until-stable needs 2 or more: ${value}` }
      untilStable = parsed
    } else {
      const parsed = parseDuration(value)
      if (parsed === null) return { action: "error", message: `not a duration (30s, 5m, 2h30m, 1d): ${value}` }
      if (name === "--every") everyMs = parsed
      else timeoutMs = parsed
    }
    rest = inline ? tail : tail.slice(1)
  }

  const task = rest.join(" ").trim()
  if (!task) return { action: "error", message: "no task given" }
  return { action: "set", task, max, until, untilStable, timeoutMs, everyMs }
}

// ------------------------------------------------------------------ display

function formatDuration(ms) {
  if (ms >= 36e5) {
    const hours = Math.floor(ms / 36e5)
    const minutes = Math.round((ms % 36e5) / 6e4)
    return minutes ? `${hours}h${minutes}m` : `${hours}h`
  }
  if (ms >= 6e4) return `${Math.round(ms / 6e4)}m`
  return `${Math.round(ms / 1e3)}s`
}

function budgetLine(state) {
  const parts = [`iteration ${state.iteration} of ${state.max}`]
  if (state.everyMs) parts.push(`every ${formatDuration(state.everyMs)}`)
  if (state.status === "active" && state.nextAt && state.nextAt > Date.now()) parts.push(`next in ${formatDuration(state.nextAt - Date.now())}`)
  if (state.deadline) parts.push(`${formatDuration(Math.max(0, state.deadline - Date.now()))} left`)
  if (state.until.length) parts.push(state.until.map((text) => `"${text}"`).join(" or "))
  if (state.untilStable) parts.push(`stable ${state.untilStable}`)
  return parts.join(" · ")
}

function statusBlock(state) {
  if (!state) return "No loop is set for this session."
  return [
    `Status: ${state.status}${state.reason ? ` (${state.reason})` : ""}`,
    `Task: ${state.task}`,
    `Progress: ${budgetLine(state)}`,
    state.summary ? `Summary: ${state.summary}` : null,
  ]
    .filter(Boolean)
    .join("\n")
}

// ------------------------------------------------------------------ prompts

const CONTRACT = `How the loop works:
- After every turn the loop asks you to take the task's next step. The user is not waiting to answer questions; do not stop to ask whether you should keep going.
- The task is the same every turn, but each turn is a fresh attempt: look at what the previous turn actually produced — the output, the diff, the failing test — before acting, and never assume it worked.
- Call the \`loop_finish\` tool with status "complete" once the task is done and you can point at the evidence that proves it.
- Call \`loop_finish\` with status "blocked" when no defensible path remains — a missing credential, an external failure, a decision only the user can make. Say exactly what would unblock it.
- Never call \`loop_finish\` just because the work is long, and never invent evidence to justify finishing.`

function stopLine(state) {
  const conditions = []
  if (state.until.length) conditions.push(`your reply contains ${state.until.map((text) => `"${text}"`).join(" or ")}`)
  if (state.untilStable) conditions.push(`the same reply is given ${state.untilStable} turns in a row`)
  if (!conditions.length) return ""
  return `The loop stops on its own when ${conditions.join(", or ")}.\n\n`
}

const startPrompt = (state) => `A persistent loop is now active for this session.

Task (iteration 1 of ${state.max}):
${state.task}

${stopLine(state)}${CONTRACT}

Start now: take the first concrete step of the task.`

const continuePrompt = (state) => `Continue the loop — iteration ${state.iteration} of ${state.max}.

Task:
${state.task}

${stopLine(state)}${CONTRACT}

Take the next step the task asks for.`

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
  // can tell a completed turn from an aborted or failed one without another
  // round trip to the server.
  const lastAssistant = new Map()

  const toast = async (message, variant = "info") => {
    try {
      await client.tui.showToast({ body: { title: "loop", message, variant } })
    } catch {}
  }

  // --every waits out the interval with one timer per session. Timers live in
  // the opencode process, and `busy` keeps a due timer from cutting into a turn
  // that is already running — the next idle picks the loop back up instead.
  const timers = new Map()
  const busy = new Set()

  const clearTimer = (sessionID) => {
    const timer = timers.get(sessionID)
    if (timer) clearTimeout(timer)
    timers.delete(sessionID)
  }

  const stop = async (sessionID, state, status, reason) => {
    clearTimer(sessionID)
    writeState(sessionID, { ...state, status, reason, updatedAt: Date.now() })
    await toast(`${status}${reason ? ` — ${reason}` : ""}`, status === "complete" ? "success" : "warning")
  }

  const dispatch = async (sessionID, state) => {
    const next = {
      ...state,
      iteration: state.iteration + 1,
      nextAt: state.everyMs ? Date.now() + state.everyMs : null,
      updatedAt: Date.now(),
    }
    writeState(sessionID, next)
    busy.add(sessionID)
    try {
      await client.session.promptAsync({
        path: { id: sessionID },
        body: { parts: [{ type: "text", text: continuePrompt(next) }] },
      })
    } catch (error) {
      await stop(sessionID, next, "paused", `could not continue: ${error?.message ?? error}`)
    }
  }

  const fire = async (sessionID) => {
    const state = readState(sessionID)
    if (!state || state.status !== "active" || state.runtime !== RUNTIME) return
    if (busy.has(sessionID)) return
    if (state.deadline && Date.now() >= state.deadline) {
      await stop(sessionID, state, "timeout", `time budget reached (${formatDuration(state.timeoutMs)})`)
      return
    }
    if (state.iteration >= state.max) {
      await stop(sessionID, state, "budget", `turn limit reached (${state.max})`)
      return
    }
    await dispatch(sessionID, state)
  }

  const armTimer = (sessionID, delayMs) => {
    clearTimer(sessionID)
    const timer = setTimeout(() => {
      timers.delete(sessionID)
      void fire(sessionID)
    }, Math.max(0, delayMs))
    timer.unref?.()
    timers.set(sessionID, timer)
  }

  // A control subcommand still costs a turn, and that turn ends in an idle
  // event. Answering "what is my loop" must not count as an iteration, nor
  // start the next one: the loop waits for the user instead.
  const holdNextIdle = (sessionID, state) => {
    if (state?.status === "active") writeState(sessionID, { ...state, skipNextIdle: true })
  }

  const refuse = (sessionID, state, headline) => {
    holdNextIdle(sessionID, state)
    return ackPrompt(headline, state)
  }

  // Final text of the last assistant turn, for --until and --until-stable.
  // Null when it cannot be read, so a failed fetch is never mistaken for an
  // empty reply that repeats.
  const lastReply = async (sessionID) => {
    try {
      const result = await client.session.messages({ path: { id: sessionID } })
      const messages = result?.data ?? []
      for (let i = messages.length - 1; i >= 0; i--) {
        const { info, parts } = messages[i]
        if (info?.role !== "assistant") continue
        return (parts ?? [])
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("\n")
          .trim()
      }
      return ""
    } catch {
      return null
    }
  }

  return {
    tool: {
      loop_finish: tool({
        description:
          "End the active /loop. Use status 'complete' when the task is done and you can name the evidence, or 'blocked' when no defensible path remains. Has no effect when no loop is active.",
        args: {
          status: tool.schema.enum(["complete", "blocked"]).describe("complete when the task is done, blocked when it cannot be"),
          summary: tool.schema.string().describe("what was achieved and what proves it, or what is blocking and what would unblock it"),
        },
        async execute(args, ctx) {
          const state = readState(ctx.sessionID)
          if (!state || state.status !== "active") return "No loop is active in this session; nothing to finish."
          clearTimer(ctx.sessionID)
          writeState(ctx.sessionID, { ...state, status: args.status, summary: args.summary, updatedAt: Date.now() })
          await toast(`${args.status}: ${args.summary}`, args.status === "complete" ? "success" : "warning")
          return `Loop marked ${args.status}. The session will stop repeating the task on its own.`
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
          const head = parsed.action === "error" ? `/loop: ${parsed.message}` : "/loop usage"
          holdNextIdle(sessionID, state)
          reply(`Show the user this usage text verbatim and do nothing else this turn:\n\n${head}\n\n${USAGE}`)
          return
        }

        case "status": {
          holdNextIdle(sessionID, state)
          reply(ackPrompt("The user asked for the loop status.", state))
          return
        }

        case "pause": {
          if (state?.status !== "active") {
            reply(ackPrompt("The user asked to pause the loop, but none is active.", state))
            return
          }
          const paused = writeState(sessionID, { ...state, status: "paused", reason: "paused by the user", updatedAt: Date.now() })
          clearTimer(sessionID)
          await toast("paused")
          reply(ackPrompt("The user paused the loop. Stop repeating the task.", paused))
          return
        }

        case "resume": {
          if (!state || state.status === "active") {
            holdNextIdle(sessionID, state)
            reply(ackPrompt("The user asked to resume the loop.", state))
            return
          }
          if (goalIsActive(sessionID)) {
            reply(refuse(sessionID, state, "The user asked to resume the loop, but a goal is active in this session. One session runs one continuation loop at a time; the goal must be paused or cleared first."))
            return
          }
          // A loop stopped by its budget resumes with a fresh window; one that
          // was paused picks up where it left off.
          const spent = state.iteration >= state.max || (state.deadline && Date.now() >= state.deadline)
          const resumed = writeState(sessionID, {
            ...state,
            status: "active",
            reason: null,
            runtime: RUNTIME,
            skipNextIdle: false,
            iteration: spent ? 1 : state.iteration + 1,
            deadline: state.timeoutMs ? Date.now() + state.timeoutMs : null,
            replies: spent ? [] : state.replies,
            updatedAt: Date.now(),
          })
          await toast("resumed")
          reply(continuePrompt(resumed))
          return
        }

        case "clear": {
          clearTimer(sessionID)
          dropState(sessionID)
          await toast("cleared")
          reply(ackPrompt("The user cleared the loop. Stop repeating the task.", null))
          return
        }

        case "set": {
          if (state?.status === "active") {
            reply(refuse(sessionID, state, "The user tried to start a new loop while one is already active in this session. The existing one must be paused or cleared first."))
            return
          }
          if (goalIsActive(sessionID)) {
            reply(refuse(sessionID, state, "The user tried to start a loop, but a goal is active in this session. One session runs one continuation loop at a time; the goal must be paused or cleared first."))
            return
          }
          const next = writeState(sessionID, {
            task: parsed.task,
            status: "active",
            reason: null,
            summary: null,
            iteration: 1,
            max: parsed.max ?? DEFAULT_MAX,
            until: parsed.until,
            untilStable: parsed.untilStable ?? 0,
            timeoutMs: parsed.timeoutMs,
            everyMs: parsed.everyMs,
            deadline: parsed.timeoutMs ? Date.now() + parsed.timeoutMs : null,
            nextAt: parsed.everyMs ? Date.now() + parsed.everyMs : null,
            replies: [],
            runtime: RUNTIME,
            skipNextIdle: false,
            lastTurn: null,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          })
          clearTimer(sessionID)
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
      if (event.type === "session.status") {
        const { sessionID, status } = event.properties
        if (status?.type === "idle") busy.delete(sessionID)
        else busy.add(sessionID)
        return
      }
      if (event.type !== "session.idle") return

      const sessionID = event.properties.sessionID
      busy.delete(sessionID)
      const state = readState(sessionID)
      if (!state || state.status !== "active") return

      if (state.runtime !== RUNTIME) {
        await stop(sessionID, state, "paused", "opencode restarted — /loop resume to continue")
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
      // just finished identifies the iteration so it is only ever continued once.
      if (last?.id && last.id === state.lastTurn) return

      let replies = state.replies
      if (state.until.length || state.untilStable) {
        const reply = await lastReply(sessionID)
        if (reply === null) {
          await stop(sessionID, state, "paused", "could not read the last reply")
          return
        }
        const matched = state.until.find((text) => reply.includes(text))
        if (matched !== undefined) {
          await stop(sessionID, { ...state, lastTurn: last?.id ?? null }, "condition", `reply contained "${matched}"`)
          return
        }
        if (state.untilStable && reply) {
          replies = [...state.replies, reply].slice(-state.untilStable)
          if (replies.length >= state.untilStable && replies.every((text) => text === replies[0])) {
            await stop(sessionID, { ...state, replies, lastTurn: last?.id ?? null }, "converged", `the last ${state.untilStable} replies were identical`)
            return
          }
        }
      }

      if (state.deadline && Date.now() >= state.deadline) {
        await stop(sessionID, state, "timeout", `time budget reached (${formatDuration(state.timeoutMs)})`)
        return
      }
      if (state.iteration >= state.max) {
        await stop(sessionID, state, "budget", `turn limit reached (${state.max})`)
        return
      }

      const withTurn = {
        ...state,
        replies,
        lastTurn: last?.id ?? null,
        updatedAt: Date.now(),
      }

      // --every: this turn is accounted for, but the next one is not due yet.
      // Waiting here rather than in the model is what makes the interval; a
      // manual turn that lands in the gap runs first and re-arms the timer.
      if (withTurn.everyMs && withTurn.nextAt && Date.now() < withTurn.nextAt) {
        writeState(sessionID, withTurn)
        armTimer(sessionID, withTurn.nextAt - Date.now())
        return
      }

      await dispatch(sessionID, withTurn)
    },
  }
}
