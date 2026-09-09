# CodingAgentTools

> Run Claude Code, OpenCode and pi on Anthropic-compatible LLM backends (DeepSeek · MiniMax · GLM · Kimi · MiMo · your own llama.cpp) — one repo, one `make setup`, one `.env` per provider driving all three CLIs, and the skills and global instruction file all three share.

One repo that installs a `claude<name>` launcher command per provider and generates the pi and OpenCode configs covering every provider — [Claude Code](https://docs.anthropic.com/claude-code), [OpenCode](https://opencode.ai) and the [pi coding agent](https://pi.dev), all against Anthropic-compatible backends:

| Provider | Command | Endpoint | Flagship model |
|----------|----------|----------|----------------|
| DeepSeek | `claudedeepseek` | `https://api.deepseek.com/anthropic` | `deepseek-v4-pro` |
| MiniMax  | `claudemmx` | `https://api.minimax.io/anthropic` | `MiniMax-M3` |
| GLM (Z.ai) | `claudeglm` | `https://api.z.ai/api/anthropic` | `glm-5.3` |
| Kimi (Moonshot) | `claudekimi` | `https://api.kimi.com/coding` | `kimi-k3` |
| MiMo (Xiaomi) | `claudemimo` | `https://token-plan-sgp.xiaomimimo.com/anthropic` | `mimo-v2.5-pro` |
| Local (llama.cpp) | `claudelocal` | `http://127.0.0.1:11301` | `default` |
| gtr (llama.cpp behind Cloudflare) | `claudegtr` | `https://gtr-llama.spaghetti-monster.com` | `default` |

OpenCode and pi have no per-provider command: `make setup` writes every provider into their global configs, so a bare `opencode` gets them all under `/models` and a bare `pi` under `/model`.

Kimi and MiMo run that flagship as its 1M-context variant under Claude Code (`kimi-k3[1m]`); OpenCode and pi take the plain id.

Each provider exposes a native Anthropic-compatible endpoint, so there is no proxy or translation layer — just environment variables. That holds for the local one too: `llama-server` answers `/v1/messages` in the Anthropic shape. The generated pi and OpenCode configs run against the very same endpoint and token: everything for a provider comes from the single `providers/<name>/.env`.

> **Note:** every launcher command is `claude<name>`. Bare provider names are deliberately avoided: `kimi` is Moonshot's official Kimi CLI, `minimax` is the official MiniMax Code desktop app command, and `mmx` is an unrelated bun-installed tool. MiniMax uses the short name `mmx` (`claudemmx`).

> **Note:** Kimi has two endpoints. The default `https://api.kimi.com/coding` is for the **coding subscription plan**. For **pay-as-you-go (metered) billing**, switch `BASE_URL` to `https://api.moonshot.ai/anthropic` in `providers/kimi/.env`.

> **Note:** Local is not a hosted service — it points at a `llama-server` on your own machine, which serves the Anthropic shape on `/v1/messages`. Here that server is LlamaGate (`~/Workspace/LlamaGate`): `just start` brings it up on `127.0.0.1:11301`, `just profiles` lists the models it can load and `just start <profile>` swaps to one. There is no account and no key, so `API_TOKEN` is a placeholder the CLIs merely require to be non-empty. Both llama.cpp providers use the fixed model id `default`: llama-server answers with whatever it has loaded and ignores the requested name, so swapping the model on the server needs no edit here. Keep `CONTEXT_WINDOW` at or below the server's `--ctx-size`.

> **Note:** MiMo has three endpoints. The default `https://token-plan-sgp.xiaomimimo.com/anthropic` is the **global Token Plan subscription** endpoint (tokens start with `tp-`). China accounts use `https://token-plan-cn.xiaomimimo.com/anthropic` instead, and **pay-as-you-go (metered) billing** (keys start with `sk-`) uses `https://api.xiaomimimo.com/anthropic` — switch `BASE_URL` in `providers/mimo/.env` accordingly. Note the docs mostly mention only the CN host; the `-sgp` host is what actually accepts global-plan tokens.

> **Note:** gtr is a `llama-server` on another machine, published through a Cloudflare tunnel and gated by Cloudflare Access. Requests without Access credentials get a 302 to the login page, so `HEADERS` in `providers/gtr/.env` has to carry an Access service token (`CF-Access-Client-Id` / `CF-Access-Client-Secret`) — the comments in the file show both that and the short-lived `cloudflared access token` variant. Like Local, `API_TOKEN` is only a placeholder unless `llama-server` runs with `--api-key`.

The other half of the repo is what those CLIs run *with*: the skills under `skills/` and the single global instruction file `AGENTS.md`, symlinked into every CLI's config directory by the same `make setup` — see [Skills and global instructions](#skills-and-global-instructions).

## Layout

```
AGENTS.md                        # the one global instruction file, linked into every CLI
skills/<name>/SKILL.md           # a skill, linked into ~/.claude/skills and ~/.agents/skills
agents/<name>.md                 # a subagent, linked into ~/.claude/agents and ~/.agents/agents
opencode/command/<name>.md       # an OpenCode slash command, linked into ~/.config/opencode/command
opencode/plugin/<name>.js        # an OpenCode plugin, reached from a shim in ~/.config/opencode/plugin
providers/<name>/.env            # all provider settings: key, endpoint, models (gitignored, chmod 600)
providers/<name>/.env.example    # same file with an empty API_TOKEN (in git)
bin/ui.sh                        # banner, colors and the output helpers every script shares
bin/common.sh                    # shared settings resolution (generic setting <- CLI override)
bin/launcher.template            # Claude Code launcher; @@PROVIDER_DIR@@ baked in at setup time
bin/opencode-plugin.template     # OpenCode plugin shim; @@IMPL@@ baked in at setup time
bin/setup.sh                     # provider wizard: pick providers, paste tokens, install (`make setup-providers`)
bin/pi-global-models.sh          # registers every provider in pi's global models.json (`make pi-global`)
bin/opencode-global-config.sh    # registers every provider in OpenCode's global config (`make opencode-global`)
bin/skills-common.sh             # where skills, subagents, AGENTS.md and the OpenCode extensions are installed
bin/skills-setup.sh              # links them there (`make setup-skills`)
bin/skills-list.sh               # their install status (part of `make list`)
bin/skills-uninstall.sh          # removes only the symlinks pointing back here (part of `make uninstall`)
bin/list.sh                      # everything this repo manages (`make list`)
bin/help.sh                      # target overview (`make help`)
docs/migrations/                 # upgrade notes for existing checkouts
Makefile                         # setup / setup-providers / setup-skills / list / uninstall / pi-global / opencode-global / help
```

Adding a provider is just a new `providers/<name>/` folder with a `.env.example`; adding a skill is a new `skills/<name>/SKILL.md` and a `make setup-skills`. An OpenCode slash command is a new `opencode/command/<name>.md`, and a plugin a new `opencode/plugin/<name>.js` exporting `plugin({ tool })` — same `make setup-skills`.

## Requirements

- macOS / Linux with `bash` and `make`
- [Claude Code](https://docs.anthropic.com/claude-code) (`claude` on your PATH)
- [OpenCode](https://opencode.ai) (`opencode` on your PATH) — only OpenCode itself; it gets no launcher, just the generated config. Not bundled by this repo; install it first:
  ```bash
  brew install sst/tap/opencode          # macOS (Homebrew)
  # or
  npm install -g opencode-ai
  # or
  curl -fsSL https://opencode.ai/install | bash
  ```
- [pi](https://pi.dev) (`pi` on your PATH) — only pi itself; like OpenCode it gets no launcher, just the generated `models.json`. Not bundled by this repo either:
  ```bash
  curl -fsSL https://pi.dev/install.sh | sh
  ```
  (the older `@mariozechner/pi-coding-agent` package is deprecated and resolves environment references differently)
- An API key for whichever provider(s) you use

## Setup

```bash
make setup
```

One interactive wizard does everything:

1. Check the providers you want (arrows + Space, Enter to confirm — providers that already have a token are pre-checked)
2. Paste each API token — an empty answer keeps the existing token
3. Each provider's `.env` is created from `.env.example` if missing (`chmod 600`); an existing `.env` gets any settings that were added to `.env.example` since, appended with their comments and your token untouched
4. One command per provider is generated in `~/.local/bin` — `claude<NAME>`, with the provider folder path baked in
5. The pi packages that add [`/loop` and `/goal`](#loops-in-pi) are installed once into pi's user settings (`~/.pi/agent/settings.json`)
6. Every provider with a token is registered in pi's global `~/.pi/agent/models.json` (the token stays in `.env`, read back by a shell command at request time) and in OpenCode's global config (`~/.config/opencode/opencode.json`); both start on [the default provider](#default-provider), and in OpenCode's case its token is copied to `~/.config/opencode/claude-compatibles/` (chmod 600) and only referenced from the config
7. You get a warning if `~/.local/bin`, `claude`, `opencode` or `pi` is missing from your PATH
8. Every skill, every subagent and `AGENTS.md` are symlinked into the places each CLI reads them from, and OpenCode gets this repo's slash commands and plugins — [`/goal`](#goals-in-opencode) among them — in `~/.config/opencode` ([details below](#skills-and-global-instructions))

To rotate a token, pick up new settings or add a provider later, just re-run `make setup`. `make setup-providers` and `make setup-skills` each run one half on its own; only the provider half prompts.

Coming from an older checkout? `docs/migrations/` has the per-variable
mapping — see [2026-08-15 — pi 対応と `.env` の共通設定化](docs/migrations/2026-08-15-shared-env-settings.md),
[2026-08-15 — GLM-5.3](docs/migrations/2026-08-15-glm-5.3.md),
[2026-08-24 — OpenCode ランチャー廃止とグローバル設定生成](docs/migrations/2026-08-24-opencode-global-config.md),
[2026-09-03 — pi ランチャー廃止とグローバル models.json 生成](docs/migrations/2026-09-03-pi-global-models.md),
[2026-09-05 — OpenCode の lean エージェント](docs/migrations/2026-09-05-opencode-lean-agent.md),
[2026-09-08 — claude-code-settings の統合](docs/migrations/2026-09-08-merge-claude-code-settings.md),
[2026-09-08 — OpenCode の `/goal`](docs/migrations/2026-09-08-opencode-goal.md),
and [2026-09-09 — GLM の軽量モデルと ox 廃止](docs/migrations/2026-09-09-glm-flash-and-ox-removal.md).

### Make targets

| Target | What it does |
|--------|--------------|
| `make setup` | Both halves: the provider wizard, then the skill, `AGENTS.md` and OpenCode extension install |
| `make setup-providers` | The wizard above only: tokens, `.env` upkeep, launcher install, pi packages, pi and OpenCode global configs |
| `make setup-skills` | The shared assets only: `skills/`, `agents/`, `AGENTS.md` and `opencode/` into every agent CLI |
| `make list` | Every provider with its command and endpoint, then every skill, subagent and OpenCode extension with its install status |
| `make pi-global` | Re-generate pi's global `~/.pi/agent/models.json` from the current `.env` files, and set the startup model in `~/.pi/agent/settings.json` — run it after changing a model or endpoint |
| `make opencode-global` | Re-generate OpenCode's global config from the current `.env` files — run it after editing one |
| `make uninstall` | Remove the installed launchers (including the `pi<name>` / `open<name>` ones earlier versions installed), the pi packages from `$PI_PACKAGES`, the global `models.json` / OpenCode config / token files this repo wrote, the symlinks pointing back into this repo and the plugin shims generated from it. Provider `.env` files are left alone |
| `make help` | The target list above, on the terminal |

## Usage

```bash
claudedeepseek    # Claude Code on DeepSeek
claudemmx         # Claude Code on MiniMax
claudeglm         # Claude Code on GLM (Z.ai)
claudekimi        # Claude Code on Kimi (Moonshot)
claudemimo        # Claude Code on MiMo (Xiaomi)
claudegtr         # Claude Code on gtr (llama.cpp behind Cloudflare)

opencode          # OpenCode — every configured provider is in /models
pi                # pi — every configured provider is in /model
```

Arguments pass through to `claude` verbatim, `--model` included — so a launcher
is not pinned to the `MODEL` in its `.env`, and any id the provider serves works
for one run:

```bash
claudeglm --help
claudedeepseek -p "Review my TypeScript type definitions"
claudeglm --model glm-5.3-flash            # the cheap model for a whole session
```

That covers the main slot only; the haiku and subagent slots keep following
`SMALL_MODEL`. In-session `/model <id>` does the same thing.

pi has no `pi<name>` commands. `make setup` (and `make pi-global`) write every provider that has a token into `~/.pi/agent/models.json`, so a bare `pi` has all of them and `/model` switches mid-session:

```bash
pi                                         # starts on the default provider's model
pi --model glm/glm-5.3                     # or pick at launch time
```

Both generators start you on the same provider, `glm` by default; see [Default provider](#default-provider). For pi that means `defaultProvider` / `defaultModel` in `~/.pi/agent/settings.json`, the two keys Ctrl+S in `/model` writes — so a re-run replaces a pick you saved there. The rest of that file is left as it is. Writing them needs `python3`; without it the two keys are skipped and pi starts wherever it was.

OpenCode has no `open<name>` commands. `make setup` (and `make opencode-global`) write every provider that has a token into the global `~/.config/opencode/opencode.json`, so a bare `opencode` starts with all of them and `/models` switches mid-session:

```bash
opencode                                   # starts on the default provider's model
opencode --model glm-anthropic/glm-5.3     # or pick at launch time
```

Note `small_model`, which serves OpenCode's lightweight internal calls, stays at the default even after you switch the main model via `/models`.

### Default provider

pi and OpenCode both start on `DEFAULT_PROVIDER`, which is `glm`. When that provider has no token the first configured one wins instead, alphabetically, so a fresh checkout still gets a working default. Change it for one run or for good:

```bash
DEFAULT_PROVIDER=gtr make setup            # both configs
DEFAULT_PROVIDER=gtr make opencode-global  # just OpenCode
```

It sets OpenCode's `model` and `small_model`, and pi's `defaultProvider` / `defaultModel`. Claude Code has no such setting: each `claude<name>` pins its own provider.

### Loops in pi

pi keeps its core small and ships no loop of its own — nor sub-agents, MCP,
plan mode or to-dos. Everything of that kind lives in
[pi packages](https://pi.dev/packages), so `make setup` installs two of them
and pi can iterate unattended the way Claude Code's
`/loop` and `/goal` do:

| Package | Adds | What it does |
|---------|------|--------------|
| [`npm:@realvendex/pi-loop`](https://github.com/ZachDreamZ/pi-loop) | `/loop` | Repeat a prompt until a stop condition: `--max N`, `--until "TEXT"`, `--until-stable N` (convergence), `--timeout 5m`, `--yes` for autopilot |
| `npm:pi-goal` | `/goal` | A persistent objective the agent keeps working on across turns until it is complete, paused, or out of budget |

```
/loop "make the tests pass" --until-stable 2 --max 20
/goal "port the CLI flags to the new parser"
```

They go into pi's user settings (`~/.pi/agent/settings.json`). Install a
different set by overriding `PI_PACKAGES` with `<source>=<slash command>`
pairs — an empty command just leaves the label off:

```bash
PI_PACKAGES="npm:pi-reactor=/reactor npm:pi-loop-police=" make setup
```

> **Note:** pi packages run with full system access and the registry is not
> curated. Both packages above are third-party npm packages — read the source
> before trusting them with an unattended loop, and prefer a container or a
> throwaway checkout for autopilot runs.

### Goals in OpenCode

OpenCode runs one turn per message and then waits, so `/goal` is this repo's
own: `opencode/command/goal.md` is the slash command and
`opencode/plugin/goal.js` the loop behind it, both installed by
`make setup-skills`. It gives OpenCode what `npm:pi-goal` gives pi — a
persistent objective the session keeps working on across turns:

```
/goal port the CLI flags to the new parser, verified by the existing tests
/goal --tokens 50k finish the migration and verify the suite
/goal --turns 10 make the flaky checkout test deterministic
/goal                         show the current goal
/goal pause | resume | clear  control it
```

Setting a goal replaces the message OpenCode would have sent with the objective
and the rules of the loop; every time the session goes idle the plugin sends the
next continuation, with the objective and the budget spent so far. It stops when

- the model calls the `goal_finish` tool — `complete` with the evidence, or
  `blocked` with what would unblock it. That tool is the only way the model can
  end the loop itself
- you run `/goal pause` or `/goal clear`
- the budget runs out: `--turns` (40 by default) or `--tokens`
- the turn was aborted or errored, or opencode was restarted — a goal from an
  earlier process is paused rather than resumed behind your back, and
  `/goal resume` picks it up

Goal state is one JSON file per session under
`~/.local/share/opencode-goal/`, so it survives compaction and a `/goal status`
in between; files older than 30 days are pruned on startup.

> **Note:** an active goal keeps the model working on its own, and the
> continuation turns run tools like any other turn. OpenCode still asks for
> permission unless you started it with `--auto` — the pairing to be careful
> with is `--auto` plus an open-ended objective. `opencode --pure` starts
> without any external plugin, this one included, if a session ever needs to
> run with the loop out of the picture entirely.

## `.env` settings

Each provider has exactly one settings file: `providers/<name>/.env`, and one
set of generic settings in it drives all three CLIs. A provider is roughly ten
lines:

```bash
NAME=deepseek
API_TOKEN=sk-...
BASE_URL=https://api.deepseek.com/anthropic
MODEL=deepseek-v4-pro
SMALL_MODEL=deepseek-v4-flash
CONTEXT_WINDOW=1000000
MAX_TOKENS=384000
REASONING=true
INPUT=text
ARGS=
```

| Setting | Meaning |
|---------|---------|
| `NAME` | Command-name suffix: the launcher is installed as `claude<NAME>` |
| `API_TOKEN` | **Required.** Your provider API key |
| `BASE_URL` | Provider's Anthropic-compatible endpoint |
| `MODEL` | Fills every main model slot: Claude Code's opus / sonnet / fable, OpenCode's `model` in the generated global config, the model pi starts on |
| `SMALL_MODEL` | Fills every cheap slot: Claude Code's haiku + subagent, OpenCode's `small_model`, pi's second Ctrl+P entry. Defaults to `MODEL` |
| `OPENCODE_EXTRA_MODELS` | Extra model ids OpenCode lists on top of `MODEL` / `SMALL_MODEL`, space-separated. Claude Code and pi reach another model with `--model`; OpenCode has no launcher to pass one, so an id missing from the generated config cannot be picked there. Empty by default |
| `CONTEXT_WINDOW`, `MAX_TOKENS` | Model limits. pi writes them into its generated `models.json` (it otherwise assumes 128k / 16k and caps each request at `MAX_TOKENS`/3), and Claude Code takes `CONTEXT_WINDOW` as its auto-compact window |
| `SMALL_CONTEXT_WINDOW`, `SMALL_MAX_TOKENS` | The same two limits for `SMALL_MODEL` when it is a different size. Default to the values above |
| `REASONING`, `INPUT` | Whether the models support extended thinking (`true`/`false`) and what they accept (`text` or `text,image`) |
| `HEADERS` | Optional extra request headers, one `Name: Value` per line (the format Claude Code's `ANTHROPIC_CUSTOM_HEADERS` takes), sent by all three CLIs — e.g. a Cloudflare Access service token in front of a self-hosted server. The value is a bash string, so a multi-line double-quoted value or a `$(...)` computed at launch both work |
| `ARGS` | Default CLI options prepended to every `claude<NAME>` launch (word-split; your command-line arguments come after them). OpenCode and pi have no launcher, so it does not reach them |

### Overrides

Every generic setting has a CLI-specific override that wins when set. They all
ship commented out in `.env.example`, with the default they replace written
above them — uncomment one only when a CLI has to differ from the rest.

| Override | Overrides | Read by |
|----------|-----------|---------|
| `COMMAND` | the `claude<NAME>` command name | `make setup` |
| `CLAUDE_ARGS` | `ARGS` | the launcher |
| `ANTHROPIC_AUTH_TOKEN` | `API_TOKEN` | all three |
| `ANTHROPIC_BASE_URL` | `BASE_URL` | all three |
| `ANTHROPIC_MODEL`, `ANTHROPIC_DEFAULT_{OPUS,SONNET,HAIKU,FABLE}_MODEL`, `CLAUDE_CODE_SUBAGENT_MODEL` | the model slots Claude Code fills from `MODEL` / `SMALL_MODEL` | Claude Code |
| `OPENCODE_MODEL`, `OPENCODE_SMALL_MODEL` | `MODEL` / `SMALL_MODEL` for OpenCode | the OpenCode global config |
| `OPENCODE_CONTEXT_WINDOW`, `OPENCODE_MAX_TOKENS` | `CONTEXT_WINDOW` / `MAX_TOKENS` for OpenCode. These are the window a session may grow into before OpenCode compacts it, so a backend too slow to prefill its full context sets them lower — `gtr` does | the OpenCode global config |
| `OPENCODE_LEAN` | nothing — `true` gives the provider [a lean agent of its own](#lean-agents) | the OpenCode global config |
| `PI_MODEL`, `PI_SMALL_MODEL` | `MODEL` / `SMALL_MODEL` for pi | the pi global models.json |
| `CLAUDE_MODEL_SUFFIX` | nothing — appends a Claude Code-only marker such as `[1m]` to every Claude Code model slot. Kimi and MiMo use it; OpenCode and pi keep sending plain ids | Claude Code |
| `CLAUDE_CODE_AUTO_COMPACT_WINDOW` | `CONTEXT_WINDOW` | Claude Code |
| `ANTHROPIC_CUSTOM_HEADERS` | `HEADERS` | Claude Code |

Any extra `KEY=VALUE` line you add is exported to `claude` as well — that is
how `CLAUDE_CODE_EFFORT_LEVEL` and `ENABLE_TOOL_SEARCH` are set.

## How it works

Each installed command is the same thin shell script with the provider folder
and `bin/common.sh` paths baked in. `common.sh` sources the `.env` (`set -a`,
so extras are exported as-is), resolves the generic settings — override first,
generic second — and fails fast when `API_TOKEN`, `BASE_URL` or `MODEL` is
empty.

`claude<name>` exports the variables Claude Code itself reads:
`ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL`, the five model slots (each
`MODEL`/`SMALL_MODEL` plus `CLAUDE_MODEL_SUFFIX`) and
`CLAUDE_CODE_AUTO_COMPACT_WINDOW`; drops the launcher-only settings and
`ANTHROPIC_API_KEY` (it would otherwise shadow `AUTH_TOKEN`); and `exec`s
`claude $ARGS "$@"`.

`opencode` gets no launcher. `make setup` (and `make opencode-global`) write
every provider that has a token into the global
`~/.config/opencode/opencode.json` — the same `<name>-anthropic` custom
`@ai-sdk/anthropic` providers, `baseURL` set to `<BASE_URL>/v1` (the AI SDK
appends `/messages`, landing on the same `/v1/messages` route Claude Code
uses), so `/models` lists every provider's `MODEL` and `SMALL_MODEL`. Tokens
stay out of the file: each entry's `apiKey` is a `{file:...}` reference to a
per-provider token file under `~/.config/opencode/claude-compatibles/`
(chmod 600) written from the `.env` at the same time — `.env` stays the single
source of truth, but after rotating a token re-run `make setup` (or
`make opencode-global`) so the copy updates; the re-run also drops token files
of providers whose token was emptied. `HEADERS` values are copied the same
way, one file per header, and referenced from `options.headers`. OpenCode merges `config.json`,
`opencode.json` and `opencode.jsonc` from its config directory (later wins)
and then your project `opencode.json`, so hand-written settings still override
the generated ones — and a file this repo did not generate is never touched
(first-line marker). The `local` provider shows up whenever its placeholder
token is set; picking it while `llama-server` is down fails that one request
and nothing else.

### Lean agents

OpenCode's stock request carries a system prompt of its own, every AGENTS.md
and `~/.claude/CLAUDE.md` it can find, a list of every skill on the machine and
ten tool definitions — around 10k tokens before the conversation starts. A
hosted provider prefills that in the time it takes to read this sentence; a
single self-hosted GPU does not.

`OPENCODE_LEAN=true` in a provider's `.env` gives it an agent named after the
provider and pinned to its model, which cuts that fixed part to around 4k:

- `prompt` points at a copy of `bin/opencode-lean-prompt.md`, which *replaces*
  OpenCode's model-specific base prompt rather than adding to it
- `skill` is denied, so the whole `<available_skills>` list is dropped
- `task`, `todowrite` and `webfetch` are denied too, leaving `bash`, `edit`,
  `read`, `write`, `grep` and `glob`

A denied tool is dropped from the request, not merely refused — but only names
OpenCode actually registers may be listed. Denying one it does not know takes
`edit` and `write` down with it, so `OPENCODE_LEAN_DISABLED_TOOLS` in
`bin/common.sh` holds exactly the four above.

`opencode` starts on the lean agent when its provider is also
[the default one](#default-provider); Tab switches to the stock `build` agent,
and the AGENTS.md files still apply to both.

`pi` gets no launcher either. `make setup` (and `make pi-global`) write every
provider that has a token into `~/.pi/agent/models.json`: a `<name>` provider
with `api: "anthropic-messages"` and `baseUrl` set to `BASE_URL` as-is (pi
hands it to the Anthropic SDK, which appends `/v1/messages`), plus the two
models with their limits. The provider id is the plain folder name, which is
what pi prints next to a model — `default [gtr]`. Where that name also exists
in pi's own catalog, pi keeps this file's endpoint and token and adds the
catalog's models to the list, so `/model` may show more than the two. No secret lands in the file: `apiKey` and
each `HEADERS` value are `!`-prefixed shell commands pi runs at request time
to read them back out of `providers/<name>/.env`, so a rotated token or a
`$(...)` computed header is picked up without a re-run. Re-run after changing
a model or endpoint. A file this repo did not generate is never touched
(first-line marker).

Because pi has no subagents, `SMALL_MODEL` is not a slot the agent uses on its
own there — it is just another entry in the `/model` list.

## Skills and global instructions

Providers are only half of the repo. `skills/` holds the skills every agent CLI
shares, `AGENTS.md` is the one global instruction file behind all of them, and
`opencode/` holds what only OpenCode can read. `make setup-skills` (and
`make setup`) install them as symlinks, so an edit here applies to the next
session with no reinstall.

### `AGENTS.md`

One file is the source of truth; each CLI gets it under the name it expects:

| Link | Read by |
|------|---------|
| `~/.claude/CLAUDE.md` | Claude Code — it does not read `AGENTS.md` itself |
| `~/.pi/agent/AGENTS.md` | pi |
| `~/.codex/AGENTS.md` | Codex |

Per-project files need no such trick: pi reads a directory's `AGENTS.md` or its
`CLAUDE.md`, whichever is there. OpenCode takes global instructions from the
`instructions` array in `~/.config/opencode/opencode.jsonc` instead — point it
at this repo's `AGENTS.md` if you want them there too.

### Skills and subagents

Every directory under `skills/` and every `agents/<name>.md` is linked into both
roots:

| Target | Read by |
|--------|---------|
| `~/.claude/skills/` | Claude Code, opencode |
| `~/.claude/agents/` | Claude Code |
| `~/.agents/skills/` | Codex, opencode, pi |
| `~/.agents/agents/` | nothing yet — kept as a mirror |

`~/.agents` is the vendor-neutral root: pi reads it alongside
`~/.pi/agent/skills`, opencode alongside `~/.claude/skills`, and Codex uses it
as its skills root. Subagents have no such convention — every CLI keeps its own
place (`~/.codex/agents/*.toml`, `~/.config/opencode/agent/*.md`, pi's subagent
extension) — so `~/.agents/agents` is a mirror nothing reads today.

What linking does:

- an existing symlink → replaced
- an existing real file or directory → skipped, never overwritten
- nothing there → created

The `checks` section of `make setup-skills` names the readers actually on your
PATH and reports symlinks left dangling by a skill that was renamed or removed
upstream. Re-run it after adding, renaming or deleting one; `make list` shows
what is linked where.

### OpenCode commands and plugins

Skills cover what every CLI can read. OpenCode's own extension points live in
`opencode/` and go to its global config dir:

| Target | What goes there |
|--------|-----------------|
| `~/.config/opencode/command/<name>.md` | a symlink to `opencode/command/<name>.md` — a slash command |
| `~/.config/opencode/plugin/<name>.js` | a generated shim importing `opencode/plugin/<name>.js` — a plugin |

Commands are plain markdown and are linked like everything else. Plugins are
not: OpenCode resolves a plugin's npm imports from where the file really lives,
and a symlinked plugin resolves them inside this repo, where
`@opencode-ai/plugin` is not installed. So `make setup-skills` writes a small
shim from `bin/opencode-plugin.template` into the config dir — OpenCode installs
the package there itself — and the shim passes `tool` into the implementation,
which stays here and stays editable:

```js
export const plugin = ({ tool }) => async ({ client }) => ({ /* hooks */ })
```

A file in either directory that this repo did not put there is left alone —
shims are recognised by their first line, commands by pointing back here.

The two `freelance-*` skills read a `personal-config.json` next to their
`SKILL.md` — issuer name, address, registration number, output directory. Those
are gitignored: copy the `personal-config.example.json` beside them and fill it
in, and the skill will tell you when it is missing.

## Troubleshooting

**`command not found`** — `~/.local/bin` is not on your PATH:
```bash
export PATH="$HOME/.local/bin:$PATH"
```

**`'opencode' is not on your PATH — install OpenCode first`** — the generated config is only read by OpenCode itself, which this repo does not install. See [Requirements](#requirements):
```bash
brew install sst/tap/opencode   # or: npm install -g opencode-ai
```

**`opencode` lists none of the providers** — the config is generated, not read live. Run `make opencode-global` (or `make setup`) and check `opencode models`. A token rotated in `.env` also needs the re-run: the config references the copy under `~/.config/opencode/claude-compatibles/`.

**`'pi' is not on your PATH`** — the generated `models.json` is only read by pi itself, which this repo does not install either:
```bash
npm install -g @earendil-works/pi-coding-agent   # or: curl -fsSL https://pi.dev/install.sh | sh
```

**pi answers `401 ... Your api key: ****f2- is invalid`** — the generated
`models.json` holds the token as a `!`-prefixed shell command, which pi 0.8x
runs at request time. The deprecated `@mariozechner` package (0.73 and older)
resolves references differently and sends the text itself as the key.
Install `@earendil-works/pi-coding-agent`.

**`pi` lists none of the providers** — the config is generated, not read
live. Run `make pi-global` (or `make setup`) and check `/model`. A
`~/.pi/agent/models.json` this repo did not write is left alone (first-line
marker): merge it by hand or move it aside.

**`API_TOKEN is empty`** — re-run `make setup`, or set the key in `providers/<name>/.env` directly.

**A CLI starts on the wrong model, or pi reports the wrong context size** —
`.env` is the only source. Edit `MODEL` / `CONTEXT_WINDOW` / `MAX_TOKENS`
there, and check whether an override further down the file (`ANTHROPIC_MODEL`,
`OPENCODE_MODEL`, `PI_MODEL`, …) is winning over it.

**An older `.env` still lists every variable** — that keeps working: the old
`ANTHROPIC_*` / `OPENCODE_*` lines are exactly the overrides, so they win over
the generic settings and nothing changes behaviour. Re-run `make setup` to have
the generic settings appended, then delete the override lines you do not need —
or delete the `.env` and re-run `make setup` for a clean one.

**Upgrading from the old `config` + `.env` layout** — re-run `make setup`. It
detects an old-format `.env` (no `BASE_URL` and no `ANTHROPIC_BASE_URL` line),
regenerates it from `.env.example`, carries your API key over, and keeps the
original as `.env.bak`.

**A skill or subagent does not show up** — `make list` shows what is linked. A
skill added, renamed or deleted since the last install needs a
`make setup-skills`; a target path holding a real file or directory is skipped
rather than overwritten, so move it aside first.

**You moved the repo** — the baked-in launcher path and every installed symlink
are stale. Re-run `make setup` from the new location.

## References

- [DeepSeek: Claude Code Integration Guide](https://api-docs.deepseek.com/guides/agent_integrations/claude_code)
- [MiniMax Platform](https://www.minimax.io/platform)
- [Z.ai / GLM Claude Code docs](https://docs.z.ai/devpack/tool/claude)
- [Kimi / Moonshot AI Platform](https://platform.moonshot.ai/docs)
- [Xiaomi MiMo: Claude Code Integration (Token Plan)](https://mimo.mi.com/docs/en-US/tokenplan/integration/claudecode)
- [OpenCode: Config](https://opencode.ai/docs/config/) / [Providers](https://opencode.ai/docs/providers/)
- [pi: Custom models](https://pi.dev/docs/latest/models) / [Providers](https://pi.dev/docs/latest/providers) / [DeepSeek's pi integration guide](https://api-docs.deepseek.com/quick_start/agent_integrations/pi_mono/)
