import { describe, expect, test } from 'claude-code/testing'

import {
  base64,
  blocks,
  braille,
  fmtPercent,
  fmtTokens,
  meter,
  parseGitStatus,
  parseShortstat,
  patchCounts,
  prettyModel,
  shortPath,
  sparkCells,
  sparkline,
  stack,
  TRACK,
} from '../hooks/lib'
import { contextBar, costPerHour, limitFullIn, paceMark, projectLimit, requestsToCompact } from '../hooks/view'

const glyphs = (cells: { ch: string }[]) => cells.map(cell => cell.ch).join('')

describe('glyphs', () => {
  test('a sparkline scales to its largest value and keeps the last values', () => {
    expect(sparkline([0, 1, 2, 4, 8], 5)).toBe('▁▂▃▅█')
    expect(sparkline([8, 0, 8], 2)).toBe('▁█')
    expect(sparkline([0, 0], 2)).toBe('▁▁')
    expect(sparkline([50], 1, 100)).toBe('▅')
  })

  test('a sparkline row keeps its width with the newest value at the right', () => {
    expect(glyphs(sparkCells([8, 8], 4))).toBe('  ██')
    expect(glyphs(sparkCells([], 3))).toBe('   ')
  })

  test('a braille graph puts two values in a cell and stacks rows top first', () => {
    expect(glyphs(braille([4, 4], 1, 1, 4)[0]!)).toBe('⣿')
    expect(glyphs(braille([0, 4], 1, 1, 4)[0]!)).toBe('⢸')
    expect(glyphs(braille([2], 1, 1, 4)[0]!)).toBe('⢠')
    const [upper, lower] = braille([4], 1, 2, 8)
    expect(glyphs(upper!)).toBe('⠀')
    expect(glyphs(lower!)).toBe('⢸')
  })

  test('a meter fills in eighths and ticks its mark on the track', () => {
    expect(glyphs(meter(0.5, 4))).toBe('██──')
    expect(glyphs(meter(0.3, 4))).toBe('█▎──')
    expect(glyphs(meter(0, 4, { markAt: 0.75 }))).toBe('───┃')
  })

  test('a block meter lights its share and draws the time cursor', () => {
    const row = blocks(0.5, 4)
    expect(glyphs(row)).toBe('■■■■')
    expect(row[1]!.fg).not.toBe(TRACK)
    expect(row[2]!.fg).toBe(TRACK)
    expect(glyphs(blocks(0.5, 4, { cursorAt: 0.75 }))).toBe('■■■┃')
  })

  test('a stack fills exactly its share by largest remainder', () => {
    const parts = [
      { value: 1, fg: 1 },
      { value: 1, fg: 2 },
      { value: 1, fg: 3 },
    ]
    expect(stack(parts, 10).map(cell => cell.fg)).toEqual([1, 1, 1, 1, 2, 2, 2, 3, 3, 3])
    expect(glyphs(stack(parts.slice(0, 2), 10, 4))).toBe('█████─────')
  })

  test('raster cells are base64 as the standard alphabet pads it', () => {
    expect(base64(new Uint8Array([0x4d, 0x61, 0x6e]))).toBe('TWFu')
    expect(base64(new Uint8Array([0x4d, 0x61]))).toBe('TWE=')
    expect(base64(new Uint8Array([0x4d]))).toBe('TQ==')
  })

  test('the context bar splits the used part by content and hatches the reserve', () => {
    const slices = [
      { name: 'System prompt', tokens: 1, kind: 'used' as const },
      { name: 'Messages', tokens: 1, kind: 'used' as const },
    ]
    const row = contextBar(40, 100, slices, 80, 10)
    expect(glyphs(row)).toBe('████────┃░')
    expect(row[0]!.fg).not.toBe(row[3]!.fg)
  })
})

