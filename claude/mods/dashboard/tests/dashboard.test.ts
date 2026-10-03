import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { AgentInfo, On, RenderSurface, SessionRateLimit, SessionUsage, UiPane } from 'claude-code'

const SURFACES = ['terminal', 'desktop'] as const
const START = 1_700_000_000_000

type World = {
  tools?: string[]
  agents?: AgentInfo[]
  rateLimits?: SessionRateLimit[]
  usd?: number
  panes?: UiPane[]
  store?: Record<string, unknown>
  gitStatus?: string
  gitDiff?: string
}

// The engine's side of what the mod asks for, and what it showed.
function engine(on: On, world: World = {}) {
  const shown = { toasts: [] as string[], status: [] as (string | undefined)[], registered: [] as string[] }
  const clock = mock.clock(on, { now: START })
  mock.store(on, world.store)
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.usage', (_$, e) => ({ value: usage(world, e.breakdown !== undefined) }))
  on('tool.list', () => ({ value: (world.tools ?? []).map(name => ({ name, description: name, mcp: false })) }))
  on('tool.register', (_$, e) => {
    shown.registered.push(e.name)
    return { value: { tool: `mcp__dashboard__${e.name}` } }
  })
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('agent.list', () => ({ value: world.agents ?? [] }))
  on('process.run', (_$, e) => {
    const stdout = e.argv[1] === 'status' ? world.gitStatus : world.gitDiff
    return {
      value: {
        exitCode: stdout === undefined ? 128 : 0,
        stdout: stdout ?? '',
        stderr: '',
        isStdoutTruncated: false,
        isStderrTruncated: false,
      },
    }
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.panes', () => ({ value: world.panes ?? [] }))
  on('ui.toast', (_$, e) => {
    shown.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.status', (_$, e) => {
    shown.status.push(e.text)
    return { value: undefined }
  })
  on('ui.invalidate', () => ({ value: undefined }))
  return { clock, shown }
}

function usage(world: World, withBreakdown: boolean): SessionUsage {
  const breakdown = {
    categories: [
      { name: 'System prompt', tokens: 3_000, color: 'promptBorder', isDeferred: false, kind: 'used' },
      { name: 'Messages', tokens: 9_000, color: 'permission', isDeferred: false, kind: 'used' },
      { name: 'Free space', tokens: 150_000, color: 'inactive', isDeferred: false, kind: 'free' },
      { name: 'Autocompact buffer', tokens: 38_000, color: 'inactive', isDeferred: false, kind: 'buffer' },
    ],
    totalTokens: 12_000,
    maxTokens: 200_000,
    rawMaxTokens: 200_000,
    autocompactSource: 'model-default',
    percentage: 6,
    gridRows: [],
    model: 'claude-opus-5-5',
    memoryFiles: [],
    mcpTools: [],
    agents: [],
    autoCompactThreshold: 160_000,
    isAutoCompactEnabled: true,
    apiUsage: null,
  }
  return {
    startedAt: START - 65 * 60_000,
    context: { window: 200_000, ...(withBreakdown ? { breakdown } : {}) },
    rateLimits: world.rateLimits ?? [],
    ...(world.usd === undefined ? {} : { cost: { usd: world.usd } }),
  } as unknown as SessionUsage
}

const start = ($: Engine) => $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })

function mount($: Engine, surface: RenderSurface) {
  return $.ui.mount({
    plugin: 'dashboard',
    surface,
    component: 'Pane',
    requestId: 'dashboard',
    props: {
      title: 'Dashboard',
      isFocused: false,
      bodyColumns: 48,
      placement: 'dock',
      scroll: { offset: 0, bodyRows: 80 },
      view: {},
    },
  })
}

// Every text the pane drew, rows and their pieces alike.
async function lines($: Engine, surface: RenderSurface = 'terminal') {
  const ui = await mount($, surface)
  const texts = [...(await ui.findAll({ type: 'Box' })), ...(await ui.findAll({ type: 'Text' }))]
    .map(element => element.text)
    .filter((text): text is string => typeof text === 'string')
  await ui.unmount()
  return texts
}

const has = (texts: string[], part: string) => texts.some(text => text.includes(part))

