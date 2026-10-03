import type { Elements, RenderElement, RenderInput, RenderSurface } from 'claude-code'

import type {
  Agent,
  Burn,
  Cache,
  Context,
  ContextSlice,
  FileEdit,
  GitState,
  RateLimit,
  RunningTool,
  SessionInfo,
  Speed,
  Spend,
  Todo,
  Tokens,
  ToolStat,
  Turn,
} from '../types'
import {
  blocks,
  braille,
  cool,
  elapsedColor,
  fmtDuration,
  fmtPercent,
  fmtRate,
  fmtSeconds,
  fmtTokens,
  fmtUsd,
  heat,
  hex,
  MARK,
  meter,
  percentOf,
  prettyModel,
  rasterCells,
  runs,
  shortPath,
  sparkCells,
  spinnerFrame,
  stack,
  type Cell,
} from './lib'

export const PANE = 'dashboard'
export const TITLE = 'Dashboard'

type Pane = RenderInput<'Pane'>

const SECTIONS = [
  { id: 'context', title: 'CONTEXT', hotkey: '1' },
  { id: 'todo', title: 'TO-DO', hotkey: '2' },
  { id: 'speed', title: 'SPEED', hotkey: '3' },
  { id: 'tokens', title: 'TOKENS', hotkey: '4' },
  { id: 'limits', title: 'LIMITS', hotkey: '5' },
  { id: 'activity', title: 'ACTIVITY', hotkey: '6' },
  { id: 'agents', title: 'AGENTS', hotkey: '7' },
  { id: 'files', title: 'FILES', hotkey: '8' },
] as const

type SectionId = (typeof SECTIONS)[number]['id']

const C = {
  accent: '#d97757',
  green: '#4ade80',
  yellow: '#facc15',
  orange: '#fb923c',
  red: '#f87171',
  cyan: '#22d3ee',
  blue: '#60a5fa',
  violet: '#a78bfa',
}

// One color per kind of context content, in the order /context lists them.
const SLICE_COLORS = [0x60a5fa, 0xa78bfa, 0x22d3ee, 0xf472b6, 0xfacc15, 0x4ade80, 0xfb923c, 0x94a3b8]
const FREE = 0x3f3f46
const RESERVE = 0x7f1d1d

// Where the session's tokens went: cache reads, cache writes, fresh input, output.
const TOKEN_PARTS = [
  { key: 'read', fg: 0x60a5fa },
  { key: 'write', fg: 0x22d3ee },
  { key: 'new', fg: 0xa78bfa },
  { key: 'out', fg: 0x4ade80 },
] as const

const SHORT_SLICE: Record<string, string> = {
  'System prompt': 'system',
  'System tools': 'tools',
  'MCP tools': 'mcp',
  'Memory files': 'memory',
  'Custom agents': 'agents',
  Messages: 'messages',
  Skills: 'skills',
  'Slash commands': 'commands',
}

const shortSlice = (name: string) => SHORT_SLICE[name] ?? name.split(' ')[0]!.toLowerCase()

const LIMIT_LABEL: Record<string, string> = { five_hour: '5h', seven_day: '7d', spend_limit: '$' }
const LIMIT_SPAN: Record<string, number> = { five_hour: 5 * 3600_000, seven_day: 7 * 24 * 3600_000 }
// Rate limits arrive with responses; an idle session's may be out of date.
const STALE_MS = 15 * 60_000
// claude-code-status-bar marks the window once it is this close to compaction.
const NEAR_COMPACT = 20_000
const LONG_TTL_MS = 60 * 60_000
const SHORT_TTL_MS = 5 * 60_000

export type ViewData = {
  now: number
  todos: Todo[]
  tokens: Tokens
  speed: Speed
  ctx: Context
  cache: Cache
  spend: Spend
  burn: Burn
  turn: Turn
  tools: ToolStat[]
  recent: boolean[]
  running: RunningTool[]
  agents: Agent[]
  files: FileEdit[]
  git: GitState | null
  session: SessionInfo
  folded: string[]
  cwd: string
}

