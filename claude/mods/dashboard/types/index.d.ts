export type TodoStatus = 'pending' | 'in_progress' | 'completed'

// `startedAt` is when it first went in progress, `completedAt` when it was done.
export type Todo = {
  id: string
  text: string
  status: TodoStatus
  startedAt: number | null
  completedAt: number | null
}

// Summed over every model request of the session, subagents' included.
export type Tokens = {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  requests: number
}

// Output tokens per second of the main loop's responses: `last` from the
// API's count once a response ends, `live` estimated while one streams;
// `ttft` the wait for the first token of the latest response.
export type Speed = {
  last: number | null
  live: number | null
  peak: number | null
  ttft: number | null
  history: number[]
}

export type ContextSlice = { name: string; tokens: number; kind: 'used' | 'free' | 'buffer' | 'deferred' }

// The input side of the main loop's latest request against the model's
// window; `history` holds that fill in percent, one value per request.
export type Context = {
  tokens: number | null
  window: number | null
  compactAt: number | null
  slices: ContextSlice[]
  history: number[]
  compactions: number
  reclaimed: number
}

// The prompt cache as the main loop's requests met it. A miss is a request
// that wrote back to the cache more than the conversation grew by; the TTL
// is learned from a hit after a long pause.
export type Cache = {
  lastHit: number | null
  misses: number
  lastMiss: number | null
  lastPrompt: number | null
  lastAt: number | null
  isLongTtl: boolean
}

export type RateLimit = { kind: string; percentUsed: number; resetsAt: string | null }

// What the session cost and the account's rate-limit windows, as the status
// line has them; `samples` keeps the cost over time for the burn rate.
export type Spend = {
  usd: number | null
  samples: { at: number; usd: number }[]
  turnUsd: number | null
  limits: RateLimit[]
  limitsAt: number | null
}

// Input and output tokens of every request (cache reads left out, as ccusage
// counts a burn rate), bucketed by the minute they arrived in.
export type Burn = { minute: number; tokens: number }[]

// The main loop's turns; `apiMs` and `toolMs` split where its time went.
export type Turn = {
  runningSince: number | null
  steps: number
  tools: number
  count: number
  lastMs: number | null
  totalMs: number
  apiMs: number
  toolMs: number
  topic: string | null
}

export type ToolStat = { name: string; count: number; errors: number; ms: number }

export type RunningTool = { id: string; name: string; detail: string; since: number; agentId: string | null }

export type Agent = {
  id: string
  type: string
  description: string
  status: string
  model: string | null
  startedAt: number
  endedAt: number | null
  tokens: number
  requests: number
}

export type FileEdit = { path: string; added: number; removed: number; edits: number; at: number }

// The main loop's model as /model shows it, the effort its requests ask for,
// and when the session began.
export type SessionInfo = { name: string | null; effort: string | null; startedAt: number | null }

export type GitState = {
  branch: string | null
  ahead: number
  behind: number
  staged: number
  modified: number
  untracked: number
  conflicts: number
  added: number
  removed: number
  checkedAt: number
}

declare module 'claude-code' {
  interface PluginState {
    dashboard: {
      todos: Todo[]
      tokens: Tokens
      speed: Speed
      context: Context
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
      collapsed: string[]
      alerts: string[]
      isClosed: boolean
    }
  }
}
