import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

const PR_URL = 'https://github.com/owner/repo/pull/42'

// The engine's side: Bash answers with `stdout`, gh with the PR's number and
// title, and every command the mod starts and every /rename it runs is kept.
function engine(on: On, stdout: string, env: Record<string, string> = { TMUX_PANE: '%7' }) {
  const runs: string[][] = []
  const renames: string[] = []
  mock.env(on, env)
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout, stderr: '', interrupted: false } }))
  on('process.run', (_$, e) => {
    runs.push([...e.argv])
    const out = e.argv[0] === 'gh' ? '#42 feat: add login\n' : ''
    return { value: { exitCode: 0, stdout: out, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('command.run', { command: 'rename' }, (_$, e) => {
    renames.push(e.args)
    return { text: '' }
  })
  return { runs, renames }
}

const bash = ($: Engine, command: string) => $.tool.call({ tool: 'Bash', command })

const endTurn = ($: Engine, agentId?: string) =>
  $.turn.complete({
    answer: 'done',
    durationMs: 1_000,
    isAborted: false,
    turnId: 't1',
    reason: 'answer',
    ...(agentId === undefined ? {} : { agentId }),
  })

test('a PR gh pr create opened names the tmux window, then the session once the turn ends', async ($, on) => {
  const { runs, renames } = engine(on, `${PR_URL}\n`)
  await bash($, 'gh pr create --title "feat: add login" --body "..."')
  expect(runs).toContainEqual(['tmux', 'rename-window', '-t', '%7', '#42 feat: add login'])
  expect(renames).toEqual([])

  await endTurn($)
  expect(renames).toEqual(['#42 feat: add login'])

  await endTurn($)
  expect(renames).toEqual(['#42 feat: add login'])
})

test('a subagent’s turn ending leaves the name for the main loop’s', async ($, on) => {
  const { renames } = engine(on, `${PR_URL}\n`)
  await bash($, 'gh pr create --fill')
  await endTurn($, 'a1')
  expect(renames).toEqual([])
  await endTurn($)
  expect(renames).toEqual(['#42 feat: add login'])
})

test('outside tmux only the session is named', async ($, on) => {
  const { runs, renames } = engine(on, `${PR_URL}\n`, {})
  await bash($, 'gh pr create --fill')
  await endTurn($)
  expect(renames).toEqual(['#42 feat: add login'])
  expect(runs.some(argv => argv[0] === 'tmux')).toBe(false)
})

test('a command other than gh pr create names nothing', async ($, on) => {
  const { runs, renames } = engine(on, `${PR_URL}\n`)
  await bash($, 'gh pr view --json url')
  await endTurn($)
  expect(renames).toEqual([])
  expect(runs).toEqual([])
})

test('gh pr create that printed no PR URL names nothing', async ($, on) => {
  const { runs, renames } = engine(on, 'a pull request for branch "x" already exists\n')
  await bash($, 'gh pr create --fill')
  await endTurn($)
  expect(renames).toEqual([])
  expect(runs).toEqual([])
})