// ---------------------------------------------------------------------------
// Forecasts

// How far through its span a window is, 0 to 1; null without a reset time.
export function limitElapsed(limit: RateLimit, now: number): number | null {
  const span = LIMIT_SPAN[limit.kind]
  if (!span || !limit.resetsAt) return null
  const elapsed = (span - (Date.parse(limit.resetsAt) - now)) / span
  return elapsed >= 0 && elapsed <= 1 ? elapsed : null
}

// Where a window will stand when it resets if the pace so far holds; null
// until a tenth of it has passed.
export function projectLimit(limit: RateLimit, now: number): number | null {
  const elapsed = limitElapsed(limit, now)
  if (elapsed === null || elapsed < 0.1) return null
  return limit.percentUsed / elapsed
}

// When a window fills at the pace so far, if that comes before it resets.
export function limitFullIn(limit: RateLimit, now: number): number | null {
  const elapsed = limitElapsed(limit, now)
  const span = LIMIT_SPAN[limit.kind]
  if (elapsed === null || elapsed < 0.1 || !span || limit.percentUsed <= 0 || limit.percentUsed >= 100) return null
  const msPerPercent = (elapsed * span) / limit.percentUsed
  const fullIn = (100 - limit.percentUsed) * msPerPercent
  const resetIn = (1 - elapsed) * span
  return fullIn < resetIn ? fullIn : null
}

// claude-powerline's pace mark: ◆ ahead of the clock, ◇ behind it, ◈ on it.
export function paceMark(limit: RateLimit, now: number): string {
  const elapsed = limitElapsed(limit, now)
  if (elapsed === null) return ''
  const ahead = limit.percentUsed - elapsed * 100
  return ahead > 5 ? '◆' : ahead < -5 ? '◇' : '◈'
}

// Requests left before auto-compaction, from the average growth of the window
// over the last few requests; null while it is not growing.
export function requestsToCompact(history: readonly number[], compactPercent: number): number | null {
  const recent = history.slice(-10)
  if (recent.length < 3) return null
  const first = recent[0]!
  const last = recent[recent.length - 1]!
  const growth = (last - first) / (recent.length - 1)
  if (growth <= 0.05 || last >= compactPercent) return null
  return Math.ceil((compactPercent - last) / growth)
}

// Dollars per hour over the last hour of samples, or the session so far when
// it is younger; null until there are two samples a minute apart.
export function costPerHour(samples: readonly { at: number; usd: number }[], now: number): number | null {
  if (samples.length < 2) return null
  const since = samples.find(sample => sample.at >= now - 3600_000) ?? samples[0]!
  const last = samples[samples.length - 1]!
  const hours = (last.at - since.at) / 3600_000
  if (hours < 1 / 60) return null
  return (last.usd - since.usd) / hours
}

// The window as one bar: each kind of content in its color, scaled to the
// fill the last response reported, then free space, the compaction reserve
// hatched, and a tick where auto-compaction starts.
export function contextBar(
  tokens: number,
  window: number,
  slices: readonly ContextSlice[],
  compactPercent: number | null,
  width: number,
): Cell[] {
  const used = slices.filter(slice => slice.kind === 'used')
  const total = used.reduce((sum, slice) => sum + slice.tokens, 0)
  const parts =
    total > 0
      ? used.map((slice, i) => ({ value: (slice.tokens / total) * tokens, fg: SLICE_COLORS[i % SLICE_COLORS.length]! }))
      : [{ value: tokens, fg: heat(tokens / window) }]
  const row = stack(parts, width, window)
  const filled = row.filter(cell => cell.ch === '█').length
  const compactCell = compactPercent === null ? width : Math.min(width - 1, Math.floor((compactPercent / 100) * width))
  return row.map((cell, i) => {
    if (i < filled) return cell
    if (i === compactCell) return { ch: '┃', fg: MARK }
    if (i > compactCell) return { ch: '░', fg: RESERVE }
    return { ch: '─', fg: FREE }
  })
}

