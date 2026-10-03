import type { GitState, Todo, TodoStatus } from '../types'

// ---------------------------------------------------------------------------
// Numbers

const trimZeros = (fixed: string) => fixed.replace(/\.?0+$/, '')

export const fmtTokens = (n: number) =>
  n < 1000
    ? `${Math.round(n)}`
    : n < 1_000_000
      ? `${trimZeros((n / 1000).toFixed(1))}k`
      : `${trimZeros((n / 1_000_000).toFixed(2))}M`

// A share that keeps a decimal while it is small enough to need one.
export const fmtPercent = (percent: number) => (percent < 10 && percent > 0 ? `${percent.toFixed(1)}%` : `${Math.round(percent)}%`)

// Seconds with a decimal under ten, as a tool's average takes them.
export const fmtSeconds = (ms: number) => (ms < 10_000 ? `${(ms / 1000).toFixed(1)}s` : fmtDuration(ms))

export const fmtRate = (tps: number) => `${tps < 100 ? tps.toFixed(1) : Math.round(tps)}`

export const fmtUsd = (usd: number) => (usd < 10 ? `$${usd.toFixed(2)}` : `$${usd.toFixed(1)}`)

export function fmtDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m${String(s % 60).padStart(2, '0')}s`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h${String(m % 60).padStart(2, '0')}m`
  return `${Math.floor(h / 24)}d${String(h % 24).padStart(2, '0')}h`
}

export const percentOf = (part: number, whole: number) => (whole > 0 ? (part / whole) * 100 : 0)

// A model id (`family-name-5-5-20260101`) as a name (`Name 5.5`); a name that
// is no id is kept as it is.
export function prettyModel(name: string): string {
  const match = /^[a-z]+-([a-z]+)-(\d+(?:-\d{1,2})*)(?:-\d{8})?(\[.*\])?$/.exec(name)
  if (!match) return name
  const [, family = '', version = '', suffix = ''] = match
  return `${family.charAt(0).toUpperCase()}${family.slice(1)} ${version.replaceAll('-', '.')}${suffix}`
}

// ---------------------------------------------------------------------------
// Colored cells: one Raster on the terminal, runs of Text elsewhere

export type Cell = { ch: string; fg: number | null }

export const DEFAULT_COLOR = 0x01000000
export const TRACK = 0x3f3f46
export const MARK = 0xe4e4e7

export const hex = (rgb: number) => `#${rgb.toString(16).padStart(6, '0')}`

const clamp = (x: number) => Math.min(1, Math.max(0, x))

// A color ramp through `stops` ([position 0 to 1, 0xRRGGBB]).
function ramp(stops: readonly (readonly [number, number])[]) {
  return (t: number): number => {
    const x = clamp(t)
    for (let i = 1; i < stops.length; i++) {
      const [x1, c1] = stops[i]!
      const [x0, c0] = stops[i - 1]!
      if (x <= x1) {
        const k = (x - x0) / (x1 - x0)
        const mix = (shift: number) =>
          Math.round(((c0 >> shift) & 0xff) + (((c1 >> shift) & 0xff) - ((c0 >> shift) & 0xff)) * k)
        return (mix(16) << 16) | (mix(8) << 8) | mix(0)
      }
    }
    return stops[stops.length - 1]![1]
  }
}

// Green through amber to red, for what costs more as it grows (btop's
// #77ca9b → #cbc06c → #dc4c4c, brightened for a dark pane).
export const heat = ramp([
  [0, 0x4ade80],
  [0.6, 0xfacc15],
  [0.8, 0xfb923c],
  [1, 0xf87171],
])

// Deep blue to cyan, for what is better as it grows.
export const cool = ramp([
  [0, 0x1d4ed8],
  [0.5, 0x3b82f6],
  [1, 0x67e8f9],
])

const PARTIALS = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉']

