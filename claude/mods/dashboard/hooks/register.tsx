import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionRateLimit, TurnStepResult } from 'claude-code'

import type { Agent, Cache, Context, ContextSlice, FileEdit, RunningTool, Speed, Spend, Todo, TodoStatus, ToolStat, Tokens, Turn } from '../types'
import {
  applyTodo,
  countLines,
  mergeTodos,
  parseGitStatus,
  parseShortstat,
  patchCounts,
  percentOf,
  todo,
  todoText,
  withStatus,
} from './lib'
import { drawPane, PANE, statusText, TITLE } from './view'

// ---------------------------------------------------------------------------
// The values the pane draws, held by the host for the session.

const FRESH_TOKENS: Tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, requests: 0 }
const FRESH_SPEED: Speed = { last: null, live: null, peak: null, ttft: null, history: [] }
const FRESH_CONTEXT: Context = {
  tokens: null,
  window: null,
  compactAt: null,
  slices: [],
  history: [],
  compactions: 0,
  reclaimed: 0,
}
const FRESH_CACHE: Cache = { lastHit: null, misses: 0, lastMiss: null, lastPrompt: null, lastAt: null, isLongTtl: false }
const FRESH_SPEND: Spend = { usd: null, samples: [], turnUsd: null, limits: [], limitsAt: null }
const FRESH_TURN: Turn = {
  runningSince: null,
  steps: 0,
  tools: 0,
  count: 0,
  lastMs: null,
  totalMs: 0,
  apiMs: 0,
  toolMs: 0,
  topic: null,
}

const todoList = atom({ plugin: 'dashboard', key: 'todos' } as const, [])
const tokenTotals = atom({ plugin: 'dashboard', key: 'tokens' } as const, FRESH_TOKENS)
const speedStats = atom({ plugin: 'dashboard', key: 'speed' } as const, FRESH_SPEED)
const contextStats = atom({ plugin: 'dashboard', key: 'context' } as const, FRESH_CONTEXT)
const cacheStats = atom({ plugin: 'dashboard', key: 'cache' } as const, FRESH_CACHE)
const spendStats = atom({ plugin: 'dashboard', key: 'spend' } as const, FRESH_SPEND)
const burnBuckets = atom({ plugin: 'dashboard', key: 'burn' } as const, [])
const turnStats = atom({ plugin: 'dashboard', key: 'turn' } as const, FRESH_TURN)
const toolStats = atom({ plugin: 'dashboard', key: 'tools' } as const, [])
const recentCalls = atom({ plugin: 'dashboard', key: 'recent' } as const, [])
const runningTools = atom({ plugin: 'dashboard', key: 'running' } as const, [])
const agentList = atom({ plugin: 'dashboard', key: 'agents' } as const, [])
const fileEdits = atom({ plugin: 'dashboard', key: 'files' } as const, [])
const gitState = atom({ plugin: 'dashboard', key: 'git' } as const, null)
const sessionInfo = atom({ plugin: 'dashboard', key: 'session' } as const, { name: null, effort: null, startedAt: null })
const foldedSections = atom({ plugin: 'dashboard', key: 'collapsed' } as const, [])
const alertKeys = atom({ plugin: 'dashboard', key: 'alerts' } as const, [])
const isClosed = atom({ plugin: 'dashboard', key: 'isClosed' } as const, false)