const todoCall = ($: Engine, input: Record<string, unknown>) => $.tool.call({ tool: 'mcp__dashboard__todo', ...input })

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

const usageOf = (input: number, output: number, cacheRead: number, cacheWrite: number) => ({
  input_tokens: input,
  output_tokens: output,
  cache_read_input_tokens: cacheRead,
  cache_creation_input_tokens: cacheWrite,
  model: 'claude-opus-5-5',
})

// ---------------------------------------------------------------------------
// To-dos

test('the todo tool is registered only when the session has no built-in one', async ($, on) => {
  const { shown } = engine(on, { tools: ['Read', 'Bash'] })
  await start($)
  expect(shown.registered).toEqual(['todo'])
})

test('the todo tool is left out when TodoWrite exists', async ($, on) => {
  const { shown } = engine(on, { tools: ['Read', 'TodoWrite'] })
  await start($)
  expect(shown.registered).toEqual([])
})

test('the todo tool keeps the list, and the pane shows each item with its time', async ($, on) => {
  const { clock } = engine(on)
  await start($)

  await todoCall($, { action: 'set', items: ['read the types', 'write the mod', 'test it'] })
  await todoCall($, { action: 'start', id: 1 })
  await clock.advance(90_000)
  await todoCall($, { action: 'done', id: 1 })
  await todoCall($, { action: 'start', id: 2 })
  await clock.advance(12_000)
  await todoCall($, { action: 'add', text: 'ship it' })
  const removed = await todoCall($, { action: 'remove', id: 3 })
  expect(removed.result).toBe('1. [x] read the types\n2. [>] write the mod\n4. [ ] ship it')

  const failed = await todoCall($, { action: 'done', id: 9 })
  expect(String(failed.result)).toContain('No to-do has id 9.')

  for (const surface of SURFACES) {
    const texts = await lines($, surface)
    expect(has(texts, '1/3 33%')).toBe(true)
    expect(has(texts, '✔ read the types 1m30s')).toBe(true)
    expect(has(texts, '▶ write the mod 12s')).toBe(true)
    expect(has(texts, '○ ship it')).toBe(true)
  }
})

test('starting an item puts the one in progress back to pending', async ($, on) => {
  engine(on)
  await start($)
  await todoCall($, { action: 'set', items: ['a', 'b'] })
  await todoCall($, { action: 'start', id: 1 })
  const both = await todoCall($, { action: 'start', id: 2 })
  expect(both.result).toBe('1. [ ] a\n2. [>] b')
})

test('finishing the last item says so once', async ($, on) => {
  const { shown } = engine(on)
  await start($)
  await todoCall($, { action: 'set', items: ['a', 'b'] })
  await todoCall($, { action: 'done', id: 1 })
  await todoCall($, { action: 'done', id: 2 })
  await todoCall($, { action: 'list' })
  expect(shown.toasts.filter(text => text.includes('All 2 to-dos done'))).toHaveLength(1)
})

test('TodoWrite rewrites keep when each item started', async ($, on) => {
  const { clock } = engine(on, { tools: ['TodoWrite'] })
  on('tool.call', { tool: 'TodoWrite' }, (_$, e) => ({ result: { oldTodos: [], newTodos: e.todos } }))
  await start($)

  const write = (todos: { content: string; status: 'pending' | 'in_progress' | 'completed' }[]) =>
    $.tool.call({ tool: 'TodoWrite', todos: todos.map(item => ({ ...item, activeForm: item.content })) })
  await write([
    { content: 'plan', status: 'in_progress' },
    { content: 'build', status: 'pending' },
  ])
  await clock.advance(30_000)
  await write([
    { content: 'plan', status: 'completed' },
    { content: 'build', status: 'in_progress' },
  ])
  await clock.advance(5_000)

  const texts = await lines($)
  expect(has(texts, '1/2 50%')).toBe(true)
  expect(has(texts, '✔ plan 30s')).toBe(true)
  expect(has(texts, '▶ build 5s')).toBe(true)
})