// The one line the status bar shows while the pane is out of sight.
export function statusText({ ctx, speed, todos, spend }: Pick<ViewData, 'ctx' | 'speed' | 'todos' | 'spend'>) {
  const parts: string[] = []
  if (ctx.tokens !== null && ctx.window) parts.push(`ctx ${Math.round(percentOf(ctx.tokens, ctx.window))}%`)
  const rate = speed.live ?? speed.last
  if (rate !== null) parts.push(`${fmtRate(rate)} tok/s`)
  if (todos.length > 0) parts.push(`☑ ${todos.filter(item => item.status === 'completed').length}/${todos.length}`)
  if (spend.usd !== null) parts.push(fmtUsd(spend.usd))
  return parts.length > 0 ? parts.join(' · ') : undefined
}

const hitColor = (hit: number) => (hit >= 0.7 ? C.green : hit >= 0.4 ? C.yellow : C.red)
// ccusage's burn colors: input and output tokens a minute.
const burnColor = (perMinute: number) => (perMinute < 2_000 ? C.green : perMinute <= 5_000 ? C.yellow : C.red)
// Gemini CLI's tool success colors.
const okColor = (rate: number) => (rate >= 0.95 ? C.green : rate >= 0.85 ? C.yellow : C.red)

// ---------------------------------------------------------------------------
// The pane