// A bar `width` cells long, filled to `fraction` with eighth-cell precision,
// each filled cell colored by where it sits along the length or all in
// `color`; `markAt` (0 to 1) ticks the track there.
export function meter(fraction: number, width: number, options: { color?: number; markAt?: number } = {}): Cell[] {
  const eighths = Math.round(clamp(fraction) * width * 8)
  const mark = options.markAt === undefined ? -1 : Math.min(width - 1, Math.floor(options.markAt * width))
  const cells: Cell[] = []
  for (let i = 0; i < width; i++) {
    const fg = options.color ?? heat(width > 1 ? i / (width - 1) : 1)
    const filled = eighths - i * 8
    if (filled >= 8) cells.push({ ch: '█', fg })
    else if (filled > 0) cells.push({ ch: PARTIALS[filled] ?? '▏', fg })
    else if (i === mark) cells.push({ ch: '┃', fg: MARK })
    else cells.push({ ch: '─', fg: TRACK })
  }
  return cells
}

// btop's meter: one ■ per cell, lit cells in the color of their place along
// the gradient (or `color`), the rest dim; `cursorAt` (0 to 1) draws a cursor
// there, as ccstatusline marks how much of a window's time has passed.
export function blocks(fraction: number, width: number, options: { color?: number; cursorAt?: number } = {}): Cell[] {
  const lit = Math.round(clamp(fraction) * width)
  const cursor = options.cursorAt === undefined ? -1 : Math.min(width - 1, Math.floor(clamp(options.cursorAt) * width))
  return Array.from({ length: width }, (_, i) => {
    if (i === cursor) return { ch: '┃', fg: MARK }
    if (i >= lit) return { ch: '■', fg: TRACK }
    return { ch: '■', fg: options.color ?? heat(width > 1 ? i / (width - 1) : 1) }
  })
}

// Parts side by side in their colors, sized by largest remainder so they
// fill exactly the cells their share of `total` comes to; the track after.
export function stack(parts: readonly { value: number; fg: number }[], width: number, total?: number): Cell[] {
  const sum = parts.reduce((acc, part) => acc + Math.max(0, part.value), 0)
  const whole = total ?? sum
  const span = whole > 0 ? Math.min(width, Math.round((sum / whole) * width)) : 0
  const exact = parts.map(part => (sum > 0 ? (Math.max(0, part.value) / sum) * span : 0))
  const counts = exact.map(Math.floor)
  let left = span - counts.reduce((acc, n) => acc + n, 0)
  const byRemainder = exact.map((x, i) => [x - Math.floor(x), i] as const).sort((a, b) => b[0] - a[0])
  for (const [, i] of byRemainder) {
    if (left <= 0) break
    counts[i] = (counts[i] ?? 0) + 1
    left -= 1
  }
  const cells: Cell[] = []
  parts.forEach((part, i) => {
    for (let n = 0; n < (counts[i] ?? 0); n++) cells.push({ ch: '█', fg: part.fg })
  })
  while (cells.length < width) cells.push({ ch: '─', fg: TRACK })
  return cells
}

// One glyph per value, scaled to the largest; the last `width` values.
const SPARKS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█']

export function sparkline(values: readonly number[], width: number, max?: number): string {
  const shown = values.slice(-width)
  const top = max ?? Math.max(0, ...shown)
  if (top <= 0) return shown.map(() => SPARKS[0]).join('')
  return shown
    .map(v => SPARKS[Math.min(SPARKS.length - 1, Math.max(0, Math.round((v / top) * (SPARKS.length - 1))))])
    .join('')
}

// A sparkline as `width` cells, each colored by its own height, the newest
// value at the right and blanks before the first.
export function sparkCells(values: readonly number[], width: number, max?: number, color = heat): Cell[] {
  const shown = values.slice(-width)
  const top = max ?? Math.max(0, ...shown)
  const glyphs = sparkline(shown, width, top)
  const blank: Cell[] = Array.from({ length: width - shown.length }, () => ({ ch: ' ', fg: null }))
  return [...blank, ...[...glyphs].map((ch, i) => ({ ch, fg: color(top > 0 ? (shown[i] ?? 0) / top : 0) }))]
}

// Braille dots from the bottom of a cell up: the left column, the right one.
const LEFT_DOTS = [0x40, 0x04, 0x02, 0x01]
const RIGHT_DOTS = [0x80, 0x20, 0x10, 0x08]

