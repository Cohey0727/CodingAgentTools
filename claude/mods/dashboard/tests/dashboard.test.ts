import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, SessionContextUsage } from 'claude-code'

const START = 1_700_000_000_000

// The engine's side of what the mod asks for, and what the status line showed.
function engine(on: On) {
  const status: (string | undefined)[] = []
  const clock = mock.clock(on, { now: START })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  on('session.usage', () => ({ value: { startedAt: START, context: { window: 200_000 }, rateLimits: [] } }))
  on('ui.status', (_$, e) => {
    status.push(e.text)
    return { value: undefined }
  })
  return { clock, last: () => status[status.length - 1] }
}

const start = ($: Engine) => $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })

const measure = ($: Engine, context: SessionContextUsage) =>
  $.session.measure({ context, rateLimits: [], changed: ['context'] })

// A response that streams its first piece 1.5 s after it was asked for and
// stops 2 s later with `output` tokens.
function respond(on: On, clock: ReturnType<typeof mock.clock>, output: number) {
  const used = {
    input_tokens: 10,
    output_tokens: output,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
    model: 'claude-opus-5-5',
  }
  on('turn.step', async function* (_$, e) {
    await clock.advance(1_500)
    yield { kind: 'text', index: 0, text: 'Hello' }
    await clock.advance(2_000)
    yield { kind: 'stop', stopReason: 'end_turn', usage: used }
    return { turnId: e.turnId, index: e.index, answer: 'Hello', toolUses: [], stopReason: 'end_turn', usage: used }
  })
}

async function step($: Engine, agentId?: string) {
  const stream = $.turn.step({
    turnId: 't1',
    index: 0,
    model: 'claude-opus-5-5',
    messageCount: 1,
    ...(agentId === undefined ? {} : { agentId }),
  })
  for await (const _ of stream) {
    // drain
  }
  return stream.result
}

test('the status line reads the context fill, then the rate once a response has ended', async ($, on) => {
  const { clock, last } = engine(on)
  respond(on, clock, 100)
  await start($)
  expect(last()).toBeUndefined()

  await measure($, { tokens: 62_000, window: 200_000, percent: 31 })
  expect(last()).toBe('62k / 200k 31%')

  await step($)
  expect(last()).toBe('62k / 200k 31% 50.0 t/s')
})

test('a subagent’s response leaves the rate alone', async ($, on) => {
  const { clock, last } = engine(on)
  respond(on, clock, 100)
  await start($)
  await measure($, { tokens: 62_000, window: 200_000, percent: 31 })
  await step($, 'a1')
  expect(last()).toBe('62k / 200k 31%')
})

test('a reply too short to time keeps the last rate', async ($, on) => {
  const { clock, last } = engine(on)
  const outputs = [100, 5]
  on('turn.step', async function* (_$, e) {
    const used = {
      input_tokens: 10,
      output_tokens: outputs.shift()!,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
      model: 'claude-opus-5-5',
    }
    yield { kind: 'text', index: 0, text: 'Hi' }
    await clock.advance(2_000)
    yield { kind: 'stop', stopReason: 'end_turn', usage: used }
    return { turnId: e.turnId, index: e.index, answer: 'Hi', toolUses: [], stopReason: 'end_turn', usage: used }
  })
  await start($)
  await step($)
  expect(last()).toBe('50.0 t/s')
  await step($)
  expect(last()).toBe('50.0 t/s')
})