// How many values each sparkline keeps, and the recent-calls strip.
const HISTORY = 60
const RECENT = 24
const BURN_MINUTES = 30
const COST_SAMPLES = 240
// A reply this short is mostly latency; its rate would drag the figure down.
const MIN_TOKENS_FOR_RATE = 24
// The live rate is written once per this many streamed pieces, not per piece.
const LIVE_EVERY = 16
// The pane animates at this period while something runs, and redraws every
// IDLE_TICKS periods otherwise so its clocks move.
const TICK_MS = 250
const IDLE_TICKS = 120
// Edits land in bursts: git runs once a burst has been quiet this many ticks.
const GIT_QUIET_TICKS = 2
const CONTEXT_ALERT = 80
// A window warns once as it passes each of these, as Codex does.
const LIMIT_ALERTS = [95, 90, 75]
const LIMIT_NAME: Record<string, string> = { five_hour: '5-hour', seven_day: '7-day', spend_limit: 'Spend' }
const SPOKEN_KEY = 'limitAlerts'
// How long a window without a reset time keeps its warnings.
const OPEN_WINDOW_MS = 7 * 24 * 3600_000
const RESET_ALERT = 50
// Claude Code counts a cache miss when at least this many cacheable tokens,
// and more than this share of the prompt, are processed again.
const MISS_TOKENS = 2_000
const MISS_SHARE = 0.05
const SHORT_TTL_MS = 5 * 60_000

// Rough live estimate while streaming; the API's output count replaces it
// when the response ends.
const estimateTokens = (chars: number) => Math.round(chars / 3.5)

const keep = <T,>(list: readonly T[], value: T, size: number) => [...list, value].slice(-size)