// btop's braille graph: `rows` cells tall, two values to a cell, each value a
// column of up to rows × 4 dots scaled to `max`; the newest at the right.
// Rows come top first.
export function braille(values: readonly number[], cells: number, rows: number, max?: number, color = heat): Cell[][] {
  const shown = values.slice(-cells * 2)
  const padded: (number | null)[] = [...Array<null>(cells * 2 - shown.length).fill(null), ...shown]
  const top = max ?? Math.max(0, ...shown)
  const levels = rows * 4
  const height = (v: number | null | undefined) =>
    v === null || v === undefined || top <= 0 || v <= 0 ? 0 : Math.max(1, Math.round((Math.min(v, top) / top) * levels))
  const out: Cell[][] = Array.from({ length: rows }, () => [])
  for (let c = 0; c < cells; c++) {
    const left = height(padded[c * 2])
    const right = height(padded[c * 2 + 1])
    const fg = color(Math.max(left, right) / levels)
    for (let r = 0; r < rows; r++) {
      const below = (rows - 1 - r) * 4
      let bits = 0
      for (let d = 0; d < 4; d++) {
        if (left > below + d) bits |= LEFT_DOTS[d]!
        if (right > below + d) bits |= RIGHT_DOTS[d]!
      }
      out[r]!.push({ ch: String.fromCharCode(0x2800 + bits), fg: bits === 0 ? null : fg })
    }
  }
  return out
}

const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

export const spinnerFrame = (now: number) => SPINNER[Math.floor(now / 100) % SPINNER.length] ?? SPINNER[0]!

// How long something has run, as claude-code-status-bar colors it.
export const elapsedColor = (ms: number) => (ms < 30_000 ? 0x4ade80 : ms < 120_000 ? 0xfacc15 : 0xf87171)

// The cells of a Raster: little-endian u32 triplets [codePoint, fg, bg], base64.
export function rasterCells(cells: readonly Cell[]): string {
  const words = new Uint32Array(cells.length * 3)
  cells.forEach((cell, i) => {
    words[i * 3] = cell.ch.codePointAt(0) ?? 0x20
    words[i * 3 + 1] = cell.fg ?? DEFAULT_COLOR
    words[i * 3 + 2] = DEFAULT_COLOR
  })
  return base64(new Uint8Array(words.buffer))
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

export function base64(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!
    const b = bytes[i + 1]
    const c = bytes[i + 2]
    const n = (a << 16) | ((b ?? 0) << 8) | (c ?? 0)
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]!
    out += b === undefined ? '=' : B64[(n >> 6) & 63]!
    out += c === undefined ? '=' : B64[n & 63]!
  }
  return out
}

// Consecutive cells of one color as one run: what a surface without Raster draws.
export function runs(cells: readonly Cell[]): { text: string; fg: number | null }[] {
  const out: { text: string; fg: number | null }[] = []
  for (const cell of cells) {
    const last = out[out.length - 1]
    if (last && last.fg === cell.fg) last.text += cell.ch
    else out.push({ text: cell.ch, fg: cell.fg })
  }
  return out
}

// ---------------------------------------------------------------------------
// Edits and git

type Hunk = { lines: readonly string[] }

// Lines added and removed by a structured patch, as `git diff --stat` counts them.
export function patchCounts(hunks: readonly Hunk[]): { added: number; removed: number } {
  let added = 0
  let removed = 0
  for (const hunk of hunks) {
    for (const line of hunk.lines) {
      if (line.startsWith('+')) added += 1
      else if (line.startsWith('-')) removed += 1
    }
  }
  return { added, removed }
}

export const countLines = (text: string) => (text === '' ? 0 : text.split('\n').length - (text.endsWith('\n') ? 1 : 0))

// `git status --porcelain=v2 --branch` read into counts.
export function parseGitStatus(text: string): Omit<GitState, 'added' | 'removed' | 'checkedAt'> {
  const state = { branch: null as string | null, ahead: 0, behind: 0, staged: 0, modified: 0, untracked: 0, conflicts: 0 }
  for (const line of text.split('\n')) {
    if (line.startsWith('# branch.head ')) {
      const head = line.slice('# branch.head '.length).trim()
      state.branch = head === '(detached)' ? 'detached' : head
    } else if (line.startsWith('# branch.ab ')) {
      const match = /\+(\d+) -(\d+)/.exec(line)
      if (match) {
        state.ahead = Number(match[1])
        state.behind = Number(match[2])
      }
    } else if (line.startsWith('1 ') || line.startsWith('2 ')) {
      const xy = line.slice(2, 4)
      if (xy[0] !== '.') state.staged += 1
      if (xy[1] !== '.') state.modified += 1
    } else if (line.startsWith('u ')) {
      state.conflicts += 1
    } else if (line.startsWith('? ')) {
      state.untracked += 1
    }
  }
  return state
}