export function drawPane(
  ui: Elements[RenderSurface],
  e: Pane,
  data: ViewData,
  onFold: (id: string) => void,
): RenderElement {
  const { Box, Text, Button } = ui
  const { now, todos, tokens, speed, ctx, cache, spend, burn, turn, tools, recent, running, agents, files, git, session, folded, cwd } =
    data
  const W = Math.max(24, e.props.bodyColumns)
  const isRunning = turn.runningSince !== null
  const spin = spinnerFrame(now)

  // A row of colored cells: one Raster on the terminal, runs of Text elsewhere.
  const cells = (key: string, row: Cell[]) => {
    if (row.length === 0) return null
    if (e.surface === 'terminal' && 'Raster' in ui) {
      const { Raster } = ui
      return <Raster key={key} columns={row.length} rows={1} cells={rasterCells(row)} />
    }
    return (
      <Box>
        {runs(row).map(run => (run.fg === null ? <Text>{run.text}</Text> : <Text color={hex(run.fg)}>{run.text}</Text>))}
      </Box>
    )
  }

  const dim = (text: string) => <Text dimColor>{text}</Text>
  const label = (text: string, width = 6) => <Text dimColor>{text.padEnd(width)}</Text>
  const swatch = (fg: number, name: string, value: string) => (
    <Text>
      <Text color={hex(fg)}>■</Text>
      <Text dimColor> {name} </Text>
      {value}
    </Text>
  )

  // A section's header: a fold toggle (its hotkey works while the pane has
  // the keys), a rule filled to the width, and the figure that matters most
  // when the section is folded.
  const header = (id: SectionId, summary: string, color?: string) => {
    const section = SECTIONS.find(one => one.id === id)!
    const title = `${folded.includes(id) ? '▸' : '▾'} ${section.title}`
    const ruleWidth = Math.max(1, W - title.length - 3 - summary.length - 2)
    return (
      <Box marginTop={1}>
        <Button key={`fold-${id}`} plain hotkey={section.hotkey} label={title} onPress={() => onFold(id)} />
        <Text dimColor> {'─'.repeat(ruleWidth)} </Text>
        {color ? <Text color={color}>{summary}</Text> : <Text>{summary}</Text>}
      </Box>
    )
  }
  const isOpen = (id: SectionId) => !folded.includes(id)

  const out: (RenderElement | null)[] = []

  // -- header: model, effort, session clock; git; topic ----------------------
  out.push(
    <Box>
      <Box flexGrow={1} flexShrink={1}>
        <Text color={C.accent} bold wrap="truncate-end">
          ✻ {session.name ? prettyModel(session.name) : '—'}
          {session.effort ? <Text dimColor> · {session.effort}</Text> : null}
        </Text>
      </Box>
      {session.startedAt ? dim(`⏱ ${fmtDuration(now - session.startedAt)}`) : null}
    </Box>,
  )
  if (git) {
    const marks: RenderElement[] = []
    if (git.ahead) marks.push(<Text color={C.cyan}> ↑{git.ahead}</Text>)
    if (git.behind) marks.push(<Text color={C.cyan}> ↓{git.behind}</Text>)
    if (git.staged) marks.push(<Text color={C.green}> ●{git.staged}</Text>)
    if (git.modified) marks.push(<Text color={C.yellow}> ✚{git.modified}</Text>)
    if (git.untracked) marks.push(<Text dimColor> …{git.untracked}</Text>)
    if (git.conflicts) marks.push(<Text color={C.red}> ✖{git.conflicts}</Text>)
    const isClean = !git.staged && !git.modified && !git.untracked && !git.conflicts
    out.push(
      <Box>
        <Box flexGrow={1} flexShrink={1}>
          <Text wrap="truncate-end">
            <Text color={C.violet}>⎇ {git.branch ?? '?'}</Text>
            {isClean ? <Text color={C.green}> ✓</Text> : marks}
          </Text>
        </Box>
        {git.added || git.removed ? (
          <Text>
            <Text color={C.green}>+{git.added}</Text> <Text color={C.red}>−{git.removed}</Text>
          </Text>
        ) : null}
      </Box>,
    )
  }
  if (turn.topic) {
    out.push(
      <Text dimColor italic wrap="truncate-end">
        ❝ {turn.topic}
      </Text>,
    )
  }

  // -- context ---------------------------------------------------------------
  const percent = ctx.tokens !== null && ctx.window ? percentOf(ctx.tokens, ctx.window) : null
  const compactPercent = ctx.compactAt && ctx.window ? percentOf(ctx.compactAt, ctx.window) : null
  const toCompact = ctx.compactAt !== null && ctx.tokens !== null ? ctx.compactAt - ctx.tokens : null
  const isNearCompact = toCompact !== null && toCompact <= NEAR_COMPACT
  out.push(
    header(
      'context',
      percent === null
        ? '—'
        : `${isNearCompact ? '▲ ' : ''}${Math.round(percent)}% ${fmtTokens(ctx.tokens ?? 0)}/${fmtTokens(ctx.window ?? 0)}`,
      percent === null ? undefined : hex(heat(percent / (compactPercent ?? 100))),
    ),
  )
  if (isOpen('context')) {
    if (percent === null) {
      out.push(dim(`window ${ctx.window ? fmtTokens(ctx.window) : '?'} · waiting for the first response`))
    } else {
      out.push(cells('context-bar', contextBar(ctx.tokens ?? 0, ctx.window ?? 1, ctx.slices, compactPercent, W)))
      const used = ctx.slices.filter(slice => slice.kind === 'used')
      if (used.length > 0) {
        out.push(
          <Box flexWrap="wrap" columnGap={1}>
            {used.map((slice, i) => swatch(SLICE_COLORS[i % SLICE_COLORS.length]!, shortSlice(slice.name), fmtTokens(slice.tokens)))}
          </Box>,
        )
      }
      const left = compactPercent === null ? null : requestsToCompact(ctx.history, compactPercent)
      out.push(
        <Box>
          {cells('context-history', sparkCells(ctx.history, Math.max(8, W - 22), 100))}
          {isNearCompact ? (
            <Text color={C.yellow}> ▲ {fmtTokens(Math.max(0, toCompact ?? 0))} to compact</Text>
          ) : (
            <Text dimColor wrap="truncate-end">
              {' '}
              {compactPercent === null
                ? 'no auto-compact'
                : left === null
                  ? `compact at ${Math.round(compactPercent)}%`
                  : `~${left} req to compact`}
            </Text>
          )}
        </Box>,
      )
      if (ctx.compactions > 0) {
        out.push(dim(`⟳ compacted ${ctx.compactions}× · reclaimed ${fmtTokens(ctx.reclaimed)}`))
      }
    }
  }

  // -- to-do -----------------------------------------------------------------
  const done = todos.filter(item => item.status === 'completed').length
  const isAllDone = todos.length > 0 && done === todos.length
  out.push(
    header(
      'todo',
      todos.length === 0 ? 'none' : `${done}/${todos.length} ${Math.round(percentOf(done, todos.length))}%`,
      isAllDone ? C.green : undefined,
    ),
  )
  if (isOpen('todo')) {
    if (todos.length === 0) {
      out.push(dim('No to-dos.'))
    } else {
      out.push(cells('todo-bar', blocks(done / todos.length, W, { color: 0x4ade80 })))
      for (const item of todos) out.push(todoRow(item))
    }
  }

  function todoRow(item: Todo): RenderElement {
    const startedAt = item.startedAt ?? null
    const completedAt = item.completedAt ?? null
    if (item.status === 'completed') {
      const took = startedAt !== null && completedAt !== null ? fmtDuration(completedAt - startedAt) : ''
      return (
        <Box>
          <Box flexGrow={1} flexShrink={1}>
            <Text dimColor wrap="truncate-end">
              <Text color={C.green}>✔</Text> {item.text}
            </Text>
          </Box>
          {took ? dim(` ${took}`) : null}
        </Box>
      )
    }
    if (item.status === 'in_progress') {
      return (
        <Box>
          <Box flexGrow={1} flexShrink={1}>
            <Text color={C.yellow} bold wrap="truncate-end">
              {isRunning ? spin : '▶'} {item.text}
            </Text>
          </Box>
          {startedAt !== null ? <Text color={C.yellow}> {fmtDuration(now - startedAt)}</Text> : null}
        </Box>
      )
    }
    return (
      <Text wrap="truncate-end">
        <Text dimColor>○</Text> {item.text}
      </Text>
    )
  }

  // -- speed -----------------------------------------------------------------
  const rate = speed.live ?? speed.last
  out.push(
    header(
      'speed',
      rate === null ? '—' : `${speed.live !== null ? `${spin} ` : ''}${fmtRate(rate)} tok/s`,
      speed.live !== null ? C.cyan : undefined,
    ),
  )
  if (isOpen('speed')) {
    if (speed.history.length === 0) {
      out.push(dim('No finished response yet.'))
    } else {
      const avg = speed.history.reduce((sum, v) => sum + v, 0) / speed.history.length
      braille(speed.history, W, 2, undefined, cool).forEach((row, i) => out.push(cells(`speed-graph-${i}`, row)))
      out.push(
        <Text wrap="truncate-end">
          {label('avg', 4)}
          {fmtRate(avg)}
          {dim('  peak ')}
          {fmtRate(speed.peak ?? avg)}
          {speed.ttft !== null ? dim('  ttft ') : null}
          {speed.ttft !== null ? `${(speed.ttft / 1000).toFixed(1)}s` : null}
        </Text>,
      )
    }
  }

  // -- tokens, cache and cost ------------------------------------------------
  const prompt = tokens.input + tokens.cacheRead + tokens.cacheWrite
  const all = prompt + tokens.output
  out.push(
    header(
      'tokens',
      spend.usd !== null ? fmtUsd(spend.usd) : fmtTokens(all),
      spend.usd !== null ? C.yellow : undefined,
    ),
  )
  if (isOpen('tokens')) {
    if (all === 0) {
      out.push(dim('No request yet.'))
    } else {
      const values = { read: tokens.cacheRead, write: tokens.cacheWrite, new: tokens.input, out: tokens.output }
      out.push(cells('token-bar', stack(TOKEN_PARTS.map(part => ({ value: values[part.key], fg: part.fg })), W)))
      out.push(
        <Box flexWrap="wrap" columnGap={1}>
          {TOKEN_PARTS.map(part => swatch(part.fg, part.key, fmtPercent(percentOf(values[part.key], all))))}
        </Box>,
      )
      out.push(
        <Text wrap="truncate-end">
          {label('in')}
          {fmtTokens(prompt)}
          {dim('  out ')}
          {fmtTokens(tokens.output)}
          {dim('  req ')}
          {tokens.requests}
        </Text>,
      )
      const avgHit = prompt > 0 ? tokens.cacheRead / prompt : 0
      out.push(
        <Text wrap="truncate-end">
          {label('cache')}
          {cache.lastHit !== null ? <Text color={hitColor(cache.lastHit)}>{Math.round(cache.lastHit * 100)}%</Text> : '—'}
          {dim(` last · ${Math.round(avgHit * 100)}% avg`)}
          {cache.misses > 0 ? (
            <Text color={C.orange}>
              {' '}
              · ✗{cache.misses} miss{cache.lastMiss !== null ? ` ${fmtTokens(cache.lastMiss)}` : ''}
            </Text>
          ) : null}
        </Text>,
      )
      if (!isRunning && cache.lastAt !== null) {
        const idle = now - cache.lastAt
        const ttl = cache.isLongTtl ? LONG_TTL_MS : SHORT_TTL_MS
        const recache = ctx.tokens !== null ? ` · recache ${fmtTokens(ctx.tokens)}` : ''
        out.push(
          idle < ttl ? (
            <Text color={C.green} wrap="truncate-end">
              {'      '}◴ idle {fmtDuration(idle)} · warm {fmtDuration(ttl - idle)} left
            </Text>
          ) : cache.isLongTtl || idle >= LONG_TTL_MS ? (
            <Text color={C.red} wrap="truncate-end">
              {'      '}◴ idle {fmtDuration(idle)} · cold{recache}
            </Text>
          ) : (
            <Text color={C.yellow} wrap="truncate-end">
              {'      '}◴ idle {fmtDuration(idle)} · cold if 5m ttl{recache}
            </Text>
          ),
        )
      }
      if (burn.length > 0) {
        const minute = Math.floor(now / 60_000)
        const graphWidth = Math.max(6, W - 16)
        const perMinute = Array.from(
          { length: graphWidth * 2 },
          (_, i) => burn.find(bucket => bucket.minute === minute - graphWidth * 2 + 1 + i)?.tokens ?? 0,
        )
        const recentRate = perMinute.slice(-5).reduce((sum, v) => sum + v, 0) / 5
        const [upper = [], lower = []] = braille(perMinute, graphWidth, 2)
        out.push(
          <Box>
            {label('burn')}
            {cells('burn-graph-0', upper)}
            <Text color={burnColor(recentRate)}> {fmtTokens(recentRate)}/m</Text>
          </Box>,
        )
        out.push(
          <Box>
            {label('')}
            {cells('burn-graph-1', lower)}
            {dim(` ${Math.min(graphWidth * 2, 30)}m`)}
          </Box>,
        )
      }
      if (spend.usd !== null) {
        const hourly = costPerHour(spend.samples, now)
        out.push(
          <Text wrap="truncate-end">
            {label('cost')}
            <Text color={C.yellow}>{fmtUsd(spend.usd)}</Text>
            {hourly !== null ? dim(`  ${fmtUsd(hourly)}/h`) : null}
            {spend.turnUsd !== null && spend.turnUsd > 0 ? dim(`  last turn ${fmtUsd(spend.turnUsd)}`) : null}
          </Text>,
        )
      }
    }
  }

  // -- rate limits -----------------------------------------------------------
  if (spend.limits.length > 0) {
    const worst = spend.limits.reduce((a, b) => (b.percentUsed > a.percentUsed ? b : a))
    const isStale = spend.limitsAt !== null && now - spend.limitsAt > STALE_MS
    out.push(
      header(
        'limits',
        `${isStale ? '~' : ''}${Math.round(worst.percentUsed)}% ${paceMark(worst, now)}`.trim(),
        hex(heat(worst.percentUsed / 100)),
      ),
    )
    if (isOpen('limits')) {
      for (const limit of spend.limits) {
        const reset = limit.resetsAt ? Date.parse(limit.resetsAt) - now : null
        const elapsed = limitElapsed(limit, now)
        const projected = projectLimit(limit, now)
        const fullIn = limitFullIn(limit, now)
        out.push(
          <Box>
            {label(LIMIT_LABEL[limit.kind] ?? limit.kind.slice(0, 5), 4)}
            {cells(
              `limit-${limit.kind}`,
              blocks(limit.percentUsed / 100, Math.max(6, W - 21), elapsed === null ? {} : { cursorAt: elapsed }),
            )}
            <Text color={hex(heat(limit.percentUsed / 100))}> {String(Math.round(limit.percentUsed)).padStart(3)}%</Text>
            <Text dimColor> {paceMark(limit, now) || ' '}</Text>
            {reset !== null && reset > 0 ? dim(` ↻${fmtDuration(reset)}`) : null}
          </Box>,
        )
        if (projected !== null && projected >= 90) {
          out.push(
            <Text color={projected > 100 ? C.red : C.orange} wrap="truncate-end">
              {'    '}▲ pace → {Math.round(projected)}% at reset
              {fullIn !== null ? ` · full in ${fmtDuration(fullIn)}` : ''}
            </Text>,
          )
        }
      }
      if (isStale) out.push(dim(`    read ${fmtDuration(now - (spend.limitsAt ?? now))} ago`))
    }
  }

  // -- activity: the turn, where its time went, tools ------------------------
  const turnElapsed = isRunning ? now - (turn.runningSince ?? now) : 0
  out.push(
    header(
      'activity',
      isRunning ? `${spin} ${fmtDuration(turnElapsed)}` : `${turn.count} turn${turn.count === 1 ? '' : 's'}`,
      isRunning ? hex(elapsedColor(turnElapsed)) : undefined,
    ),
  )
  if (isOpen('activity')) {
    out.push(
      isRunning ? (
        <Text wrap="truncate-end">
          <Text color={hex(elapsedColor(turnElapsed))}>● running {fmtDuration(turnElapsed)}</Text>
          {dim(` · step ${turn.steps} · ${turn.tools} tools`)}
        </Text>
      ) : (
        <Text dimColor wrap="truncate-end">
          ○ idle
          {turn.lastMs !== null ? ` · last ${fmtDuration(turn.lastMs)}` : ''}
          {turn.count > 0 ? ` · avg ${fmtDuration(turn.totalMs / turn.count)}` : ''}
        </Text>
      ),
    )
    const spent = turn.apiMs + turn.toolMs
    if (spent > 0) {
      out.push(
        <Box>
          {cells(
            'time-split',
            stack(
              [
                { value: turn.apiMs, fg: 0xa78bfa },
                { value: turn.toolMs, fg: 0xfb923c },
              ],
              Math.max(6, W - 24),
            ),
          )}
          <Text>
            <Text color={C.violet}> api {Math.round(percentOf(turn.apiMs, spent))}%</Text>
            <Text color={C.orange}> tools {Math.round(percentOf(turn.toolMs, spent))}%</Text>
          </Text>
        </Box>,
      )
    }
    for (const call of running.slice(-5)) {
      const ms = now - call.since
      out.push(
        <Box>
          <Box flexGrow={1} flexShrink={1}>
            <Text wrap="truncate-end">
              <Text color={C.yellow}>{spin}</Text> <Text bold>{call.name}</Text>
              {call.detail ? <Text dimColor> {call.detail}</Text> : null}
            </Text>
          </Box>
          <Text color={hex(elapsedColor(ms))}> {fmtDuration(ms)}</Text>
        </Box>,
      )
    }
    if (recent.length > 0) {
      const ok = recent.filter(Boolean).length / recent.length
      out.push(
        <Box>
          {label('recent', 7)}
          {cells(
            'recent-calls',
            recent.map(isOk => (isOk ? { ch: '✓', fg: 0x4ade80 } : { ch: '✗', fg: 0xf87171 })),
          )}
          <Text color={okColor(ok)}> {Math.round(ok * 100)}% ok</Text>
        </Box>,
      )
    }
    const top = [...tools].sort((a, b) => b.count - a.count).slice(0, 6)
    const most = top[0]?.count ?? 0
    const nameWidth = Math.min(10, Math.max(4, ...top.map(stat => stat.name.length)))
    const barWidth = Math.max(4, W - nameWidth - 16)
    top.forEach((stat, i) => {
      out.push(
        <Box>
          <Text>{stat.name.slice(0, nameWidth).padEnd(nameWidth)} </Text>
          {cells(`tool-${i}`, meter(stat.count / most, barWidth, { color: SLICE_COLORS[i % SLICE_COLORS.length]! }))}
          <Text> {String(stat.count).padStart(3)}</Text>
          {stat.errors > 0 ? <Text color={C.red}> ✗{stat.errors}</Text> : null}
          <Text dimColor> {fmtSeconds(stat.ms / stat.count)}</Text>
        </Box>,
      )
    })
  }

  // -- subagents -------------------------------------------------------------
  if (agents.length > 0) {
    const live = agents.filter(agent => agent.status === 'running').length
    out.push(header('agents', live > 0 ? `${spin} ${live} running` : `${agents.length} done`, live > 0 ? C.yellow : undefined))
    if (isOpen('agents')) {
      const shown = [...agents]
        .sort((a, b) => Number(b.status === 'running') - Number(a.status === 'running') || b.startedAt - a.startedAt)
        .slice(0, 8)
      for (const agent of shown) out.push(agentRow(agent))
    }
  }

  function agentRow(agent: Agent): RenderElement {
    const isLive = agent.status === 'running'
    const mark = isLive ? (
      <Text color={C.yellow}>{spin}</Text>
    ) : agent.status === 'completed' ? (
      <Text color={C.green}>✔</Text>
    ) : agent.status === 'failed' ? (
      <Text color={C.red}>✗</Text>
    ) : (
      <Text dimColor>⊘</Text>
    )
    const ms = (agent.endedAt ?? now) - agent.startedAt
    return (
      <Box>
        <Box flexGrow={1} flexShrink={1}>
          <Text wrap="truncate-end" dimColor={!isLive}>
            {mark} <Text bold>{agent.type}</Text>
            {agent.model ? <Text dimColor> [{prettyModel(agent.model)}]</Text> : null} {agent.description}
          </Text>
        </Box>
        {isLive ? <Text color={hex(elapsedColor(ms))}> {fmtDuration(ms)}</Text> : dim(` ${fmtDuration(ms)}`)}
        {agent.tokens > 0 ? dim(` ${fmtTokens(agent.tokens)}`) : null}
      </Box>
    )
  }

  // -- files edited ----------------------------------------------------------
  if (files.length > 0) {
    const added = files.reduce((sum, file) => sum + file.added, 0)
    const removed = files.reduce((sum, file) => sum + file.removed, 0)
    out.push(header('files', `${files.length} +${added} −${removed}`))
    if (isOpen('files')) {
      const shown = [...files].sort((a, b) => b.at - a.at).slice(0, 10)
      const most = Math.max(1, ...shown.map(file => file.added + file.removed))
      shown.forEach((file, i) => {
        const size = Math.max(1, Math.round(((file.added + file.removed) / most) * 5))
        const plus = Math.round((file.added / Math.max(1, file.added + file.removed)) * size)
        const stat: Cell[] = [
          ...Array.from({ length: plus }, () => ({ ch: '■', fg: 0x4ade80 })),
          ...Array.from({ length: size - plus }, () => ({ ch: '■', fg: 0xf87171 })),
          ...Array.from({ length: 5 - size }, () => ({ ch: '■', fg: 0x3f3f46 })),
        ]
        out.push(
          <Box>
            <Box flexGrow={1} flexShrink={1}>
              <Text wrap="truncate-start">{shortPath(file.path, cwd, W - 18)}</Text>
            </Box>
            <Text color={C.green}> +{file.added}</Text>
            <Text color={C.red}> −{file.removed} </Text>
            {cells(`file-${i}`, stat)}
          </Box>,
        )
      })
    }
  }

  if (e.props.isFocused) out.push(<Box marginTop={1}>{dim('1-8 fold or unfold · esc back')}</Box>)

  return <Box flexDirection="column">{out}</Box>
}