test('TaskCreate and TaskUpdate calls of the main loop keep the list', async ($, on) => {
  engine(on, { tools: ['TaskCreate', 'TaskUpdate'] })
  let next = 0
  on('tool.call', { tool: 'TaskCreate' }, (_$, e) => ({ result: { task: { id: String(++next), subject: e.subject } } }))
  on('tool.call', { tool: 'TaskUpdate' }, (_$, e) => ({ result: { success: true, taskId: e.taskId, updatedFields: [] } }))
  await start($)

  await $.tool.call({ tool: 'TaskCreate', subject: 'first', description: 'first' })
  await $.tool.call({ tool: 'TaskCreate', subject: 'second', description: 'second' })
  await $.tool.call({ tool: 'TaskCreate', subject: 'third', description: 'third' })
  await $.tool.call({ tool: 'TaskUpdate', taskId: '1', status: 'completed' })
  await $.tool.call({ tool: 'TaskUpdate', taskId: '2', status: 'in_progress', subject: 'second, renamed' })
  await $.tool.call({ tool: 'TaskUpdate', taskId: '3', status: 'deleted' })

  const texts = await lines($)
  expect(has(texts, '1/2 50%')).toBe(true)
  expect(has(texts, '✔ first')).toBe(true)
  expect(has(texts, '▶ second, renamed')).toBe(true)
  expect(has(texts, 'third')).toBe(false)
})

// ---------------------------------------------------------------------------
// Model requests

test('a streamed response sets tokens, tok/s, the first-token wait, the cache and the window', async ($, on) => {
  const { clock } = engine(on)
  const used = usageOf(1_000, 100, 5_000, 200)
  on('turn.step', async function* (_$, e) {
    await clock.advance(1_500)
    yield { kind: 'text', index: 0, text: 'Hello' }
    await clock.advance(2_000)
    yield { kind: 'stop', stopReason: 'end_turn', usage: used }
    return { turnId: e.turnId, index: e.index, answer: 'Hello', toolUses: [], stopReason: 'end_turn', usage: used }
  })
  await start($)
  await step($)

  for (const surface of SURFACES) {
    const texts = await lines($, surface)
    expect(has(texts, '50.0 tok/s')).toBe(true)
    expect(has(texts, 'ttft 1.5s')).toBe(true)
    expect(has(texts, '3% 6.2k/200k')).toBe(true)
    expect(has(texts, 'in    6.2k  out 100  req 1')).toBe(true)
    expect(has(texts, 'read 79%')).toBe(true)
    expect(has(texts, '81% last · 81% avg')).toBe(true)
    expect(has(texts, '220/m')).toBe(true)
  }
})

test('a request that writes the cache back counts as a miss', async ($, on) => {
  engine(on)
  const answers = [usageOf(10, 50, 0, 40_000), usageOf(10, 50, 40_000, 1_000), usageOf(10, 50, 1_000, 41_000)]
  on('turn.step', async function* (_$, e) {
    const used = answers.shift()!
    yield { kind: 'stop', stopReason: 'end_turn', usage: used }
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: used }
  })
  await start($)
  await step($)
  await step($)
  expect(has(await lines($), 'miss')).toBe(false)
  await step($)
  expect(has(await lines($), '✗1 miss 40k')).toBe(true)
})

test('a subagent’s request counts toward tokens and its own row, not the window', async ($, on) => {
  engine(on, { agents: [{ id: 'a1', description: 'find callers', type: 'Explore', status: 'running' }] })
  const used = usageOf(10, 30, 0, 0)
  on('turn.step', async function* (_$, e) {
    yield { kind: 'stop', stopReason: 'end_turn', usage: used }
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: used }
  })
  await start($)
  await step($, 'a1')

  const texts = await lines($)
  expect(has(texts, 'in    10  out 30')).toBe(true)
  expect(has(texts, 'waiting for the first response')).toBe(true)
  expect(has(texts, 'Explore [Opus 5.5] find callers')).toBe(true)
  expect(has(texts, '1 running')).toBe(true)
})

// ---------------------------------------------------------------------------
// Tools, files and git