// `git diff --shortstat` read into the lines it adds and removes.
export function parseShortstat(text: string): { added: number; removed: number } {
  const added = /(\d+) insertions?\(\+\)/.exec(text)
  const removed = /(\d+) deletions?\(-\)/.exec(text)
  return { added: added ? Number(added[1]) : 0, removed: removed ? Number(removed[1]) : 0 }
}

// A path shown relative to `root`, cut from the left to `width` cells.
export function shortPath(path: string, root: string, width: number): string {
  const relative = root && path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path
  if (relative.length <= width) return relative
  return `…${relative.slice(relative.length - width + 1)}`
}

// ---------------------------------------------------------------------------
// To-dos

type TodoInput = { readonly [key: string]: unknown }

// The list after the action, or why the action cannot apply. `now` stamps
// when an item started and finished.
export function applyTodo(list: readonly Todo[], input: TodoInput, now: number): Todo[] | string {
  const id = input.id === undefined ? undefined : String(input.id)
  switch (input.action) {
    case 'set': {
      const items = input.items
      if (!Array.isArray(items) || !items.every(item => typeof item === 'string' && item.trim())) {
        return '`set` needs `items`: a list of non-empty strings.'
      }
      return items.map((text: string, i) => todo(String(i + 1), text.trim(), 'pending'))
    }
    case 'add': {
      if (typeof input.text !== 'string' || !input.text.trim()) return '`add` needs `text`.'
      const nextId = list.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0) + 1
      return [...list, todo(String(nextId), input.text.trim(), 'pending')]
    }
    case 'start':
    case 'done':
    case 'remove': {
      if (!list.some(item => item.id === id)) return `No to-do has id ${id ?? '(none given)'}.`
      if (input.action === 'remove') return list.filter(item => item.id !== id)
      if (input.action === 'done') return list.map(item => (item.id === id ? withStatus(item, 'completed', now) : item))
      return list.map(item =>
        item.id === id
          ? withStatus(item, 'in_progress', now)
          : item.status === 'in_progress'
            ? withStatus(item, 'pending', now)
            : item,
      )
    }
    case 'clear':
      return []
    case 'list':
      return [...list]
    default:
      return `Unknown action ${JSON.stringify(input.action)}.`
  }
}

export const todo = (id: string, text: string, status: TodoStatus): Todo => ({
  id,
  text,
  status,
  startedAt: null,
  completedAt: null,
})

// The item moved to `status`, its clock started on its first start and
// stopped when it completes.
export function withStatus(item: Todo, status: TodoStatus, now: number): Todo {
  if (item.status === status) return item
  return {
    ...item,
    status,
    startedAt: status === 'in_progress' ? (item.startedAt ?? now) : item.startedAt,
    completedAt: status === 'completed' ? now : null,
  }
}

// A list another tool reported, keeping the clocks of the items it already had
// (matched by id, then by text).
export function mergeTodos(
  previous: readonly Todo[],
  next: readonly Pick<Todo, 'id' | 'text' | 'status'>[],
  now: number,
): Todo[] {
  return next.map(item => {
    const known = previous.find(old => old.id === item.id && old.text === item.text) ?? previous.find(old => old.text === item.text)
    const base = known ? { ...known, id: item.id, text: item.text } : todo(item.id, item.text, 'pending')
    return withStatus(base, item.status, now)
  })
}

const MARKS: Record<TodoStatus, string> = { completed: 'x', in_progress: '>', pending: ' ' }

export function todoText(list: readonly Todo[]): string {
  if (list.length === 0) return 'The to-do list is empty.'
  return list.map(item => `${item.id}. [${MARKS[item.status]}] ${item.text}`).join('\n')
}