// What the running-tools row says about a call.
function detailOf(e: { readonly [key: string]: unknown }): string {
  const pick = (key: string) => (typeof e[key] === 'string' ? (e[key] as string) : '')
  const base = (path: string) => path.slice(path.lastIndexOf('/') + 1)
  switch (String(e.tool)) {
    case 'Bash':
      return pick('command').split('\n')[0] ?? ''
    case 'Read':
    case 'Edit':
    case 'Write':
    case 'NotebookEdit':
      return base(pick('file_path') || pick('notebook_path'))
    case 'Grep':
    case 'Glob':
      return pick('pattern')
    case 'WebFetch':
      return pick('url').replace(/^https?:\/\//, '')
    case 'WebSearch':
      return pick('query')
    case 'Agent':
      return pick('description')
    case 'Skill':
      return pick('skill')
    default:
      return ''
  }
}

// An MCP tool by its own name, without the server's.
const shortToolName = (name: string) => (name.startsWith('mcp__') ? (name.split('__').pop() ?? name) : name)

// ---------------------------------------------------------------------------
// Module variables start over on a reload; everything drawn lives in $.state.

let cwd = ''
let ticks = 0
let isTurnRunning = false
let isStreaming = false
let toolsRunning = 0
let agentsRunning = 0
let gitDirtyAt: number | null = null
let isGitRunning = false

const isBusy = () => isTurnRunning || isStreaming || toolsRunning > 0 || agentsRunning > 0

const markGitDirty = () => {
  gitDirtyAt = ticks
}

async function refreshGit($: EngineInterface) {
  const status = await $.process.run(['git', 'status', '--porcelain=v2', '--branch'], { timeoutMs: 5000 }).catch(() => null)
  if (!status || status.exitCode !== 0) {
    await update($, gitState, () => null)
    return
  }
  const diff = await $.process.run(['git', 'diff', '--shortstat', 'HEAD'], { timeoutMs: 5000 }).catch(() => null)
  const lines = diff && diff.exitCode === 0 ? parseShortstat(diff.stdout) : { added: 0, removed: 0 }
  const checkedAt = await $.clock.now()
  await update($, gitState, () => ({ ...parseGitStatus(status.stdout), ...lines, checkedAt }))
}

async function refreshAgents($: EngineInterface) {
  const listed = await $.agent.list().catch(() => null)
  if (!listed) return
  const now = await $.clock.now()
  const next = await update($, agentList, held =>
    listed.map(info => {
      const known = held.find(agent => agent.id === info.id)
      const isRunning = info.status === 'running'
      const agent: Agent = {
        id: info.id,
        type: info.type,
        description: info.description,
        status: info.status,
        model: known?.model ?? null,
        startedAt: known?.startedAt ?? now,
        endedAt: isRunning ? null : (known?.endedAt ?? now),
        tokens: known?.tokens ?? 0,
        requests: known?.requests ?? 0,
      }
      return agent
    }),
  )
  agentsRunning = next.filter(agent => agent.status === 'running').length
}

// While the pane is out of sight, the status line carries its gist.
async function refreshStatus($: EngineInterface) {
  const pane = (await $.ui.panes().catch(() => [])).find(one => one.id === PANE)
  if (pane?.isPlaced && pane.isShown) {
    $.ui.status(undefined)
    return
  }
  const [ctx, speed, todos, spend] = await Promise.all([
    read($, contextStats),
    read($, speedStats),
    read($, todoList),
    read($, spendStats),
  ])
  $.ui.status(statusText({ ctx, speed, todos, spend }))
}

async function foldSection($: EngineInterface, id: string) {
  const next = await update($, foldedSections, list => (list.includes(id) ? list.filter(one => one !== id) : [...list, id]))
  await $.store.set('collapsed', next)
}

// Every change to the list goes through here, so finishing the last item
// says so once.
async function setTodos($: EngineInterface, change: (list: Todo[], now: number) => Todo[]) {
  const now = await $.clock.now()
  const before = await read($, todoList)
  const after = await update($, todoList, list => change(list, now))
  const isDone = (list: readonly Todo[]) => list.length > 1 && list.every(item => item.status === 'completed')
  if (isDone(after) && !isDone(before)) $.ui.toast(`✔ All ${after.length} to-dos done`)
  await refreshStatus($)
}

async function alertOnce($: EngineInterface, key: string, isOver: boolean, text: string) {
  const held = await read($, alertKeys)
  if (!isOver || held.includes(key)) return
  $.ui.toast(text, { timeoutMs: 8000 })
  await update($, alertKeys, list => [...list, key])
}

const clearAlerts = ($: EngineInterface, prefix: string) =>
  update($, alertKeys, list => list.filter(key => !key.startsWith(prefix)))

type SpokenAlert = { key: string; until: number }

const isSpokenAlert = (entry: unknown): entry is SpokenAlert =>
  typeof entry === 'object' && entry !== null && typeof (entry as SpokenAlert).key === 'string' && typeof (entry as SpokenAlert).until === 'number'

// A window is the account's, not the session's: it warns once per threshold
// for as long as it lasts, whichever session sees it pass. The store keeps
// what was said, keyed by the window's reset time, until that time passes.
async function alertLimit($: EngineInterface, limit: SessionRateLimit, now: number) {
  const crossed = LIMIT_ALERTS.find(threshold => limit.percentUsed >= threshold)
  if (crossed === undefined) return
  const held = await $.store.get(SPOKEN_KEY).catch(() => undefined)
  const spoken = (Array.isArray(held) ? held : []).filter(isSpokenAlert)
  const window = `${limit.kind}@${limit.resetsAt ?? 'open'}`
  if (spoken.some(entry => entry.key === `${window}:${crossed}`)) return
  $.ui.toast(`${LIMIT_NAME[limit.kind] ?? limit.kind} limit ${limit.percentUsed}% used`, { timeoutMs: 8000 })
  const until = limit.resetsAt ? Date.parse(limit.resetsAt) : now + OPEN_WINDOW_MS
  const passed = LIMIT_ALERTS.filter(threshold => threshold <= crossed).map(threshold => ({ key: `${window}:${threshold}`, until }))
  const kept = spoken.filter(entry => entry.until > now && !passed.some(one => one.key === entry.key))
  await $.store.set(SPOKEN_KEY, [...kept, ...passed])
}

async function measureContext($: EngineInterface) {
  const usage = await $.session.usage({ breakdown: 'summary' }).catch(() => null)
  const breakdown = usage?.context.breakdown
  if (!usage || !breakdown) return
  const slices: ContextSlice[] = breakdown.categories
    .filter(category => category.kind !== 'deferred' && category.tokens > 0)
    .map(category => ({ name: category.name, tokens: category.tokens, kind: category.kind }))
  await update($, contextStats, held => ({
    ...held,
    window: usage.context.window,
    tokens: usage.context.tokens ?? held.tokens,
    compactAt: breakdown.isAutoCompactEnabled ? (breakdown.autoCompactThreshold ?? null) : null,
    slices,
  }))
}

async function resetCounts($: EngineInterface) {
  await update($, todoList, () => [])
  await update($, tokenTotals, () => FRESH_TOKENS)
  await update($, speedStats, () => FRESH_SPEED)
  await update($, contextStats, held => ({ ...FRESH_CONTEXT, window: held.window, compactAt: held.compactAt }))
  await update($, cacheStats, () => FRESH_CACHE)
  await update($, spendStats, held => ({ ...FRESH_SPEND, limits: held.limits, limitsAt: held.limitsAt }))
  await update($, burnBuckets, () => [])
  await update($, turnStats, () => FRESH_TURN)
  await update($, toolStats, () => [])
  await update($, recentCalls, () => [])
  await update($, runningTools, () => [])
  await update($, agentList, () => [])
  await update($, fileEdits, () => [])
  await update($, alertKeys, () => [])
}

async function recordEdit($: EngineInterface, e: { readonly [key: string]: unknown }, result: unknown, at: number) {
  const record = result as {
    filePath?: string
    type?: string
    content?: string
    structuredPatch?: { lines: string[] }[]
  } | null
  const path = record?.filePath ?? (typeof e.file_path === 'string' ? e.file_path : null)
  if (!path) return
  const patch = record?.structuredPatch ?? []
  const counts =
    patch.length === 0 && record?.type === 'create'
      ? { added: countLines(record.content ?? ''), removed: 0 }
      : patchCounts(patch)
  await update($, fileEdits, list => {
    const known = list.find(file => file.path === path)
    const edit: FileEdit = {
      path,
      added: (known?.added ?? 0) + counts.added,
      removed: (known?.removed ?? 0) + counts.removed,
      edits: (known?.edits ?? 0) + 1,
      at,
    }
    return [...list.filter(file => file.path !== path), edit]
  })
}

// ---------------------------------------------------------------------------

export const register: Register = on => {
  // -------------------------------------------------------------------------
  // The session

  on('session.start', async ($, e, next) => {
    cwd = e.cwd

    await $.command.register({
      name: 'dashboard',
      description: 'Toggle the dashboard pane (tokens, tok/s, context, limits, to-dos); `reset` zeroes its counts',
      argumentHint: '[reset]',
    })

    const names = new Set((await $.tool.list()).map(tool => tool.name))
    if (!names.has('TodoWrite') && !names.has('TaskCreate')) {
      await $.tool.register({ name: TODO_TOOL, description: TODO_DESCRIPTION, inputSchema: TODO_SCHEMA })
    }

    const name = await $.session.model().catch(() => null)
    const usage = await $.session.usage().catch(() => null)
    await update($, sessionInfo, held => ({ ...held, name: name ?? held.name, startedAt: usage?.startedAt ?? held.startedAt }))
    const kept = await $.store.get('collapsed').catch(() => undefined)
    if (Array.isArray(kept)) await update($, foldedSections, () => kept.filter((id): id is string => typeof id === 'string'))
    await measureContext($)
    if (usage) {
      const at = await $.clock.now()
      await update($, spendStats, held => ({
        ...held,
        usd: usage.cost?.usd ?? held.usd,
        limits: usage.rateLimits.map(limit => ({ ...limit, resetsAt: limit.resetsAt ?? null })),
        limitsAt: usage.rateLimits.length > 0 ? at : held.limitsAt,
      }))
    }
    await update($, runningTools, () => [])
    await refreshAgents($)
    await refreshGit($)

    $.clock.every(TICK_MS, () => {
      ticks += 1
      if (isBusy() || ticks % IDLE_TICKS === 0) $.ui.invalidate('ui.render')
      if (gitDirtyAt !== null && !isGitRunning && ticks - gitDirtyAt >= GIT_QUIET_TICKS) {
        gitDirtyAt = null
        isGitRunning = true
        void refreshGit($).finally(() => {
          isGitRunning = false
        })
      }
    })

    if (e.isInteractive && !(await read($, isClosed))) void $.ui.open({ id: PANE, title: TITLE })

    return next(e)
  })

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear' || e.reason === 'resume') await resetCounts($)
    return next(e)
  })

  on('command.run', { command: 'dashboard' }, async ($, e) => {
    if (e.args.trim() === 'reset') {
      await resetCounts($)
      return { text: 'Dashboard counts reset.' }
    }
    const isOpen = (await $.ui.panes()).some(pane => pane.id === PANE)
    if (isOpen) {
      await $.ui.close({ id: PANE })
      await update($, isClosed, () => true)
      await refreshStatus($)
      return { text: 'Dashboard closed.' }
    }
    await update($, isClosed, () => false)
    const opened = await $.ui.open({ id: PANE, title: TITLE })
    await refreshStatus($)
    return { text: opened.isPlaced ? 'Dashboard opened.' : `Dashboard not placed: ${opened.reason}` }
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE && e.origin.kind === 'person') await update($, isClosed, () => true)
    const closed = await next(e)
    if (e.id === PANE) await refreshStatus($)
    return closed
  })

  // -------------------------------------------------------------------------
  // Turns and model requests

  on('turn.start', async ($, e, next) => {
    isTurnRunning = true
    const now = await $.clock.now()
    const prompt = e.text.replace(/\s+/g, ' ').trim()
    await update($, turnStats, held => ({
      ...held,
      runningSince: now,
      steps: 0,
      tools: 0,
      topic: held.topic ?? (prompt && !prompt.startsWith('<') ? prompt.slice(0, 200) : null),
    }))
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      isTurnRunning = false
      await update($, turnStats, held => ({
        ...held,
        runningSince: null,
        count: held.count + 1,
        lastMs: e.durationMs,
        totalMs: held.totalMs + e.durationMs,
      }))
      const name = await $.session.model().catch(() => null)
      if (name) await update($, sessionInfo, held => ({ ...held, name }))
      markGitDirty()
    }
    await refreshAgents($)
    await refreshStatus($)
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    const isMain = e.agentId === undefined
    const askedAt = await $.clock.now()
    const stream = next(e)
    let firstAt: number | null = null
    let stopAt: number | null = null
    let chars = 0
    let pieces = 0
    let result: TurnStepResult | undefined

    if (isMain) {
      isStreaming = true
      const effort = e.effort === undefined ? null : String(e.effort)
      await update($, sessionInfo, held => ({ ...held, name: held.name ?? e.model, effort }))
      await update($, turnStats, held => ({ ...held, steps: held.steps + 1 }))
    }

    try {
      for await (const chunk of stream) {
        yield chunk
        if (!isMain) continue
        // The rate runs from the response's first piece of any kind, so a
        // reply whose thinking streams no visible text is not counted as fast.
        if (firstAt === null) {
          const at = await $.clock.now()
          firstAt = at
          await update($, speedStats, held => ({ ...held, ttft: at - askedAt }))
        }
        if (chunk.kind === 'stop') {
          stopAt = await $.clock.now()
          continue
        }
        if (chunk.kind !== 'text' && chunk.kind !== 'thinking' && chunk.kind !== 'input') continue
        chars += chunk.kind === 'input' ? chunk.json.length : chunk.text.length
        pieces += 1
        if (pieces % LIVE_EVERY !== 0) continue
        const seconds = ((await $.clock.now()) - firstAt) / 1000
        const estimate = estimateTokens(chars)
        if (seconds > 0 && estimate >= MIN_TOKENS_FOR_RATE) {
          const live = estimate / seconds
          await update($, speedStats, held => ({ ...held, live }))
        }
      }
      result = await stream.result
    } finally {
      if (isMain) {
        isStreaming = false
        const usage = result?.usage
        let tps: number | null = null
        if (usage && firstAt !== null && stopAt !== null && stopAt > firstAt && usage.output_tokens >= MIN_TOKENS_FOR_RATE) {
          tps = usage.output_tokens / ((stopAt - firstAt) / 1000)
        }
        await update($, speedStats, held => ({
          ...held,
          live: null,
          last: tps ?? held.last,
          peak: tps === null ? held.peak : Math.max(held.peak ?? 0, tps),
          history: tps === null ? held.history : keep(held.history, tps, HISTORY),
        }))
      }
    }

    const usage = result?.usage
    if (!usage) return result
    const now = await $.clock.now()
    const prompt = usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens

    await update($, tokenTotals, held => ({
      input: held.input + usage.input_tokens,
      output: held.output + usage.output_tokens,
      cacheRead: held.cacheRead + usage.cache_read_input_tokens,
      cacheWrite: held.cacheWrite + usage.cache_creation_input_tokens,
      requests: held.requests + 1,
    }))
    const minute = Math.floor(now / 60_000)
    const fresh = usage.input_tokens + usage.output_tokens
    await update($, burnBuckets, held => {
      const last = held[held.length - 1]
      const buckets =
        last && last.minute === minute
          ? [...held.slice(0, -1), { minute, tokens: last.tokens + fresh }]
          : [...held, { minute, tokens: fresh }]
      return buckets.filter(bucket => bucket.minute > minute - BURN_MINUTES)
    })

    if (isMain) {
      const held = await read($, contextStats)
      const window = held.window ?? (await $.session.usage()).context.window
      await update($, contextStats, ctx => ({
        ...ctx,
        tokens: prompt,
        window,
        history: keep(ctx.history, percentOf(prompt, window), HISTORY),
      }))
      await update($, turnStats, turn => ({ ...turn, apiMs: turn.apiMs + ((stopAt ?? now) - askedAt) }))
      await update($, cacheStats, cache => {
        const hit = prompt > 0 ? usage.cache_read_input_tokens / prompt : null
        const grew = cache.lastPrompt === null ? prompt : Math.max(0, prompt - cache.lastPrompt)
        const rewritten = usage.cache_creation_input_tokens - grew
        const isMiss = cache.lastPrompt !== null && rewritten >= MISS_TOKENS && rewritten > prompt * MISS_SHARE
        const pause = cache.lastAt === null ? 0 : askedAt - cache.lastAt
        return {
          lastHit: hit,
          misses: cache.misses + (isMiss ? 1 : 0),
          lastMiss: isMiss ? rewritten : cache.lastMiss,
          lastPrompt: prompt,
          lastAt: now,
          isLongTtl: cache.isLongTtl || (pause > SHORT_TTL_MS && hit !== null && hit > 0.5),
        }
      })
    } else {
      const id = e.agentId
      const all = prompt + usage.output_tokens
      const agents = await read($, agentList)
      if (!agents.some(agent => agent.id === id)) await refreshAgents($)
      await update($, agentList, list =>
        list.map(agent =>
          agent.id === id
            ? { ...agent, model: e.model, tokens: agent.tokens + all, requests: agent.requests + 1 }
            : agent,
        ),
      )
    }

    return result
  })

  on('session.compact', async ($, e, next) => {
    const compacted = await next(e)
    if (e.agentId === undefined && e.trigger !== 'precompute' && compacted.skip === undefined) {
      const before = compacted.tokensBefore ?? 0
      const after = compacted.tokensAfter ?? 0
      await update($, contextStats, held => ({
        ...held,
        compactions: held.compactions + 1,
        reclaimed: held.reclaimed + Math.max(0, before - after),
      }))
    }
    return compacted
  })

  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('context')) {
      await update($, contextStats, held => ({ ...held, tokens: e.context.tokens ?? null, window: e.context.window }))
      await measureContext($)
      const percent = e.context.percent ?? 0
      if (percent < RESET_ALERT) await clearAlerts($, 'context')
      await alertOnce($, 'context', percent >= CONTEXT_ALERT, `Context ${percent}% full`)
    }
    if (e.changed.includes('cost') && e.cost) {
      const usd = e.cost.usd
      const at = await $.clock.now()
      await update($, spendStats, held => ({
        ...held,
        usd,
        turnUsd: held.usd === null ? null : usd - held.usd,
        samples: keep(held.samples, { at, usd }, COST_SAMPLES),
      }))
    }
    if (e.changed.includes('rateLimits')) {
      const at = await $.clock.now()
      await update($, spendStats, held => ({
        ...held,
        limits: e.rateLimits.map(limit => ({ ...limit, resetsAt: limit.resetsAt ?? null })),
        limitsAt: at,
      }))
      for (const limit of e.rateLimits) await alertLimit($, limit, at)
    }
    await refreshStatus($)
    return next(e)
  })

  // -------------------------------------------------------------------------
  // Tool calls: what runs now, counts and time per tool, files edited

  on('tool.call', async ($, e, next) => {
    const startedAt = await $.clock.now()
    const isMain = e.agentId === undefined
    const call: RunningTool = {
      id: e.tool_use_id,
      name: shortToolName(String(e.tool)),
      detail: detailOf(e),
      since: startedAt,
      agentId: e.agentId ?? null,
    }
    toolsRunning += 1
    await update($, runningTools, list => [...list, call])
    if (isMain) await update($, turnStats, held => ({ ...held, tools: held.tools + 1 }))

    let ran: Awaited<ReturnType<typeof next>> | undefined
    try {
      ran = await next(e)
      return ran
    } finally {
      toolsRunning = Math.max(0, toolsRunning - 1)
      const ms = (await $.clock.now()) - startedAt
      const failed = !ran || ran.deny !== undefined || ran.isError === true
      await update($, runningTools, list => list.filter(one => one.id !== call.id))
      await update($, toolStats, list => {
        const known = list.find(stat => stat.name === call.name)
        const stat: ToolStat = {
          name: call.name,
          count: (known?.count ?? 0) + 1,
          errors: (known?.errors ?? 0) + (failed ? 1 : 0),
          ms: (known?.ms ?? 0) + ms,
        }
        return known ? list.map(one => (one.name === call.name ? stat : one)) : [...list, stat]
      })
      await update($, recentCalls, list => keep(list, !failed, RECENT))
      if (isMain) await update($, turnStats, held => ({ ...held, toolMs: held.toolMs + ms }))
      if (!failed && ran) {
        if (e.tool === 'Edit' || e.tool === 'Write') await recordEdit($, e, ran.result, startedAt)
        if (e.tool === 'Agent') await refreshAgents($)
      }
      if (e.tool === 'Bash' || e.tool === 'Edit' || e.tool === 'Write') markGitDirty()
    }
  })

  // -------------------------------------------------------------------------
  // To-dos: the built-in TodoWrite and Task tools when the session has them,
  // this mod's own tool when it has neither

  on('tool.call', { tool: 'TodoWrite' }, async ($, e, next) => {
    const ran = await next(e)
    if (e.agentId === undefined && ran.deny === undefined && ran.isError !== true) {
      const reported = e.todos.map((item, i) => ({ id: String(i + 1), text: item.content, status: item.status }))
      await setTodos($, (list, now) => mergeTodos(list, reported, now))
    }
    return ran
  })

  on('tool.call', { tool: 'TaskCreate' }, async ($, e, next) => {
    const ran = await next(e)
    if (e.agentId === undefined && ran.deny === undefined && ran.isError !== true) {
      const { task } = ran.result
      await setTodos($, list => [...list, todo(task.id, task.subject, 'pending')])
    }
    return ran
  })

  on('tool.call', { tool: 'TaskUpdate' }, async ($, e, next) => {
    const ran = await next(e)
    if (e.agentId === undefined && ran.deny === undefined && ran.isError !== true && ran.result.success) {
      const { status, subject, taskId } = e
      await setTodos($, (list, now) =>
        status === 'deleted'
          ? list.filter(item => item.id !== taskId)
          : list.map(item => {
              if (item.id !== taskId) return item
              const renamed = { ...item, text: subject ?? item.text }
              return status ? withStatus(renamed, status, now) : renamed
            }),
      )
    }
    return ran
  })

  on('tool.call', { tool: 'TaskList' }, async ($, e, next) => {
    const ran = await next(e)
    if (e.agentId === undefined && ran.deny === undefined && ran.isError !== true) {
      const reported = ran.result.tasks.map(task => ({ id: task.id, text: task.subject, status: task.status as TodoStatus }))
      await setTodos($, (list, now) => mergeTodos(list, reported, now))
    }
    return ran
  })

  on('tool.call', { tool: 'mcp__dashboard__todo' }, async ($, e) => {
    let answer = ''
    await setTodos($, (list, now) => {
      const applied = applyTodo(list, e, now)
      if (typeof applied === 'string') {
        answer = `Error: ${applied}\n\n${todoText(list)}`
        return list
      }
      answer = todoText(applied)
      return applied
    })
    return { result: answer }
  })

  // -------------------------------------------------------------------------
  // The pane

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const [now, todos, tokens, speed, ctx, cache, spend, burn, turn, tools, recent, running, agents, files, git, session, folded] =
      await Promise.all([
        $.clock.now(),
        read($, todoList),
        read($, tokenTotals),
        read($, speedStats),
        read($, contextStats),
        read($, cacheStats),
        read($, spendStats),
        read($, burnBuckets),
        read($, turnStats),
        read($, toolStats),
        read($, recentCalls),
        read($, runningTools),
        read($, agentList),
        read($, fileEdits),
        read($, gitState),
        read($, sessionInfo),
        read($, foldedSections),
      ])
    const data = {
      now,
      todos,
      tokens,
      speed,
      ctx,
      cache,
      spend,
      burn,
      turn,
      tools,
      recent,
      running,
      agents,
      files,
      git,
      session,
      folded,
      cwd,
    }
    return drawPane($.ui.resolve(e), e, data, id => void foldSection($, id))
  })
}

// ---------------------------------------------------------------------------
// The to-do tool this mod serves when the session has no built-in one

const TODO_TOOL = 'todo'

const TODO_DESCRIPTION = `Keep a to-do list the user watches live in the dashboard pane.

For any task that takes more than two or three steps, call \`set\` first with the steps in order, \`start\` each step as you begin it and \`done\` when it is finished, and \`add\` steps you discover. Keep items short (one line each) and the list truthful: never mark something done that you have not verified.

Actions: set (replace the list with \`items\`) · add (append \`text\`) · start (mark \`id\` as the one in progress) · done (complete \`id\`) · remove (drop \`id\`) · clear (empty the list) · list (show it).`

const TODO_SCHEMA = {
  type: 'object',
  properties: {
    action: { type: 'string', enum: ['set', 'add', 'start', 'done', 'remove', 'clear', 'list'] },
    items: { type: 'array', items: { type: 'string' }, description: 'Every item, in order (for set)' },
    text: { type: 'string', description: 'Item text (for add)' },
    id: { type: 'number', description: 'Item id (for start, done, remove)' },
  },
  required: ['action'],
}