test('a tool in flight shows as running, then counts toward its tool', async ($, on) => {
  const { clock } = engine(on)
  let finish = () => {}
  on('tool.call', { tool: 'Bash' }, async (_$, e) => {
    if (e.command === 'false') return { isError: true, result: 'exit 1', text: 'exit 1' }
    await new Promise<void>(resolve => {
      finish = resolve
    })
    return { result: { stdout: '', stderr: '' } }
  })
  await start($)

  const call = $.tool.call({ tool: 'Bash', command: 'npm test' })
  await clock.advance(4_000)
  expect(has(await lines($), 'Bash npm test')).toBe(true)

  finish()
  await call
  await $.tool.call({ tool: 'Bash', command: 'false' })

  const texts = await lines($)
  expect(has(texts, 'Bash npm test')).toBe(false)
  expect(has(texts, '✗1')).toBe(true)
  expect(has(texts, '50% ok')).toBe(true)
})

test('an edit adds its lines to the file’s row', async ($, on) => {
  engine(on)
  on('tool.call', { tool: 'Edit' }, (_$, e) => ({
    result: {
      filePath: e.file_path,
      oldString: e.old_string,
      newString: e.new_string,
      originalFile: null,
      structuredPatch: [{ oldStart: 1, oldLines: 2, newStart: 1, newLines: 3, lines: [' a', '-b', '+c', '+d'] }],
      userModified: false,
      replaceAll: false,
    },
  }))
  await start($)
  await $.tool.call({ tool: 'Edit', file_path: '/repo/src/app.ts', old_string: 'b', new_string: 'c\nd' })
  await $.tool.call({ tool: 'Edit', file_path: '/repo/src/app.ts', old_string: 'b', new_string: 'c\nd' })

  const texts = await lines($)
  expect(has(texts, 'src/app.ts +4 −2')).toBe(true)
  expect(has(texts, '1 +4 −2')).toBe(true)
})

test('the header reads the model, the session clock and the working tree', async ($, on) => {
  engine(on, {
    gitStatus: [
      '# branch.oid abc',
      '# branch.head main',
      '# branch.upstream origin/main',
      '# branch.ab +1 -0',
      '1 M. N... 100644 100644 100644 a b src/a.ts',
      '1 .M N... 100644 100644 100644 a b src/b.ts',
      '1 .M N... 100644 100644 100644 a b src/c.ts',
      '? notes.md',
    ].join('\n'),
    gitDiff: ' 3 files changed, 12 insertions(+), 4 deletions(-)\n',
  })
  await start($)

  const texts = await lines($)
  expect(has(texts, '⎇ main ↑1 ●1 ✚2 …1')).toBe(true)
  expect(has(texts, '+12 −4')).toBe(true)
  expect(has(texts, '✻ Opus 5.5')).toBe(true)
  expect(has(texts, '⏱ 1h05m')).toBe(true)
})

test('outside a git repository the header leaves the branch out', async ($, on) => {
  engine(on)
  await start($)
  expect(has(await lines($), '⎇')).toBe(false)
})

// ---------------------------------------------------------------------------
// Context, limits and alerts

test('the window breaks down by content and warns once past 80%', async ($, on) => {
  const { shown } = engine(on)
  await start($)
  const measure = (tokens: number) =>
    $.session.measure({
      context: { tokens, window: 200_000, percent: Math.round((tokens / 200_000) * 100) },
      rateLimits: [],
      changed: ['context'],
    })

  await measure(12_000)
  const texts = await lines($)
  expect(has(texts, '■ system 3k')).toBe(true)
  expect(has(texts, '■ messages 9k')).toBe(true)
  expect(has(texts, 'compact at 80%')).toBe(true)

  await measure(150_000)
  expect(has(await lines($), '▲ 10k to compact')).toBe(true)

  await measure(170_000)
  await measure(172_000)
  await measure(20_000)
  await measure(166_000)
  expect(shown.toasts.filter(text => text.startsWith('Context'))).toEqual(['Context 85% full', 'Context 83% full'])
})

test('a compaction counts with the tokens it reclaimed', async ($, on) => {
  engine(on)
  const summary = [{ role: 'user' as const, text: 'summary', toolUses: [] }]
  on('session.compact', () => ({ messages: summary, tokensBefore: 150_000, tokensAfter: 30_000 }))
  await start($)
  await $.session.measure({ context: { tokens: 30_000, window: 200_000, percent: 15 }, rateLimits: [], changed: ['context'] })
  await $.session.compact({ trigger: 'auto', messages: summary })
  expect(has(await lines($), '⟳ compacted 1× · reclaimed 120k')).toBe(true)
})

