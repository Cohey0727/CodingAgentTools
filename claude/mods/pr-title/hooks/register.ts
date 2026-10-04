import type { Register } from 'claude-code'

const PR_CREATE = /\bgh\s+pr\s+create\b/
// gh pr create prints the new PR's URL on stdout.
const PR_URL = /https:\/\/\S+\/pull\/\d+/

// A tool.call hook holds its turn, so $.command.run refuses to run /rename
// from there; the name waits for the main loop's turn to end.
let pendingName: string | null = null

export const register: Register = on => {
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny !== undefined || ran.isError === true || !PR_CREATE.test(e.command)) return ran
    const url = ran.result.stdout.match(PR_URL)?.[0]
    if (url === undefined) return ran

    const view = await $.process.run(['gh', 'pr', 'view', url, '--json', 'number,title', '--jq', '"#\\(.number) \\(.title)"'])
    const name = view.stdout.trim()
    if (view.exitCode !== 0 || name === '') return ran

    pendingName = name
    const pane = await $.env.get('TMUX_PANE')
    if (pane !== undefined) await $.process.run(['tmux', 'rename-window', '-t', pane, name])
    return ran
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined && pendingName !== null) {
      const name = pendingName
      pendingName = null
      $.command.run({ command: 'rename', args: name }).catch((err: unknown) => $.ui.toast(`pr-title: /rename failed: ${String(err)}`))
    }
    return next(e)
  })
}