describe('git', () => {
  test('porcelain v2 counts staged, modified, untracked and conflicted paths', () => {
    const state = parseGitStatus(
      [
        '# branch.head feature/x',
        '# branch.ab +2 -3',
        '1 MM N... 100644 100644 100644 a b one',
        '2 R. N... 100644 100644 100644 a b R100 two\tthree',
        'u UU N... 100644 100644 100644 100644 a b c four',
        '? five',
      ].join('\n'),
    )
    expect(state).toEqual({ branch: 'feature/x', ahead: 2, behind: 3, staged: 2, modified: 1, untracked: 1, conflicts: 1 })
  })

  test('a detached head reads as detached', () => {
    expect(parseGitStatus('# branch.head (detached)').branch).toBe('detached')
  })

  test('shortstat reads both counts, either alone, and none', () => {
    expect(parseShortstat(' 2 files changed, 1 insertion(+), 5 deletions(-)')).toEqual({ added: 1, removed: 5 })
    expect(parseShortstat(' 1 file changed, 3 deletions(-)')).toEqual({ added: 0, removed: 3 })
    expect(parseShortstat('')).toEqual({ added: 0, removed: 0 })
  })

  test('a structured patch counts its plus and minus lines', () => {
    expect(patchCounts([{ lines: [' keep', '-old', '+new', '+more'] }, { lines: ['-gone'] }])).toEqual({ added: 2, removed: 2 })
  })
})

describe('numbers', () => {
  test('token counts drop a trailing zero and keep what matters', () => {
    expect(fmtTokens(950)).toBe('950')
    expect(fmtTokens(200_000)).toBe('200k')
    expect(fmtTokens(6_240)).toBe('6.2k')
    expect(fmtTokens(1_000_000)).toBe('1M')
    expect(fmtTokens(1_024_000)).toBe('1.02M')
  })

  test('a small share keeps a decimal', () => {
    expect(fmtPercent(0.37)).toBe('0.4%')
    expect(fmtPercent(0)).toBe('0%')
    expect(fmtPercent(42.4)).toBe('42%')
  })
})

describe('names', () => {
  test('a model id reads as its name; a name stays', () => {
    expect(prettyModel('claude-opus-5-5')).toBe('Opus 5.5')
    expect(prettyModel('claude-haiku-4-5-20251001')).toBe('Haiku 4.5')
    expect(prettyModel('claude-opus-5-5[1m]')).toBe('Opus 5.5[1m]')
    expect(prettyModel('Opus 5.5')).toBe('Opus 5.5')
  })

  test('a path shows relative to the root and is cut from the left', () => {
    expect(shortPath('/repo/src/app.ts', '/repo', 20)).toBe('src/app.ts')
    expect(shortPath('/repo/src/deep/nested/file.ts', '/repo', 12)).toBe('…ted/file.ts')
  })
})

describe('forecasts', () => {
  const hour = 3600_000
  const fiveHour = (percentUsed: number, resetIn: number) => ({
    kind: 'five_hour',
    percentUsed,
    resetsAt: new Date(resetIn).toISOString(),
  })

  test('a window on pace to pass its limit projects past 100% and says when it fills', () => {
    expect(projectLimit(fiveHour(60, 2.5 * hour), 0)).toBe(120)
    expect(limitFullIn(fiveHour(50, 3.75 * hour), 0)).toBe(4_500_000)
    expect(limitFullIn(fiveHour(10, 2.5 * hour), 0)).toBe(null)
  })

  test('a window too young to judge, or without a span, projects nothing', () => {
    expect(projectLimit(fiveHour(5, 4.8 * hour), 0)).toBe(null)
    expect(projectLimit({ kind: 'spend_limit', percentUsed: 50, resetsAt: null }, 0)).toBe(null)
  })

  test('the pace mark compares the share used with the share of time gone', () => {
    expect(paceMark(fiveHour(50, 3.75 * hour), 0)).toBe('◆')
    expect(paceMark(fiveHour(10, 2.5 * hour), 0)).toBe('◇')
    expect(paceMark(fiveHour(52, 2.5 * hour), 0)).toBe('◈')
  })

  test('requests to compaction follow the recent growth of the window', () => {
    expect(requestsToCompact([10, 12, 14, 16], 80)).toBe(32)
    expect(requestsToCompact([30, 30, 30], 80)).toBe(null)
    expect(requestsToCompact([10, 12], 80)).toBe(null)
  })

  test('cost per hour uses the last hour of samples', () => {
    expect(costPerHour([{ at: 0, usd: 0 }, { at: hour / 2, usd: 1 }], hour / 2)).toBe(2)
    expect(costPerHour([{ at: 0, usd: 0 }, { at: 2 * hour, usd: 5 }, { at: 3 * hour, usd: 8 }], 3 * hour)).toBe(3)
    expect(costPerHour([{ at: 0, usd: 1 }], 0)).toBe(null)
  })
})
