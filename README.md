# CodingAgentTools

> Run Claude Code, OpenCode, pi, Crush, Reasonix and Codewhale on Anthropic-compatible LLM backends (DeepSeek · GLM · Kimi · your own llama.cpp) — one repo, one `make setup`, one `configs.jsonc` driving all six CLIs, and the skills and global instruction file they share.

One repo that installs a `claude<name>` launcher command per provider and generates the global config of five more CLIs covering every provider — [Claude Code](https://docs.anthropic.com/claude-code), [OpenCode](https://opencode.ai), the [pi coding agent](https://pi.dev), [Crush](https://github.com/charmbracelet/crush), [Reasonix](https://github.com/esengine/DeepSeek-Reasonix) and [Codewhale](https://codewhale.net), all against Anthropic-compatible backends:

| Provider | Command | Endpoint | Flagship model |
|----------|----------|----------|----------------|
| DeepSeek | `claudedeepseek` | `https://api.deepseek.com/anthropic` | `deepseek-v4-pro` |
| GLM (Z.ai) | `claudeglm` | `https://api.z.ai/api/anthropic` | `glm-5.3` |
| Kimi (Moonshot) | `claudekimi` | `https://api.kimi.com/coding` | `kimi-k3` |
| Local (llama.cpp) | `claudelocal` | `http://127.0.0.1:11301` | `default` |
| gtr (llama.cpp behind Cloudflare) | `claudegtr` | `https://gtr-llama.spaghetti-monster.com` | `default` |

Only Claude Code gets a per-provider command. The other five have no launcher: `make setup` writes every provider into their global configs, so a bare `opencode` gets them all under `/models`, a bare `pi` under `/model`, and `crush`, `reasonix` and `codewhale` each start with the whole set.

Kimi runs that flagship as its 1M-context variant under Claude Code (`kimi-k3[1m]`); the other CLIs send the plain `kimi-k3`.

Each provider exposes a native Anthropic-compatible endpoint, so there is no proxy or translation layer — just environment variables. That holds for the local one too: `llama-server` answers `/v1/messages` in the Anthropic shape. Every generated config runs against the very same endpoint and token, and every model any of them can reach is declared in one place: `configs.jsonc` at the repo root, in git, with [tags](#tags) naming the slot each model fills. It holds no secret — an API key is written there as `${DEEPSEEK_API_KEY}` and read from the single gitignored `.env` beside it.

> **Note:** every launcher command is `claude<name>`. Bare provider names are deliberately avoided — `kimi`, for one, is Moonshot's own CLI.

> **Note:** Kimi has two endpoints. The default `https://api.kimi.com/coding` is for the **coding subscription plan**. For **pay-as-you-go (metered) billing**, switch `KIMI_BASE_URL` to `https://api.moonshot.ai/anthropic` in `.env`.

> **Note:** Local is not a hosted service — it points at a `llama-server` on your own machine, which serves the Anthropic shape on `/v1/messages`. Here that server is LlamaGate (`~/Workspace/LlamaGate`): `just start` brings it up on `127.0.0.1:11301`, `just profiles` lists the models it can load and `just start <profile>` swaps to one. There is no account and no key, so its `API_KEY` is a placeholder the CLIs merely require to be non-empty. Both llama.cpp providers use the fixed model id `default`: llama-server answers with whatever it has loaded and ignores the requested name, so swapping the model on the server needs no edit here. Keep `context_window` at or below the server's `--ctx-size`.

> **Note:** gtr is a `llama-server` on another machine, published through a Cloudflare tunnel and gated by Cloudflare Access. Requests without Access credentials get a 302 to the login page, so its `REQUEST_HEADERS` carry an Access service token (`CF-Access-Client-Id` / `CF-Access-Client-Secret`), whose values come from `.env` — where a short-lived `cloudflared access token` can stand in for a stored one. Like Local, its `API_KEY` is only a placeholder unless `llama-server` runs with `--api-key`.

The other half of the repo is what those CLIs run *with*: the skills under `skills/` and the single global instruction file `AGENTS.md`, symlinked into every CLI's config directory by the same `make setup` — see [Skills and global instructions](#skills-and-global-instructions).

## Layout

```
AGENTS.md                        # the one global instruction file, linked into every CLI
skills/<name>/SKILL.md           # a skill, linked into ~/.claude/skills and ~/.agents/skills
agents/<name>.md                 # a subagent, linked into ~/.claude/agents and ~/.agents/agents
opencode/command/<name>.md       # an OpenCode slash command, linked into ~/.config/opencode/command
opencode/plugin/<name>.js        # an OpenCode plugin, reached from a shim in ~/.config/opencode/plugin
configs.jsonc                     # every provider: endpoint, models, tags, and ${VAR} references (in git)
.env                             # the values those references point at (gitignored, chmod 600)
.env.example                     # the same variables, empty (in git)
bin/ui.sh                        # banner, colors and the output helpers every script shares
bin/models.py                    # the only reader of configs.jsonc: validates it, resolves tags to slots
bin/common.sh                    # shared resolution: configs.jsonc through models.py, values from .env
bin/style-check.sh               # refuse any name configs.jsonc owns from appearing anywhere else
bin/model-ref.sh                 # "<provider id>/<model>" for one provider, so nothing else spells a model id
bin/launcher.template            # Claude Code launcher; @@PROVIDER@@ baked in at setup time
bin/opencode-plugin.template     # OpenCode plugin shim; @@IMPL@@ baked in at setup time
bin/setup.sh                     # provider wizard: pick providers, paste tokens, install (`make setup-providers`)
bin/pi-global-models.sh          # registers every provider in pi's global models.json (`make pi-global`)
bin/opencode-global-config.sh    # registers every provider in OpenCode's global config (`make opencode-global`)
bin/crush-global-config.sh       # registers every provider in Crush's global crushrc (`make crush-global`)
bin/reasonix-global-config.sh    # registers every provider in Reasonix's global config.toml (`make reasonix-global`)
bin/codewhale-global-config.sh   # registers every provider in Codewhale's global config.toml (`make codewhale-global`)
bin/skills-common.sh             # where skills, subagents, AGENTS.md and the OpenCode extensions are installed
bin/skills-setup.sh              # links them there (`make setup-skills`)
bin/skills-list.sh               # their install status (part of `make list`)
bin/skills-uninstall.sh          # removes only the symlinks pointing back here (part of `make uninstall`)
bin/list.sh                      # everything this repo manages (`make list`)
bin/help.sh                      # target overview (`make help`)
docs/migrations/                 # upgrade notes for existing checkouts
Makefile                         # setup / setup-providers / setup-skills / list / uninstall / <agent>-global / help
```

Adding a provider is a new entry in `configs.jsonc` plus its key in `.env`; adding a skill is a new `skills/<name>/SKILL.md` and a `make setup-skills`. An OpenCode slash command is a new `opencode/command/<name>.md`, and a plugin a new `opencode/plugin/<name>.js` exporting `plugin({ tool })` — same `make setup-skills`.

## Requirements

- macOS / Linux with `bash`, `make` and `python3` (`bin/models.py` reads the provider configs)
- [Claude Code](https://docs.anthropic.com/claude-code) (`claude` on your PATH)
- [OpenCode](https://opencode.ai) (`opencode` on your PATH) — only OpenCode itself; it gets no launcher, just the generated config. Not bundled by this repo; install it first:
  ```bash
  brew install anomalyco/tap/opencode          # macOS (Homebrew)
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
- [Crush](https://github.com/charmbracelet/crush) (`crush` on your PATH) — optional, and like the two above it gets a generated config rather than a launcher:
  ```bash
  brew install charmbracelet/tap/crush   # macOS (Homebrew)
  # or
  npm install -g @charmland/crush
  ```
- [Reasonix](https://github.com/esengine/DeepSeek-Reasonix) (`reasonix` on your PATH) — optional:
  ```bash
  npm install -g reasonix
  # or
  brew install esengine/reasonix/reasonix
  ```
- [Codewhale](https://codewhale.net) (`codewhale` on your PATH) — optional:
  ```bash
  curl -fsSL https://codewhale.net/install.sh | sh
  ```

Every one of these is optional. A generator writes its config whether or not the
CLI is installed, and `make setup` says which of them it could not find on your
PATH.
- An API key for whichever provider(s) you use

## Setup

```bash
make setup
```

One interactive wizard does everything:

1. Check the providers you want (arrows + Space, Enter to confirm — providers that already have a token are pre-checked)
2. Paste each API token — an empty answer keeps the existing token
3. `configs.jsonc` is validated before anything is written; `.env` is created from `.env.example` if missing (`chmod 600`), gets any variables added to `.env.example` since, and picks up keys still sitting in the old `providers/<name>/.env` files
4. One command per provider is generated in `~/.local/bin` — `claude<name>`, with the provider name baked in
5. The pi packages that add [`/loop` and `/goal`](#loops-in-pi) are installed once into pi's user settings (`~/.pi/agent/settings.json`)
6. Every provider whose key resolves is registered in the global config of every CLI that has no launcher — [one generator each](#generated-configs) — with every model in `configs.jsonc`, not just the tagged ones, and all of them starting on [the default provider](#default-provider)
7. You get a warning if `~/.local/bin` or any of the CLIs those configs are for is missing from your PATH
8. Every skill, every subagent and `AGENTS.md` are symlinked into the places each CLI reads them from, and OpenCode gets this repo's slash commands and plugins — [`/loop`](#loops-in-opencode) and [`/goal`](#goals-in-opencode) among them — in `~/.config/opencode` ([details below](#skills-and-global-instructions))

To rotate a token, pick up new settings or add a provider later, just re-run `make setup`. `make setup-providers` and `make setup-skills` each run one half on its own; only the provider half prompts.

Coming from an older checkout? `docs/migrations/` has the per-variable
mapping — see [2026-08-15 — pi 対応と `.env` の共通設定化](docs/migrations/2026-08-15-shared-env-settings.md),
[2026-08-15 — GLM-5.3](docs/migrations/2026-08-15-glm-5.3.md),
[2026-08-24 — OpenCode ランチャー廃止とグローバル設定生成](docs/migrations/2026-08-24-opencode-global-config.md),
[2026-09-03 — pi ランチャー廃止とグローバル models.json 生成](docs/migrations/2026-09-03-pi-global-models.md),
[2026-09-05 — OpenCode の lean エージェント](docs/migrations/2026-09-05-opencode-lean-agent.md),
[2026-09-08 — claude-code-settings の統合](docs/migrations/2026-09-08-merge-claude-code-settings.md),
[2026-09-08 — OpenCode の `/goal`](docs/migrations/2026-09-08-opencode-goal.md),
[2026-09-09 — providers/ 廃止と configs.jsonc への集約](docs/migrations/2026-09-09-configs-jsonc.md),
[2026-09-11 — OpenCode の Subscriptions 見出し](docs/migrations/2026-09-11-opencode-subscriptions.md),
and [2026-09-13 — OpenCode の `/loop`](docs/migrations/2026-09-13-opencode-loop.md).

### Make targets

| Target | What it does |
|--------|--------------|
| `make setup` | Both halves: the provider wizard, then the skill, `AGENTS.md` and OpenCode extension install |
| `make setup-providers` | The wizard above only: tokens, `.env` upkeep, launcher install, pi packages, and every global config |
| `make setup-skills` | The shared assets only: `skills/`, `agents/`, `AGENTS.md` and `opencode/` into every agent CLI |
| `make check` | Validate `configs.jsonc`, then refuse any concrete name outside it (see `CLAUDE.md`). What the pre-commit hook runs |
| `make hooks` | Install the lefthook pre-commit hook that runs `make check` |
| `make list` | Every provider with its command, endpoint and models with their tags, then every skill, subagent and OpenCode extension with its install status |
| `make pi-global` | Re-generate pi's global `~/.pi/agent/models.json` from `configs.jsonc`, and set the startup model in `~/.pi/agent/settings.json` — run it after changing a model or endpoint |
| `make opencode-global` | Re-generate OpenCode's global config from `configs.jsonc` — run it after editing it |
| `make crush-global` | Re-generate Crush's global `~/.config/crush/crushrc` from `configs.jsonc` |
| `make reasonix-global` | Re-generate Reasonix's global `~/.reasonix/config.toml`, and the keys it reads from `~/.reasonix/.env` |
| `make codewhale-global` | Re-generate Codewhale's global `~/.codewhale/config.toml`, and the keys it reads from `~/.codewhale/.env` |
| `make uninstall` | Remove the installed launchers (including the `pi<name>` / `open<name>` ones earlier versions installed), the packages each agent lists, every global config this repo generated and the token files beside them, the symlinks pointing back into this repo and the plugin shims generated from it. The `.env` is left alone |
| `make help` | The target list above, on the terminal |

## Usage

```bash
claudedeepseek    # Claude Code on DeepSeek
claudeglm         # Claude Code on GLM (Z.ai)
claudekimi        # Claude Code on Kimi (Moonshot)
claudegtr         # Claude Code on gtr (llama.cpp behind Cloudflare)

opencode          # OpenCode — every configured provider is in /models
pi                # pi — every configured provider is in /model
crush             # Crush — every configured provider is in its model picker
reasonix          # Reasonix — every configured provider is in /model
codewhale         # Codewhale — every configured provider is in its model picker
```

Arguments pass through to `claude` verbatim, `--model` included — so a launcher
is not pinned to the model tagged `default` in `configs.jsonc`, and any id the
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

Both generators start you on the same provider; see [Default provider](#default-provider). For pi that means `defaultProvider` / `defaultModel` in `~/.pi/agent/settings.json`, the two keys Ctrl+S in `/model` writes — so a re-run replaces a pick you saved there. The rest of that file is left as it is. Writing them needs `python3`; without it the two keys are skipped and pi starts wherever it was.

OpenCode has no `open<name>` commands. `make setup` (and `make opencode-global`) write every provider that has a token into the global `~/.config/opencode/opencode.json`, so a bare `opencode` starts with all of them and `/models` switches mid-session — every one of them under a single **Subscriptions** heading, apart from OpenCode's own Zen and Go (see [OpenCode's model dialog](#opencodes-model-dialog)):

```bash
opencode                                   # starts on the default provider's model
opencode --model glm-anthropic/glm-5.3     # or pick at launch time
```

Note `small_model` — the model OpenCode names a session with, and its only use for one — stays at the default even after you switch the main model via `/models`.

Crush, Reasonix and Codewhale work the same way — no per-provider command, one
generated global config each:

```bash
crush                                      # starts on the large slot: the default provider's model
reasonix                                   # starts on default_model in ~/.reasonix/config.toml
codewhale                                  # starts on default_text_model in ~/.codewhale/config.toml
```

Crush has two model slots rather than a free choice per session — `large` is
what the interactive agent runs on, `small` what it delegates cheap work to —
and the generated `crushrc` points them at the default provider's `default` and
`small` models. Naming a model it does not know is not an error there: Crush
silently falls back to a model of its own choosing and writes that correction
back to disk, so a hand-edit that misspells one is easy to miss.

### Default provider

Every generated global config starts on whichever provider is marked `primary` in `configs.jsonc`:

```jsonc
"glm": {
  "primary": true,
  ...
}
```

At most one provider may say so. When none does, or it has no token, the first configured one wins instead, so a fresh checkout still gets a working one. It sets OpenCode's `model` and `small_model`, and pi's `defaultProvider` / `defaultModel`. A launcher has no such setting: each one pins the provider baked into it.

OpenCode can start somewhere else. `make opencode-global` deep-merges the top-level `opencode.overrides` in `configs.jsonc` into the generated `opencode.json` last, key by key, so its keys win. That is how OpenCode starts on a model of OpenCode Go, which comes in through `/connect` and is not a provider here:

```jsonc
"opencode": {
  "overrides": {
    "model": "opencode-go/deepseek-v4.1-flash",
    "small_model": "opencode-go/deepseek-v4.1-flash"
  }
}
```

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
different set by editing `agents.pi.packages` in `configs.jsonc`, as
`"<source>": "<slash command>"`
pairs — an empty command just leaves the label off:

```jsonc
"packages": { "npm:pi-reactor": "/reactor" }
```

> **Note:** pi packages run with full system access and the registry is not
> curated. Both packages above are third-party npm packages — read the source
> before trusting them with an unattended loop, and prefer a container or a
> throwaway checkout for autopilot runs.

### Loops in OpenCode

OpenCode runs one turn per message, so `/loop` is this repo's own, like
`/goal`: `opencode/command/loop.md` is the slash command and
`opencode/plugin/loop.js` the repetition behind it, both installed by
`make setup-skills`. It gives OpenCode what `npm:@realvendex/pi-loop` gives pi —
one prompt, run again on every turn until the model says it is done or a stop
condition is met:

```
/loop fix the failing tests, one failure at a time
/loop --until "all tests pass" run the suite and fix what fails
/loop --until-stable 2 summarise src/parser, then report nothing left to do
/loop --max 5 evaluate the options and pick one
/loop --every 5m check the deploy status
/loop --timeout 30m keep working through the queue
/loop                         show the current loop
/loop pause | resume | clear  control it
```

Flags come before the task. Every turn carries the same task, and the
continuation tells the model to check what the previous turn actually produced
before acting again — the user is not there to answer questions. `--every` runs
the first turn at once and then leaves the session idle until the interval has
passed; the wait is a timer in the opencode process, and a turn already running
when it comes due finishes first (`/loop status` shows `every 5m · next in 3m`).
The loop ends when

- the model calls the `loop_finish` tool — `complete` with the evidence, or
  `blocked` with what would unblock it. That tool is the only way the model can
  end the loop itself
- a reply contains an `--until "TEXT"`, the same reply comes back
  `--until-stable N` times in a row, or a `--timeout` runs out
- the budget runs out: `--max` (40 by default)
- you run `/loop pause` or `/loop clear`
- the turn was aborted or errored, or opencode was restarted — a loop from an
  earlier process is paused rather than resumed behind your back, and
  `/loop resume` picks it up

Loop state is one JSON file per session under `~/.local/share/opencode-loop/`,
pruned after 30 days like the goal's. A session runs one continuation loop at a
time: `/loop` refuses to start while a goal is active and `/goal` refuses while
a loop is, so two of them cannot take turns spending tokens in the same session.

> **Note:** like a goal, an active loop keeps the model working on its own, and
> the continuation turns run tools like any other turn. OpenCode still asks for
> permission unless you started it with `--auto` — the pairing to be careful
> with is `--auto` plus an open-ended task. `opencode --pure` starts without any
> external plugin, this one included.

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
| `configs.jsonc` | Every provider: endpoint, models, limits, the tags that say which slot each one fills, and a `${VAR}` reference wherever a value may come from outside | yes |
| `.env` | The values those references point at — nothing else | no — gitignored, `chmod 600` |

A whole provider in `configs.jsonc` is a dozen lines, which Claude Code, OpenCode
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
        { "id": "deepseek-v4-pro", "tags": ["default"] },
        { "id": "deepseek-flash",  "tags": ["small"] }
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
first way; an endpoint ships the second, so `configs.jsonc` carries a working
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
| `default` | `ANTHROPIC_MODEL`, the opus / sonnet / fable slots, and the model every generated config starts on |
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

Every CLI but Claude Code gets **every** model in the file — they pick between them in the
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
| `tags` | Which slots this model fills. Omit it to offer the model in the other CLIs without giving it a Claude Code slot |
| `context_window`, `max_tokens` | **Required.** pi writes them into its generated `models.json` (it otherwise assumes 128k / 16k and caps each request at `max_tokens`/3), and Claude Code takes the main model's `context_window` as its auto-compact window |
| `reasoning`, `input` | Whether the model supports extended thinking (default `true`) and what it accepts (`["text"]` or `["text", "image"]`) |
| `claude_id` | The id to send when the caller is Claude Code, for a variant only it understands — Kimi uses it for the 1M-context `[1m]` form. Defaults to `id` |

`defaults` at the top level supplies any of these to every model that does not
set it itself.

### Provider fields

The key in `providers` is the provider's name. It is what the launcher command
ends in, what each generated config files the provider under, and what
`make list` prints.

| Field | Meaning |
|-------|---------|
| `label` | The provider's name in OpenCode's model dialog, where it leads each model's name (`Z.AI glm-5.3`). Defaults to the provider's name |
| `API_KEY` | **Required.** A `${VAR}` reference to the key |
| `BASE_URL` | **Required.** The provider's Anthropic-compatible endpoint, as `${VAR:-default}` so `.env` can route it elsewhere |
| `REQUEST_HEADERS` | Extra request headers as a `{ "Name": "value" }` object, sent by every CLI — e.g. a Cloudflare Access service token in front of a self-hosted server. A value written as `${VAR}` is referenced wherever the CLI's format can express a reference |
| `primary` | `true` on at most one provider — the one every generated config starts on |
| `claude.command` | The launcher command, when `claude<name>` is not wanted |
| `claude.args` | Default options prepended to every launch of that command (word-split; your arguments come after them) |
| `claude.env` | Extra environment exported to Claude Code as-is |
| `claude.auto_compact_window` | Overrides the main model's `context_window` as Claude Code's compaction threshold |
| `opencode.lean` | `true` gives the provider [a lean agent of its own](#lean-agents) |
| `opencode.context_window`, `opencode.max_tokens` | Cap every model's limits for OpenCode. These are the window a session may grow into before it is compacted, so a backend too slow to prefill its full context sets them lower — `gtr` does |

Everything else about a CLI — the command it execs, the variables it reads, the
shape of its config — is that CLI's own generator's business, not a provider's;
see [Generated configs](#generated-configs).

### Generated configs

Claude Code is the only CLI here that gets a command per provider. Every other
one reads a single global config, and this repo writes it: one generator under
`bin/`, one `make <agent>-global` target, and no CLI's shape leaking into
another's. `make setup` runs every one of them.

| CLI | Generator | What it writes |
|-----|-----------|----------------|
| pi | `bin/pi-global-models.sh` | `~/.pi/agent/models.json`, and `defaultProvider` / `defaultModel` in `settings.json` |
| OpenCode | `bin/opencode-global-config.sh` | `~/.config/opencode/opencode.json` with `opencode.overrides` merged in last, and one key file per provider under `claude-compatibles/` |
| Crush | `bin/crush-global-config.sh` | `~/.config/crush/crushrc` |
| Reasonix | `bin/reasonix-global-config.sh` | `~/.reasonix/config.toml`, and the keys it names in `~/.reasonix/.env` |
| Codewhale | `bin/codewhale-global-config.sh` | `~/.codewhale/config.toml`, at 600 — it is the one that holds the keys |

Every one of those files opens with a line naming the target that rewrites it.
A file at that path without the line is never touched: the generator says so and
stops, so a config written by hand survives.

**How a key reaches each of them.** `configs.jsonc` holds a reference, never a
key, and each generator carries that as far as its CLI's format allows:

- **a command run when the value is needed** — pi and Crush. `!bash -c '…'` in
  pi's `models.json`, `$(bash -c '…')` in a `crushrc`, both reading the `.env`
  through `bin/common.sh`. Nothing is copied, so a rotated key needs no re-run.
- **a reference to a file this repo writes at 600** — OpenCode's
  `{file:…}`, under `~/.config/opencode/claude-compatibles/`.
- **the name of a variable the CLI resolves itself** — Reasonix, whose config
  takes an `api_key_env` and reads the value only from the `.env` in its own
  directory. The config still holds no key; the value is copied into that `.env`
  at 600, and a rotated key does need a re-run.
- **the key itself, in a file at 600** — Codewhale, and only because it offers
  nothing else: its `api_key_env` is resolved from the process environment
  alone, so a reference there works only for someone who has already exported
  the variable, and every provider would otherwise be unusable. Its
  `config.toml` is created at 600 before a byte is written to it.

Request headers follow the same order, and where a CLI has no way to express a
reference for a header value, the provider is left out of that config rather
than have its secret written into one — the generator names which and why. That
is why `gtr`, whose Cloudflare Access token travels in a header, reaches every
CLI here except Reasonix.

### OpenCode's model dialog

OpenCode's `/models` lists models under one heading per provider display name,
pins OpenCode Zen to the top and orders the rest by name. The generated config
gives every provider in `configs.jsonc` the same display name, so they share one
heading, and each model's display name leads with its provider's `label`:

```
OpenCode Zen          OpenCode's own, from /connect
OpenCode Go           OpenCode's own, from /connect
Subscriptions         everything in configs.jsonc
  DeepSeek deepseek-v4-pro
  Z.AI glm-5.3
  Moonshot kimi-k3
  Local default
```

Nothing under Subscriptions comes from OpenCode's own catalog (models.dev). Each
provider is declared in full against the Anthropic endpoint `BASE_URL` names —
the route its `claude<name>` launcher uses — with exactly the models listed in
`configs.jsonc`. It is filed under `<name>-anthropic`, and the suffix is what
keeps it apart from a provider of the same name in that catalog, whose
definition OpenCode would otherwise merge into it. Crush and Codewhale ship
catalogs that merge the same way, so their generators use the same kind of id.

OpenCode Zen and OpenCode Go are OpenCode's own services: `/connect` stores their
key in OpenCode's `auth.json`, and nothing here generates them. They serve some
of the same model ids as the providers here, so the heading, not the id, says
whose quota a request draws on. The prompt footer prints the model with its
heading — `Z.AI glm-5.3 Subscriptions` against `GLM-5.3 OpenCode Go`.

### `.env`

One variable per line, named by whatever `configs.jsonc` references.
`.env.example` lists them all with the URL to get each key from, and
`make setup` prompts for the keys. The variables that already have a default in
`configs.jsonc` ship commented out there — uncomment one to override it. The file
is sourced by bash, so a value can be computed at use time:

```bash
GTR_CF_ACCESS_TOKEN="$(cloudflared access token --app=https://gtr-llama.example.com)"
```

`claude<name>` evaluates it on every launch, and pi and Crush on every request.
OpenCode, Reasonix and Codewhale read a copy taken when their generator last
ran, so a rotated key needs `make setup` again for those three.

## How it works

Each installed command is the same thin shell script with the provider name and
the `bin/common.sh` path baked in. `common.sh` runs `bin/models.py`, the only
reader of `configs.jsonc`, inside a subshell that has the `.env` sourced — a bash
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
uses), each named `Subscriptions` and each model named `<label> <model>`, so
`/models` lists every model in `configs.jsonc` under that one heading. Tokens
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

`crush`, `reasonix` and `codewhale` get no launcher either, and each generator
writes the whole of that CLI's config from the same resolved values:

- **Crush** — `~/.config/crush/crushrc`, which is bash: one `provider add` per
  provider with `--type anthropic` and `BASE_URL` as it stands (Crush's client
  appends `v1/messages` itself, so a `/v1` added here would land on
  `/v1/v1/messages`), one `model add` per model carrying its window, output cap
  and both capability flags, then `model large` / `model small` pointing at the
  default provider's two. The key and every header value go in as
  `$(bash -c '…')`, run by Crush when it reads the file. Naming a model no
  `model add` declared is not an error there — Crush substitutes one of its own
  and writes the correction back — so the generator emits every `model add`
  before the two selections.
- **Reasonix** — `~/.reasonix/config.toml`: a `[[providers]]` entry per provider
  with `kind = "anthropic"`, the model list, and `model_overrides` giving each
  model the window and output cap `configs.jsonc` gives it. The entry names an
  `api_key_env` rather than a key, and Reasonix resolves that name from the
  `.env` in its own directory and nowhere else — not this repo's, not the
  surrounding shell — so the generator writes the value there at 600.
- **Codewhale** — `~/.codewhale/config.toml`, at 600: one
  `[providers.<name>-anthropic]` table declaring `kind = "openai-compatible"`
  alongside `wire = "anthropic-messages"` — the first says the entry is none of
  its own catalog's, the second which protocol the endpoint actually speaks —
  and one `[[custom_models]]` entry per model, whose `base_url` has to match its
  provider's. It is the one config here that carries the keys, for the reason
  under [Generated configs](#generated-configs).

### Lean agents

OpenCode's stock request carries a system prompt of its own, every AGENTS.md
and `~/.claude/CLAUDE.md` it can find, a list of every skill on the machine and
ten tool definitions — around 10k tokens before the conversation starts. A
hosted provider prefills that in the time it takes to read this sentence; a
single self-hosted GPU does not.

`"opencode": { "lean": true }` on a provider in `configs.jsonc` gives it an agent
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
in `configs.jsonc` with its limits. The provider id is its name there, which is
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
| `~/.config/crush/CRUSH.md` | Crush |

Per-project files need no such trick: pi reads a directory's `AGENTS.md` or its
`CLAUDE.md`, whichever is there. OpenCode takes global instructions from the
`instructions` array in `~/.config/opencode/opencode.jsonc` instead — point it
at this repo's `AGENTS.md` if you want them there too.

Reasonix gets no link. It reads `~/.reasonix/AGENTS.md`, but opens it through a
root confined to `~/.reasonix` and drops any symlink resolving outside it — a
link would be ignored without a word. Copy the file there if you want it, and
remember it is then a copy. Codewhale is left out for the same kind of reason:
where it takes global instructions from is its `instructions` setting, not a
path this repo can link into.

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
brew install anomalyco/tap/opencode   # or: npm install -g opencode-ai
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

**`'crush' / 'reasonix' / 'codewhale' is not on your PATH`** — each of those
configs is only read by its own CLI, and this repo installs none of them. See
[Requirements](#requirements). The config is written either way, so installing
the CLI later needs no re-run.

**Crush starts on a model you did not pick** — Crush does not fail on a
`model large` / `model small` naming something it cannot find; it substitutes a
model of its own and writes that back into its config. Re-run
`make crush-global` to put the choice back, and check `configs.jsonc` still tags
a `default` and a `small`.

**Reasonix says a provider has no key** — its keys do not come from this repo's
`.env`. The generated `config.toml` names a variable, and Reasonix reads that
name only from `~/.reasonix/.env`, which `make reasonix-global` writes at 600. A
key rotated here needs that re-run.

**A provider is missing from `~/.reasonix/config.toml`** — a provider whose
`REQUEST_HEADERS` carry a secret is left out on purpose: Reasonix sends header
values exactly as written, so registering `gtr` would mean writing its
Cloudflare Access token into a config file. The generator names the provider and
the reason on stderr. Add it by hand if you want it.

**Global instructions do not reach Reasonix** — `~/.reasonix/AGENTS.md` cannot
be a symlink to this repo: Reasonix opens it through a root confined to
`~/.reasonix` and silently ignores anything resolving outside. Copy `AGENTS.md`
there, and re-copy it when it changes. Skills are not affected — Reasonix
follows those symlinks and reads `~/.agents/skills` like the others.

**`~/.codewhale/config.toml` contains the API keys** — deliberately, and the
file is created at 600 before anything is written to it. Codewhale resolves an
`api_key_env` from the process environment alone, so the alternative is a config
that works only in a shell that already exported every provider's variable. See
[Generated configs](#generated-configs).

**`API_KEY for '<name>' is empty`** — the message names the `.env` variable to
set. Re-run `make setup`, or edit `.env` directly.

**A provider talks to the wrong endpoint** — a `<NAME>_BASE_URL` in `.env`
overrides the default in `configs.jsonc`. `make list` prints the endpoint each
provider actually resolves to.

**A CLI starts on the wrong model, or pi reports the wrong context size** —
`configs.jsonc` is the only source. `make list` prints each model with the tags
it carries, which is what decides the slot; naming a variable
(`CLAUDE_CODE_SUBAGENT_MODEL`, …) wins over `default` / `small`.
Re-run `make pi-global && make opencode-global` afterwards — those two configs
are generated, not read live.

**`configs.jsonc: ... unknown tag` / `... no model is tagged 'default'`** —
`make setup` validates every provider before it writes anything. The message
names the provider, the model index and the tags it accepts; `python3
bin/models.py check` re-runs the whole check.

**A checkout still has `providers/<name>/.env` files** — re-run `make setup`. It
creates the root `.env` and moves each `API_TOKEN` and `HEADERS` value into the
variable `configs.jsonc` references, filling only variables that are still empty.
The old files are left alone; delete `providers/` once `make list` looks right.

**A skill or subagent does not show up** — `make list` shows what is linked. A
skill added, renamed or deleted since the last install needs a
`make setup-skills`; a target path holding a real file or directory is skipped
rather than overwritten, so move it aside first.

**You moved the repo** — the baked-in launcher path and every installed symlink
are stale. Re-run `make setup` from the new location.

## References

Where each provider's key comes from:

| Provider | API key |
|----------|---------|
| DeepSeek | https://platform.deepseek.com/ |
| GLM (Z.ai) | https://z.ai/manage-apikey/apikey-list |
| Kimi (Moonshot) | https://platform.moonshot.ai/console/api-keys |
| Local / gtr | No account and no key; `API_KEY` is a placeholder the CLIs only require to be non-empty |

- [DeepSeek: Claude Code Integration Guide](https://api-docs.deepseek.com/guides/agent_integrations/claude_code)
- [Z.ai / GLM Claude Code docs](https://docs.z.ai/devpack/tool/claude)
- [Kimi / Moonshot AI Platform](https://platform.moonshot.ai/docs)
- [OpenCode: Config](https://opencode.ai/docs/config/) / [Providers](https://opencode.ai/docs/providers/)
- [pi: Custom models](https://pi.dev/docs/latest/models) / [Providers](https://pi.dev/docs/latest/providers) / [DeepSeek's pi integration guide](https://api-docs.deepseek.com/quick_start/agent_integrations/pi_mono/)
- [Crush: Configuration](https://github.com/charmbracelet/crush/blob/main/docs/config/README.md) — the `crushrc` builtins and the legacy JSON form
- [Reasonix: config paths](https://github.com/esengine/DeepSeek-Reasonix/blob/main-v2/docs/CONFIG_PATHS.md) / [reasonix.example.toml](https://github.com/esengine/DeepSeek-Reasonix/blob/main-v2/reasonix.example.toml)
- [Codewhale: Configuration](https://github.com/Hmbown/Codewhale/blob/main/docs/CONFIGURATION.md) / [Providers](https://github.com/Hmbown/Codewhale/blob/main/docs/PROVIDERS.md)