test('rate-limit windows show their fill, pace, reset and when they fill, and warn once per step', async ($, on) => {
  const resetsAt = new Date(START + 2.5 * 3600_000).toISOString()
  const { shown } = engine(on)
  await start($)
  const measure = (percentUsed: number) =>
    $.session.measure({
      context: { window: 200_000 },
      rateLimits: [
        { kind: 'five_hour', percentUsed, resetsAt },
        { kind: 'seven_day', percentUsed: 18 },
      ],
      changed: ['rateLimits'],
    })

  await measure(92)
  const texts = await lines($)
  expect(has(texts, '92% ◆')).toBe(true)
  expect(has(texts, '↻2h30m')).toBe(true)
  expect(has(texts, '▲ pace → 184% at reset · full in 13m02s')).toBe(true)
  expect(has(texts, ' 18%')).toBe(true)

  await measure(93)
  await measure(96)
  expect(shown.toasts.filter(text => text.startsWith('5-hour'))).toEqual(['5-hour limit 92% used', '5-hour limit 96% used'])
})

test('a window that warned in an earlier session stays quiet until it resets', async ($, on) => {
  const resetsAt = new Date(START + 3600_000).toISOString()
  const { shown } = engine(on, {
    store: { limitAlerts: [{ key: `five_hour@${resetsAt}:90`, until: START + 3600_000 }] },
  })
  await start($)
  const measure = (percentUsed: number, at: string) =>
    $.session.measure({
      context: { window: 200_000 },
      rateLimits: [{ kind: 'five_hour', percentUsed, resetsAt: at }],
      changed: ['rateLimits'],
    })
  await measure(91, resetsAt)
  expect(shown.toasts).toEqual([])
  await measure(91, new Date(START + 6 * 3600_000).toISOString())
  expect(shown.toasts).toEqual(['5-hour limit 91% used'])
})

test('the status line stands in for the pane while it is out of sight', async ($, on) => {
  const { shown } = engine(on, { usd: 0.42 })
  await start($)
  await todoCall($, { action: 'set', items: ['a', 'b', 'c'] })
  await todoCall($, { action: 'done', id: 1 })
  await $.session.measure({
    context: { tokens: 62_000, window: 200_000, percent: 31 },
    rateLimits: [],
    cost: { usd: 0.42 },
    changed: ['context', 'cost'],
  })
  expect(shown.status[shown.status.length - 1]).toBe('ctx 31% · ☑ 1/3 · $0.42')
})

test('the status line stays empty while the pane is shown', async ($, on) => {
  const { shown } = engine(on, {
    panes: [{ id: 'dashboard', title: 'Dashboard', isShown: true, isFocused: false, isPlaced: true }],
  })
  await start($)
  await todoCall($, { action: 'set', items: ['a'] })
  expect(shown.status[shown.status.length - 1]).toBeUndefined()
})

// ---------------------------------------------------------------------------
// Folding and resets

test('a section header folds its section', async ($, on) => {
  engine(on)
  await start($)
  await todoCall($, { action: 'set', items: ['visible item'] })

  const ui = await mount($, 'terminal')
  await ui.press({ key: 'fold-todo' })
  const texts = (await ui.findAll({ type: 'Text' })).map(element => element.text ?? '')
  expect(texts.some(text => text.includes('visible item'))).toBe(false)
  await ui.unmount()
})

test('a section folded in an earlier session starts folded', async ($, on) => {
  engine(on, { store: { collapsed: ['todo'] } })
  await start($)
  await todoCall($, { action: 'set', items: ['visible item'] })
  const texts = await lines($)
  expect(has(texts, 'visible item')).toBe(false)
  expect(has(texts, '▸ TO-DO')).toBe(true)
})

test('a /clear empties the list and the counts', async ($, on) => {
  engine(on)
  await start($)
  await todoCall($, { action: 'set', items: ['a'] })
  await $.session.measure({ context: { tokens: 50_000, window: 200_000, percent: 25 }, rateLimits: [], changed: ['context'] })
  expect(has(await lines($), '25% 50k/200k')).toBe(true)

  await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })

  const texts = await lines($)
  expect(texts).toContain('No to-dos.')
  expect(has(texts, 'waiting for the first response')).toBe(true)
})
