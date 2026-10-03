import type { EngineInterface, Register, SessionContextUsage, TurnStepResult } from 'claude-code'

// A reply this short is mostly latency; its rate would drag the figure down.
const MIN_TOKENS_FOR_RATE = 24

const trimZeros = (fixed: string) => fixed.replace(/\.?0+$/, '')

const fmtTokens = (n: number) =>
  n < 1000
    ? `${Math.round(n)}`
    : n < 1_000_000
      ? `${trimZeros((n / 1000).toFixed(1))}k`
      : `${trimZeros((n / 1_000_000).toFixed(2))}M`

const fmtRate = (tps: number) => `${tps < 100 ? tps.toFixed(1) : Math.round(tps)}`

// Module variables start over on a reload; session.start reads the window again.
let context: SessionContextUsage | null = null
let tps: number | null = null

function showStatus($: EngineInterface) {
  const parts: string[] = []
  if (context?.tokens !== undefined && context.window > 0) {
    const percent = context.percent ?? Math.round((context.tokens / context.window) * 100)
    parts.push(`${fmtTokens(context.tokens)} / ${fmtTokens(context.window)} ${percent}%`)
  }
  if (tps !== null) parts.push(`${fmtRate(tps)} t/s`)
  $.ui.status(parts.length > 0 ? parts.join(' ') : undefined)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    context = (await $.session.usage().catch(() => null))?.context ?? null
    showStatus($)
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('context')) {
      context = e.context
      showStatus($)
    }
    return next(e)
  })

  // Output tokens per second of the main loop's responses, from the first
  // streamed piece of any kind to the stop, so a reply whose thinking streams
  // no visible text is not counted as fast.
  on('turn.step', async function* ($, e, next) {
    const stream = next(e)
    if (e.agentId !== undefined) {
      yield* stream
      return stream.result
    }
    let firstAt: number | null = null
    let stopAt: number | null = null
    for await (const chunk of stream) {
      yield chunk
      if (firstAt === null) firstAt = await $.clock.now()
      if (chunk.kind === 'stop') stopAt = await $.clock.now()
    }
    const result: TurnStepResult = await stream.result
    const output = result.usage?.output_tokens ?? 0
    if (firstAt !== null && stopAt !== null && stopAt > firstAt && output >= MIN_TOKENS_FOR_RATE) {
      tps = output / ((stopAt - firstAt) / 1000)
      showStatus($)
    }
    return result
  })
}
