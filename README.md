# CodingAgentTools

> Run Claude Code, OpenCode and pi on Anthropic-compatible LLM backends (DeepSeek · MiniMax · GLM · Kimi · MiMo · your own llama.cpp) — one repo, one `make setup`, one `configs.json` driving all three CLIs, and the skills and global instruction file all three share.

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

Each provider exposes a native Anthropic-compatible endpoint, so there is no proxy or translation layer — just environment variables. That holds for the local one too: `llama-server` answers `/v1/messages` in the Anthropic shape. The generated pi and OpenCode configs run against the very same endpoint and token, and every model any of the three can reach is declared in one place: `configs.json` at the repo root, in git, with [tags](#tags) naming the slot each model fills. It holds no secret — an API key is written there as `${DEEPSEEK_API_KEY}` and read from the single gitignored `.env` beside it.

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
configs.json                     # every provider: endpoint, models, tags, and ${VAR} references (in git)
.env                             # the values those references point at (gitignored, chmod 600)
.env.example                     # the same variables, empty (in git)
bin/ui.sh                        # banner, colors and the output helpers every script shares
bin/models.py                    # the only reader of configs.json: validates it, resolves tags to slots
bin/common.sh                    # shared resolution: configs.json through models.py, values from .env
bin/launcher.template            # Claude Code launcher; @@PROVIDER@@ baked in at setup time
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

Adding a provider is a new entry in `configs.json` plus its key in `.env`; adding a skill is a new `skills/<name>/SKILL.md` and a `make setup-skills`. An OpenCode slash command is a new `opencode/command/<name>.md`, and a plugin a new `opencode/plugin/<name>.js` exporting `plugin({ tool })` — same `make setup-skills`.

## Requirements

- macOS / Linux with `bash`, `make` and `python3` (`bin/models.py` reads the provider configs)
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
3. `configs.json` is validated before anything is written; `.env` is created from `.env.example` if missing (`chmod 600`), gets any variables added to `.env.example` since, and picks up keys still sitting in the old `providers/<name>/.env` files
4. One command per provider is generated in `~/.local/bin` — `claude<name>`, with the provider name baked in
5. The pi packages that add [`/loop` and `/goal`](#loops-in-pi) are installed once into pi's user settings (`~/.pi/agent/settings.json`)
6. Every provider whose key resolves is registered in pi's global `~/.pi/agent/models.json` (the key stays in `.env`, read back by a shell command at request time) and in OpenCode's global config (`~/.config/opencode/opencode.json`) — every model in `configs.json`, not just the tagged ones; both start on [the default provider](#default-provider), and in OpenCode's case its token is copied to `~/.config/opencode/claude-compatibles/` (chmod 600) and only referenced from the config
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
[2026-09-09 — GLM の軽量モデルと ox 廃止](docs/migrations/2026-09-09-glm-flash-and-ox-removal.md),
[2026-09-09 — モデル設定の models.json 化](docs/migrations/2026-09-09-models-json.md),
and [2026-09-09 — configs.json への集約](docs/migrations/2026-09-09-configs-json.md).

### Make targets

| Target | What it does |
|--------|--------------|
| `make setup` | Both halves: the provider wizard, then the skill, `AGENTS.md` and OpenCode extension install |
| `make setup-providers` | The wizard above only: tokens, `.env` upkeep, launcher install, pi packages, pi and OpenCode global configs |
| `make setup-skills` | The shared assets only: `skills/`, `agents/`, `AGENTS.md` and `opencode/` into every agent CLI |
| `make list` | Every provider with its command, endpoint and models with their tags, then every skill, subagent and OpenCode extension with its install status |
| `make pi-global` | Re-generate pi's global `~/.pi/agent/models.json` from `configs.json`, and set the startup model in `~/.pi/agent/settings.json` — run it after changing a model or endpoint |
| `make opencode-global` | Re-generate OpenCode's global config from `configs.json` — run it after editing it |
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
is not pinned to the model tagged `default` in `configs.json`, and any id the
provider serves works for one run:

```bash
claudeglm --help
claudedeepseek -p "Review my TypeScript type definitions"
claudeglm --model glm-5.3-flash            # the cheap model for a whole session
```

That covers the main slot only; the haiku and subagent slots keep following
their tags. In-session `/model <id>` does the same thing.

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

Note `small_model` — the model OpenCode names a session with, and its only use for one — stays at the default even after you switch the main model via `/models`.

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

## Provider settings

Two files at the repo root, and that is the whole configuration:

| File | Holds | In git |
|------|-------|--------|
| `configs.json` | Every provider: endpoint, models, limits, the tags that say which slot each one fills, and a `${VAR}` reference wherever a value may come from outside | yes |
| `.env` | The values those references point at — nothing else | no — gitignored, `chmod 600` |

A whole provider in `configs.json` is a dozen lines, which Claude Code, OpenCode
and pi all read through `bin/models.py`:

```json
{
  "providers": {
    "deepseek": {
      "API_KEY": "${DEEPSEEK_API_KEY}",
      "BASE_URL": "${DEEPSEEK_BASE_URL:-https://api.deepseek.com/anthropic}",
      "defaults": { "context_window": 1000000, "max_tokens": 384000, "reasoning": true, "input": ["text"] },
      "claude": { "env": { "CLAUDE_CODE_EFFORT_LEVEL": "max" } },
      "models": [
        { "id": "deepseek-v4-pro",   "tags": ["default"] },
        { "id": "deepseek-v4-flash", "tags": ["small"] }
      ]
    }
  }
}
```

and the `.env` beside it is one line per key:

```bash
DEEPSEEK_API_KEY=sk-...
```

Two reference forms work in any string — `API_KEY`, `BASE_URL`, and each value
under `REQUEST_HEADERS` — and both resolve against the environment when the value
is needed, so nothing from `.env` is ever copied into the file:

| Written | Resolves to |
|---------|-------------|
| `${NAME}` | the environment's `NAME`, empty when it is unset |
| `${NAME:-fallback}` | the environment's `NAME`, or `fallback` when it is unset or empty |

Reading the file therefore tells you which values can come from outside and what
happens when they do not. A secret has no sensible default and is written the
first way; an endpoint ships the second, so `configs.json` carries a working
default and `.env` can point the provider somewhere else — a regional host, a
metered endpoint, a proxy or gateway in front of it — without editing a
git-tracked file:

```bash
KIMI_BASE_URL=https://api.moonshot.ai/anthropic
```

A provider whose `API_KEY` resolves to nothing is left out of the generated pi
and OpenCode configs rather than breaking them.

`//` line comments are allowed, so the constraints behind a value can sit next
to it. Every model listed is offered by OpenCode's `/models` and pi's `/model`,
whether or not it carries a tag.

The `.env` is only ever read inside a subshell, so one provider's key never
reaches another provider's process: `claudeglm` is handed `GLM_API_KEY` and
nothing else.

### Tags

`default` and `small` are the two roles, and every slot follows one of them:

| Tag | Fills |
|-----|-------|
| `default` | `ANTHROPIC_MODEL`, the opus / sonnet / fable slots, and the model OpenCode and pi start on |
| `small` | `ANTHROPIC_DEFAULT_HAIKU_MODEL`, `CLAUDE_CODE_SUBAGENT_MODEL`, and the model OpenCode titles sessions with |

Only Claude Code has more than one model slot, and each of its slots is an
environment variable. So the tags that break a slot away from that pair *are*
those variables, spelled the way Claude Code reads them:

| Tag | Fills | Otherwise follows |
|-----|-------|-------------------|
| `ANTHROPIC_DEFAULT_OPUS_MODEL` | What `/model opus` selects | `default` |
| `ANTHROPIC_DEFAULT_SONNET_MODEL` | What `/model sonnet` selects | `default` |
| `ANTHROPIC_DEFAULT_FABLE_MODEL` | What `/model fable` selects | `default` |
| `CLAUDE_CODE_SUBAGENT_MODEL` | What a subagent runs on | `small` |

There is no tag for `ANTHROPIC_MODEL` or `ANTHROPIC_DEFAULT_HAIKU_MODEL`: those
two *are* `default` and `small`, and a second name for them would only be a
second way to say the same thing.

OpenCode and pi get **every** model in the file — they pick between them in the
session (`/models`, `/model`), so there is nothing per-model to declare for
them. `default` and `small` are what they start on.

So a provider whose models divide the obvious way needs only those two tags, and
naming a variable is how one model is pulled out of that pattern:

```json
{ "id": "glm-5.3",       "tags": ["default"] },
{ "id": "glm-5.3-flash", "tags": ["small"] },
{ "id": "glm-5.3-air",   "tags": ["CLAUDE_CODE_SUBAGENT_MODEL"] }
```

Here subagents run on `glm-5.3-air` while the haiku slot and OpenCode's
`small_model` stay on `glm-5.3-flash`. `default` is required, a tag may appear
on only one model, and an unknown tag is an error rather than a label —
`make setup` refuses to install until it is fixed.

### Model fields

| Field | Meaning |
|-------|---------|
| `id` | **Required.** The id sent to the provider |
| `tags` | Which slots this model fills. Omit it to offer the model in OpenCode and pi without giving it a Claude Code slot |
| `context_window`, `max_tokens` | **Required.** pi writes them into its generated `models.json` (it otherwise assumes 128k / 16k and caps each request at `max_tokens`/3), and Claude Code takes the main model's `context_window` as its auto-compact window |
| `reasoning`, `input` | Whether the model supports extended thinking (default `true`) and what it accepts (`["text"]` or `["text", "image"]`) |
| `claude_id` | The id to send when the caller is Claude Code, for a variant only it understands — Kimi and MiMo use it for the 1M-context `[1m]` form. Defaults to `id` |

`defaults` at the top level supplies any of these to every model that does not
set it itself.

### Provider fields

The key in `providers` is the provider's name: the launcher suffix
(`claude<name>`), the id pi prints beside a model, and the `<name>-anthropic`
provider id in OpenCode's config.

| Field | Meaning |
|-------|---------|
| `API_KEY` | **Required.** A `${VAR}` reference to the key |
| `BASE_URL` | **Required.** The provider's Anthropic-compatible endpoint, as `${VAR:-default}` so `.env` can route it elsewhere |
| `REQUEST_HEADERS` | Extra request headers as a `{ "Name": "value" }` object, sent by all three CLIs — e.g. a Cloudflare Access service token in front of a self-hosted server. A value written as `${VAR}` is referenced, never copied into a generated config |
| `claude.command` | The launcher command, when `claude<name>` is not wanted |
| `claude.args` | Default options prepended to every `claude<name>` launch (word-split; your arguments come after them). OpenCode and pi have no launcher, so it does not reach them |
| `claude.env` | Extra environment exported to `claude` as-is — this is where `CLAUDE_CODE_EFFORT_LEVEL` and `ENABLE_TOOL_SEARCH` are set |
| `claude.auto_compact_window` | Overrides the main model's `context_window` as Claude Code's auto-compact threshold |
| `opencode.lean` | `true` gives the provider [a lean agent of its own](#lean-agents) |
| `opencode.context_window`, `opencode.max_tokens` | Cap every model's limits for OpenCode only. These are the window a session may grow into before OpenCode compacts it, so a backend too slow to prefill its full context sets them lower — `gtr` does |

### `.env`

One variable per line, named by whatever `configs.json` references.
`.env.example` lists them all with the URL to get each key from, and
`make setup` prompts for the keys. The variables that already have a default in
`configs.json` ship commented out there — uncomment one to override it. The file
is sourced by bash, so a value can be computed at use time:

```bash
GTR_CF_ACCESS_TOKEN="$(cloudflared access token --app=https://gtr-llama.example.com)"
```

`claude<name>` evaluates it on every launch and pi on every request; OpenCode
reads a copy taken when `make opencode-global` ran.

## How it works

Each installed command is the same thin shell script with the provider name and
the `bin/common.sh` path baked in. `common.sh` runs `bin/models.py`, the only
reader of `configs.json`, inside a subshell that has the `.env` sourced — a bash
file, so a `$(...)` in a value is evaluated there. That script validates the
file, expands every `${VAR}`, resolves every tag to the slot it fills, and prints
the result as shell assignments the caller evaluates; a tag on two models, an
unknown tag or a missing `default` is an error, not a silent default. Because the
`.env` never leaves that subshell, the launcher's own environment holds one
provider's key and no other's.

`claude<name>` exports the variables Claude Code itself reads:
`ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL`, the six model slots (each the
`claude_id` of the model tagged for it) and `CLAUDE_CODE_AUTO_COMPACT_WINDOW`,
plus whatever `claude.env` holds; drops the settings only it should see and
`ANTHROPIC_API_KEY` (it would otherwise shadow `AUTH_TOKEN`); and `exec`s
`claude $args "$@"`. Every slot is assigned outright, so an `ANTHROPIC_*`
inherited from an outer launcher session cannot pin the inner one to the outer
provider's model.

`opencode` gets no launcher. `make setup` (and `make opencode-global`) write
every provider that has a token into the global
`~/.config/opencode/opencode.json` — the same `<name>-anthropic` custom
`@ai-sdk/anthropic` providers, `baseURL` set to `<BASE_URL>/v1` (the AI SDK
appends `/messages`, landing on the same `/v1/messages` route Claude Code
uses), so `/models` lists every model in every provider's `models.json`. Tokens
stay out of the file: each entry's `apiKey` is a `{file:...}` reference to a
per-provider key file under `~/.config/opencode/claude-compatibles/`
(chmod 600) written from the `.env` at the same time — `.env` stays the single
source of truth, but after rotating a key re-run `make setup` (or
`make opencode-global`) so the copy updates; the re-run also drops key files
of providers whose key was emptied. `REQUEST_HEADERS` values are copied the same
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

`"opencode": { "lean": true }` on a provider in `configs.json` gives it an agent
named after the provider and pinned to its model, which cuts that fixed part to
around 4k:

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
hands it to the Anthropic SDK, which appends `/v1/messages`), plus every model
in `configs.json` with its limits. The provider id is its name there, which is
what pi prints next to a model — `default [gtr]`. Where that name also exists in
pi's own catalog, pi keeps this file's endpoint and key and adds the catalog's
models to the list, so `/model` may show more. No secret lands in the file:
`apiKey` and each `REQUEST_HEADERS` value are `!`-prefixed shell commands pi runs
at request time to read the variable back out of `.env`, so a rotated key or a
`$(...)` computed header is picked up without a re-run. Re-run after changing a
model or endpoint. A file this repo did not generate is never touched
(first-line marker).

Because pi has no subagents and no cheap-model slot, `small` reaches it only as
the second entry in the `/model` list.

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

**`opencode` lists none of the providers** — the config is generated, not read live. Run `make opencode-global` (or `make setup`) and check `opencode models`. A key rotated in `.env` also needs the re-run: the config references the copy under `~/.config/opencode/claude-compatibles/`.

**A model is in `opencode models` but not under its provider in `/models`** — OpenCode's dialog lists a model under **Recent** or **Favorites** *instead of* under its provider, and only searching shows both. `~/.local/state/opencode/model.json` holds that recent list.

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

**`API_KEY for '<name>' is empty`** — the message names the `.env` variable to
set. Re-run `make setup`, or edit `.env` directly.

**A provider talks to the wrong endpoint** — a `<NAME>_BASE_URL` in `.env`
overrides the default in `configs.json`. `make list` prints the endpoint each
provider actually resolves to.

**A CLI starts on the wrong model, or pi reports the wrong context size** —
`configs.json` is the only source. `make list` prints each model with the tags
it carries, which is what decides the slot; naming a variable
(`CLAUDE_CODE_SUBAGENT_MODEL`, …) wins over `default` / `small`.
Re-run `make pi-global && make opencode-global` afterwards — those two configs
are generated, not read live.

**`configs.json: ... unknown tag` / `... no model is tagged 'default'`** —
`make setup` validates every provider before it writes anything. The message
names the provider, the model index and the tags it accepts; `python3
bin/models.py check` re-runs the whole check, `check <provider>` just one.

**A checkout still has `providers/<name>/.env` files** — re-run `make setup`. It
creates the root `.env` and moves each `API_TOKEN` and `HEADERS` value into the
variable `configs.json` references, filling only variables that are still empty.
The old files are left alone; delete `providers/` once `make list` looks right.

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
