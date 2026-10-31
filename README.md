# CodingAgentTools

> Run OpenCode, pi and DeepSeek Harness on the LLM backends you pay for (DeepSeek · Command Code · your own llama.cpp) — one repo, one `make setup`, one `configs.jsonc` driving all three CLIs, and the skills and global instruction file they share.

One repo that generates the global config of three CLIs covering every provider — [OpenCode](https://opencode.ai), the [pi coding agent](https://pi.dev) and [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness):

| Heading | Provider | Endpoint | API | Flagship model |
|---------|----------|----------|-----|----------------|
| API Key | DeepSeek | `https://api.deepseek.com/anthropic` | anthropic | `deepseek-v4-pro` |
| API Key | gtr (llama.cpp behind Cloudflare) | `https://gtr-halogen.spaghetti-monster.com` | openai | `default` |
| API Key | Claude API | `https://api.anthropic.com` | anthropic | `claude-sonnet-5-5` |
| Command Code | Command Code | `https://api.commandcode.ai/provider` | openai, and anthropic for Claude | `deepseek/deepseek-v4.1-flash` |

`make setup` writes every provider into each CLI's global config, so a bare `opencode` gets them all under `/models`, a bare `pi` under `/model`, and so does `dsh web` — `dsh` has no default profile, so a bare `dsh` only answers `--profile <name> is required`.

There is no proxy or translation layer: each CLI talks to each endpoint in the API it already speaks — Anthropic Messages (`/v1/messages`) or OpenAI Chat Completions (`/v1/chat/completions`), chosen per model. Every model any of them can reach is declared in one place: `configs.jsonc` at the repo root, in git, grouped by the [heading](#opencodes-model-dialog) it sits under in OpenCode's model dialog, with [tags](#tags) naming the model each CLI starts on. It holds no secret — an API key is written there as `${DEEPSEEK_API_KEY}` and read from the single gitignored `.env` beside it.

> **Note:** gtr is a `llama-server` on another machine, published through a Cloudflare tunnel and gated by Cloudflare Access. Requests without Access credentials get a 302 to the login page, so its `REQUEST_HEADERS` carry an Access service token (`CF-Access-Client-Id` / `CF-Access-Client-Secret`), whose values come from `.env`. Its `API_KEY` is only a placeholder unless `llama-server` runs with `--api-key`. It answers the OpenAI shape; `GTR9_API` in `.env` switches the CLIs to the Anthropic one if it is ever put behind such a route. Its model id is the fixed `default`: llama-server answers with whatever it has loaded and ignores the requested name, so swapping the model on the server needs no edit here. Keep `context_window` at or below the server's `--ctx-size`.

> **Note:** Claude API (`claude-api`) is Anthropic's pay-as-you-go API, read from `ANTHROPIC_API_KEY` in `.env` — not a Claude subscription. It is registered in OpenCode, pi and DeepSeek Harness only, through its `agents` field, and only once that key is set.

> **Note:** Command Code's [Provider API](https://commandcode.ai/docs/provider) serves Claude only on `/v1/messages` and every other model only on `/v1/chat/completions`, answering 400 on the wrong one — so its Claude models carry `"api": "anthropic"` and the rest follow the provider's `"api": "openai"`. It needs a paid plan: the Go plan has no API access. Its model list is not maintained by hand: the provider declares `catalog` and `make update` rewrites it from the Provider API's own list.

The other half of the repo is what those CLIs run *with*: the skills under `skills/` and the single global instruction file `AGENTS.md`, symlinked into every CLI's config directory by the same `make setup` — see [Skills and global instructions](#skills-and-global-instructions). The [Command Code](https://commandcode.ai) CLI (`cmd`) takes only this half: `make setup` installs it and links it the skills and `AGENTS.md`, but writes it no provider.

## Layout

```
AGENTS.md                        # the one global instruction file, linked into every CLI
skills/<name>/SKILL.md           # a skill, linked into ~/.claude/skills and ~/.agents/skills
agents/<name>.md                 # a subagent (none yet), linked into ~/.claude/agents and ~/.agents/agents
opencode/command/<name>.md       # an OpenCode slash command (none yet), linked into ~/.config/opencode/command
opencode/plugin/<name>.js        # an OpenCode plugin, linked into ~/.config/opencode/plugin
pi/extensions/<name>.ts          # a pi extension, linked into ~/.pi/agent/extensions
pi/agents/<name>.md              # a pi subagent definition, linked into ~/.pi/agent/agents
claude/mods/<name>/              # a Claude Code mod (function hooks), loaded through CLAUDE_CODE_PLUGIN_DIRS in ~/.claude/settings.json
vendor/tokeneconomizer/          # TokenEconomizer, with its OpenCode plugin, turned on in Claude Code, pi and OpenCode
vendor/impeccable/               # Impeccable's Claude Code plugin, ~/.agents skill and OpenCode command
configs.jsonc                    # every provider by heading: endpoint, API, models, tags, ${VAR} references (in git)
.env                             # the values those references point at (gitignored, chmod 600)
.env.example                     # the same variables, empty (in git)
bin/ui.sh                        # banner, colors and the output helpers every script shares
bin/models.py                    # reads configs.jsonc for every other script: validates it, resolves tags and routes
bin/common.sh                    # shared resolution: configs.jsonc through models.py, values from .env
bin/style-check.sh               # refuse any name configs.jsonc owns from appearing anywhere else
bin/model-ref.sh                 # "<route id>/<model>" for one provider, so nothing else spells a model id
bin/models-update.sh             # fetches the live catalog of every provider that names one (`make update`)
bin/models-update.py             # rewrites that provider's models in configs.jsonc from it
bin/setup.sh                     # provider wizard: pick providers, paste tokens, install (`make setup-providers`)
bin/pi-global-models.sh          # registers every provider in pi's global models.json (`make pi-global`)
bin/opencode-global-config.sh    # registers every provider in OpenCode's global config (`make opencode-global`)
bin/dsh-global-config.sh         # registers every provider in DeepSeek Harness's home patch (`make dsh-global`)
bin/serve.sh                     # runs dsh web and OpenCode behind nginx for their hostnames
bin/serve-service.sh             # keeps it running as a launchd agent or systemd user unit (`make setup`, `make uninstall`)
bin/serve.launchd.plist          # that launchd agent, filled in by serve-service.sh
bin/serve.systemd.service        # that systemd user unit, filled in by serve-service.sh
bin/nginx-install.sh             # installs or upgrades its nginx with Homebrew or apt-get (`make setup`, and serve.sh when it is missing)
bin/serve.nginx.conf             # that nginx's config; each start fills it in for the run
bin/serve.dsh.nginx.conf         # its server for dsh web, handing out dsh's startup token
bin/serve.opencode.nginx.conf    # its server for OpenCode, sending OpenCode's server password
bin/skills-common.sh             # where skills, subagents, AGENTS.md and the OpenCode and pi extensions are installed
bin/skills-setup.sh              # links them there (`make setup-skills`)
bin/removed-skills.txt           # skills no longer shipped; setup deletes their old links
bin/skills-list.sh               # their install status (part of `make list`)
bin/skills-uninstall.sh          # removes only the symlinks pointing back here and the claude/mods entry (part of `make uninstall`)
bin/tokeneconomizer.sh           # turns TokenEconomizer on in Claude Code, pi and OpenCode (`make setup-tokeneconomizer`), or off (`make uninstall`)
bin/impeccable.sh                # turns Impeccable on in every agent CLI (`make setup-impeccable`), or off (`make uninstall`)
bin/list.sh                      # everything this repo manages (`make list`)
bin/help.sh                      # target overview (`make help`)
docs/migrations/                 # upgrade notes for existing checkouts
Makefile                         # setup / setup-providers / setup-skills / setup-tokeneconomizer / setup-impeccable / list / uninstall / <agent>-global / help
```

Adding a provider is a new entry in `configs.jsonc` plus its key in `.env`; adding a skill is a new `skills/<name>/SKILL.md` and a `make setup-skills`. An OpenCode slash command is a new `opencode/command/<name>.md`, and a plugin a new `opencode/plugin/<name>.js` default-exporting `{ id, setup }` — same `make setup-skills`. So is a pi extension, a new `pi/extensions/<name>.ts`, and a pi subagent, a new `pi/agents/<name>.md`.

## Requirements

- macOS / Linux with `bash`, `make` and `python3` (`bin/models.py` reads the provider configs)
- [OpenCode](https://opencode.ai) v2 (`opencode` on your PATH) — only OpenCode itself; this repo writes its config. `make setup` installs or upgrades it with the v2 installer:
  ```bash
  curl -fsSL https://opencode.ai/v2/install | bash
  ```
- [pi](https://pi.dev) (`pi` on your PATH) — only pi itself; like OpenCode it gets the generated `models.json`. Not bundled by this repo either:
  ```bash
  curl -fsSL https://pi.dev/install.sh | sh
  ```
  (the older `@mariozechner/pi-coding-agent` package is deprecated and resolves environment references differently)
- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`) — one of the two CLIs `make setup` installs itself, with `bun install -g @deepseek-ai/dsh@next`, upgrading a `dsh` already on your PATH. That needs `bun` and Node.js `^22.19.0 || >=24.0.0`. It is a developer preview: read its [safety notice](https://github.com/deepseek-ai/deepseek-harness/blob/main/SAFETY.md) first
- [Command Code](https://commandcode.ai) (`cmd`) — the other one, installed with `npm install -g command-code@latest`, upgrading a `cmd` already there. That needs `npm` and Node.js `>=22`. It gets no generated config, only the [skills and `AGENTS.md`](#skills-and-global-instructions), and it updates itself in the background (`cmd update` does it on demand)
- [nginx](https://nginx.org) (`nginx`) — only for [`dsh web` and OpenCode through a Cloudflare Tunnel](#dsh-web-and-opencode-through-a-cloudflare-tunnel), and `make setup` installs or upgrades it with `brew install nginx` — or `sudo apt-get install nginx` where there is no Homebrew — once `SERVE_HOST` or `SERVE_OPENCODE_HOST` is set. `bin/serve.sh` installs it the same way when it is missing

Every one of these is optional. A generator writes its config whether or not the
CLI is installed, and `make setup` says which of them it could not find on your
PATH.
- An API key for whichever provider(s) you use

## Setup

```bash
make setup
```

One interactive wizard does everything:

1. Check the providers whose token you want to set or change (arrows + Space, Enter to confirm). Providers that already have a token show ✅ and start unchecked, so Enter alone leaves every token as it is. The last two rows, `dsh web` and `opencode web`, are not providers: checking one asks for the hostname [`bin/serve.sh`](#dsh-web-and-opencode-through-a-cloudflare-tunnel) serves it under
2. Paste the API token of each checked provider — an empty answer keeps the existing token
3. `configs.jsonc` is validated before anything is written; `.env` is created from `.env.example` if missing (`chmod 600`), gets any variables added to `.env.example` since, and picks up keys still sitting in the old `providers/<name>/.env` files
4. pi itself is updated, the [pi packages](#pi-packages) that add `/loop`, `/goal`, MCP and subagents are installed into pi's user settings (`~/.pi/agent/settings.json`), and pi's model catalogs are refreshed, and DeepSeek Harness is installed with `bun install -g <package>@next` and Command Code with `npm install -g <package>@latest` — and nginx with `brew install nginx`, or `sudo apt-get install nginx` without Homebrew, once `SERVE_HOST` or `SERVE_OPENCODE_HOST` is set, for [`bin/serve.sh`](#dsh-web-and-opencode-through-a-cloudflare-tunnel). Anything of these already installed is upgraded to the newest release, so re-running `make setup` is also how you update them
5. Every provider whose key resolves is registered in the global config of every CLI — [one generator each](#generated-configs) — with every model in `configs.jsonc`, not just the tagged ones, and all of them starting on [the default provider](#default-provider). pi also gets the keys OpenCode's `/connect` holds, for [Zen and Go](#usage). OpenCode itself is installed or upgraded with its v2 installer, and the [OpenCode plugins](#opencode-plugins-from-npm) with `opencode plugin add`
6. [`dsh web` and OpenCode's Web UI](#dsh-web-and-opencode-through-a-cloudflare-tunnel) are (re)started in the background as a service of your user's, while dsh is set up or `SERVE_HOST` or `SERVE_OPENCODE_HOST` is set — and the service is removed once none of them is
7. You get a warning if any of the CLIs those configs are for is missing from your PATH
8. Every skill, every subagent and `AGENTS.md` are symlinked into the places each CLI reads them from, and OpenCode gets this repo's slash commands and plugins — [`/loop`](#loops-in-opencode) and [`/goal`](#goals-in-opencode) among them — in `~/.config/opencode`, and pi gets its [dashboard](#pi-dashboard) in `~/.pi/agent/extensions` ([details below](#skills-and-global-instructions))
9. [TokenEconomizer](#tokeneconomizer) is turned on in Claude Code, pi and OpenCode, and [Impeccable](#impeccable) in every agent CLI

To rotate a token, pick up new settings or add a provider later, just re-run `make setup`. `make setup-providers`, `make setup-skills`, `make setup-tokeneconomizer` and `make setup-impeccable` each run one part on its own; only the provider half prompts.

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
[2026-09-13 — OpenCode の `/loop`](docs/migrations/2026-09-13-opencode-loop.md),
[2026-09-13 — Claude Code ランチャー廃止と見出し・API 別の configs.jsonc](docs/migrations/2026-09-13-drop-claude-launchers.md),
[2026-09-18 — pi のダッシュボード拡張](docs/migrations/2026-09-18-pi-dashboard.md),
[2026-09-18 — pi から OpenCode Zen / Go を使う](docs/migrations/2026-09-18-pi-opencode-auth.md),
[2026-09-18 — pi の MCP・サブエージェントと起動モデル](docs/migrations/2026-09-18-pi-mcp-subagents.md),
[2026-09-18 — pi の provider id を label に揃える](docs/migrations/2026-09-18-pi-provider-labels.md),
[2026-09-27 — OpenCode v2 移行](docs/migrations/2026-09-27-opencode-v2.md),
[2026-10-03 — pi 1.0](docs/migrations/2026-10-03-pi-1.0.md),
[2026-10-31 — Crush・Reasonix・Codewhale の対応を削除](docs/migrations/2026-10-31-drop-crush-reasonix-codewhale.md),
[2026-10-31 — OpenCode の見出しを Subscriptions から API Key に変更](docs/migrations/2026-10-31-api-key-heading.md),
and [2026-10-31 — Local provider を削除](docs/migrations/2026-10-31-drop-local.md).

### Make targets

| Target | What it does |
|--------|--------------|
| `make setup` | Both halves: the provider wizard, then the skill, `AGENTS.md`, OpenCode extension, pi extension and Claude Code mod install, then TokenEconomizer and Impeccable |
| `make setup-providers` | The wizard above only: tokens, `.env` upkeep, pi packages, DeepSeek Harness, Command Code, OpenCode plugins, and every global config |
| `make setup-skills` | The shared assets only: `skills/`, `agents/`, `AGENTS.md`, `opencode/` and `pi/` into every agent CLI, and `claude/mods/` into Claude Code's `CLAUDE_CODE_PLUGIN_DIRS` |
| `make setup-tokeneconomizer` | [TokenEconomizer](#tokeneconomizer) only: turn it on in Claude Code, pi and OpenCode |
| `make setup-impeccable` | [Impeccable](#impeccable) only: turn it on in every agent CLI |
| `make check` | Validate `configs.jsonc`, then refuse any concrete name outside it (see `CLAUDE.md`). What the pre-commit hook runs |
| `make hooks` | Install the lefthook pre-commit hook that runs `make check` |
| `make list` | Every provider with its heading, endpoint and models with their tags, then every skill, subagent, OpenCode extension and pi extension with its install status |
| `make update` | Fetch the live model catalog (`catalog`) of every provider that names one and rewrite its models in `configs.jsonc` — ids, context windows and per-model API follow the catalog, tags stay hand-written — then regenerate every global config. One command brings everything up to date |
| `make pi-global` | Re-generate pi's global `~/.pi/agent/models.json` from `configs.jsonc`, set the startup model in `~/.pi/agent/settings.json`, and link the keys OpenCode's `/connect` holds into `~/.pi/agent/auth.json` — run it after changing a model or endpoint, or connecting a provider in OpenCode |
| `make opencode-global` | Re-generate OpenCode's global config from `configs.jsonc` — run it after editing it |
| `make dsh-global` | Re-generate DeepSeek Harness's home patch `~/.dsh/cordis.patch.yml`, and the keys it reads from `~/.dsh/.env` |
| `make uninstall` | Remove the [background service](#dsh-web-and-opencode-through-a-cloudflare-tunnel) running `dsh web` and OpenCode, [TokenEconomizer](#tokeneconomizer), [Impeccable](#impeccable), the packages each agent lists, every global config this repo generated and the token files beside them, the symlinks pointing back into this repo (pi extensions included), the plugin shims generated from it, the `claude/mods` entry in Claude Code's `CLAUDE_CODE_PLUGIN_DIRS`, and the entries in pi's `auth.json` that read OpenCode's keys. The `.env` is left alone |
| `make help` | The target list above, on the terminal |

## Usage

```bash
opencode          # OpenCode — every configured provider is in /models
pi                # pi — every configured provider is in /model
dsh web           # DeepSeek Harness — every configured provider is in the Web UI's model picker
```

`make setup` (and `make pi-global`) write every provider that has a token into `~/.pi/agent/models.json`, so a bare `pi` has all of them and `/model` switches mid-session. Each is filed under its `label` — the name OpenCode's model dialog puts before its models — or its name when it has none:

```bash
pi                                         # starts on the model pi.overrides names
pi --model DeepSeek/deepseek-v4-pro            # or pick at launch time
pi --model commandcode/claude-opus-5
```

pi also has OpenCode Zen and OpenCode Go built in, as `opencode` and `opencode-go`. They are not providers in `configs.jsonc`: you connect them once with `/connect` in OpenCode, and `make setup` (and `make pi-global`) gives pi an entry in `~/.pi/agent/auth.json` for every key OpenCode stored that pi has a provider for. The entry is a command reading the key back out of OpenCode's `~/.local/share/opencode/auth.json`, so no key is copied and one rotated in OpenCode needs no re-run. An entry you made yourself with pi's `/login` is left in place, and OAuth logins are not shared: pi refreshes those through its own `/login`. `make setup` also refreshes pi's model catalogs, so the Zen and Go lists include models those services added after the installed pi was released.

```bash
pi --model opencode-go/deepseek-v4.1-flash     # OpenCode Go, on the key OpenCode's /connect stored
pi --list-models opencode                      # what Zen and Go serve
```

The two generators otherwise start you on the default provider; `pi.overrides` and `opencode.overrides` in `configs.jsonc` can point them elsewhere. See [Default provider](#default-provider). For pi that means `defaultProvider` / `defaultModel` in `~/.pi/agent/settings.json`, the two keys Ctrl+S in `/model` writes — so a re-run replaces a pick you saved there. The rest of that file is left as it is. Writing them needs `python3`; without it the two keys are skipped and pi starts wherever it was.

`make setup` (and `make opencode-global`) write every provider that has a token into the global `~/.config/opencode/opencode.json`, so a bare `opencode` starts with all of them and `/models` switches mid-session — each under the heading `configs.jsonc` files it under, beside OpenCode's own Zen and Go (see [OpenCode's model dialog](#opencodes-model-dialog)):

```bash
opencode                                                  # starts on the model opencode.overrides names
opencode --model deepseek-anthropic/deepseek-v4-pro   # or pick at launch time
opencode --model commandcode-openai/deepseek/deepseek-v4.1-flash
```

Note `small_model` — the model OpenCode names a session with, and its only use for one — stays at the one `opencode.overrides` sets even after you switch the main model via `/models`.

DeepSeek Harness works the same way — one generated global config:

```bash
dsh web                                    # starts on agent-default-model in ~/.dsh/cordis.patch.yml
dsh --profile headless "run the tests"     # the same providers, one task, no browser
```

DeepSeek Harness has no terminal UI of its own: `dsh web` serves one on
`http://127.0.0.1:3080`, and `--profile headless` answers one task and exits.
A model picked or a provider edited in the Web UI is saved to
`~/.dsh/settings.yaml`, which dsh merges over the generated patch — so it
survives `make dsh-global`, and once a model is saved there a re-run no longer
changes the one dsh starts on.

### dsh web and OpenCode through a Cloudflare Tunnel

`make setup` keeps `dsh web` and OpenCode's Web UI running in the background
for a browser elsewhere, reached through a Cloudflare Tunnel and signed in to by
Cloudflare Access alone — no dsh token, no OpenCode password. `SERVE_HOST` and
`SERVE_OPENCODE_HOST` name the tunnel's public hostnames — set them by checking
`dsh web` and `opencode web` in `make setup`, or in `.env`. Each app starts
only when its hostname is set, except `dsh web`: once `make setup` has
installed and configured dsh, it starts without `SERVE_HOST` too, on this
machine alone and behind its own token URL. With nothing set, nothing starts.

`bin/serve.sh` runs them, as a service of your user's that `make setup`
(re)starts at the end of every run — a launchd agent on macOS, a systemd user
unit elsewhere — so they come up at login and again whenever one of them exits.
Each start reads `.env`, so re-run `make setup` after editing it; the apps are
found on the `PATH` `make setup` last ran with. When nothing is left to serve, `make setup` removes
the service, and `make uninstall` always does. A systemd user unit stops at
logout unless lingering is on, so `make setup` turns it on with
`loginctl enable-linger`, and says so when that needs `sudo`.

```bash
tail -f ~/Library/Logs/codingagenttools-serve.log    # macOS
journalctl --user -u codingagenttools-serve -f       # systemd
# dsh web: http://127.0.0.1:3080/?token=…    ← on this machine
# dsh web: https://dsh.example.com/ — through the tunnel, no token needed
# opencode: https://oc.example.com/ — through the tunnel, no password needed
```

| Listens on | What |
|---|---|
| `127.0.0.1:3081` | nginx — every route of the tunnel points here; it tells the apps apart by Host |
| `127.0.0.1:3080` | `dsh web`, which also accepts `SERVE_HOST` besides loopback as the Host and Origin of a request (`--trusted-host`) |
| `127.0.0.1:3082` | `opencode serve`, a server of its own beside OpenCode's background service, started from `$HOME` |

The routes must not override the HTTP Host header: both apps check Origin
against it. Each hostname needs a subdomain of its own, since OpenCode's Web UI
asks for `/api` at the root.

Neither app lets its login be turned off, so nginx signs you in:

- dsh mints a new startup token every start and answers a browser without its
  cookie with 401. nginx turns that 401, on a page for `SERVE_HOST`, into a
  redirect to the token URL, which dsh trades for a 30-day cookie.
- OpenCode asks every API request for its server password. `bin/serve.sh`
  makes one up for each start and nginx sends it with every request for
  `SERVE_OPENCODE_HOST`. OpenCode then takes whatever reaches it as signed in,
  so nginx refuses a request whose Origin is another site.

So `bin/serve.sh` writes nginx a config for each start, in a directory only you
can read, removed when it stops. `make setup` installs nginx once either
hostname is set — with Homebrew, or with apt-get where there is none, disabling
again the system service Debian's package starts on port 80 — and `bin/serve.sh`
installs it the same way when it is missing.

That makes Cloudflare Access the only lock on both hostnames, and whoever gets
past it can run any command and read any file on this machine — OpenCode opens
any directory as a project and has a terminal. Admit only yourself, and turn on
each route's Access protection in the tunnel too, so a request that skipped
Access is refused before it reaches nginx. Anyone with an account on this
machine can also reach `127.0.0.1:3081` directly.

### Default provider

Every generated global config starts on whichever provider is marked `primary` in `configs.jsonc`:

```jsonc
"deepseek": {
  "primary": true,
  ...
}
```

At most one provider may say so. When none does, or it has no token, the first configured one wins instead, so a fresh checkout still gets a working one. It sets OpenCode's `model` and `small_model`, pi's `defaultProvider` / `defaultModel`, and DeepSeek Harness's `agent-default-model`.

OpenCode can start somewhere else. `make opencode-global` deep-merges the top-level `opencode.overrides` in `configs.jsonc` into the generated `opencode.json` last, key by key, so its keys win. That is how OpenCode can start on a model of OpenCode Zen or Go, which come in through `/connect` and are not providers here:

```jsonc
"opencode": {
  "overrides": {
    "model": "<provider>/<model>#<variant>",
    "small_model": "<provider>/<model>"
  }
}
```

`model` takes OpenCode's `<provider>/<model>#<variant>` form. The suffix pins the
thinking variant the session starts on — `high` where the model offers
`low`/`medium`/`high`, `max` where it offers Anthropic's `high`/`max`. Without
it the session follows the variant last picked.

pi works the same way. `make pi-global` deep-merges the top-level `pi.overrides` into `~/.pi/agent/settings.json` after writing the default provider's model there, so its keys win. Any other key of pi's [settings](https://pi.dev/docs/settings) can go there, written in pi's own form:

```jsonc
"pi": {
  "overrides": {
    "defaultProvider": "<provider>",
    "defaultModel": "<model>",
    "defaultThinkingLevel": "max"
  }
}
```

`defaultThinkingLevel` is one of `off`, `minimal`, `low`, `medium`, `high`,
`xhigh` and `max`; pi clamps it to the highest level the model supports.

Anything else OpenCode's config takes goes there too, written in OpenCode's own form. The permission policy does: `"permission": "allow"` runs every tool without an approval prompt, so a session never stops to ask. Its MCP servers do — today the [Playwright MCP](https://github.com/microsoft/playwright-mcp), started on the persistent profile `~/playwright/profiles/default` so a login survives restarts, and Parallel Search, a remote server at `https://search.parallel.ai/mcp` that searches and fetches the web with no key. OpenCode expands `{env:HOME}` in the command itself, so the same entry works on every machine. Chrome locks a profile to one browser, so while another agent drives that profile, OpenCode's Playwright cannot start one. `opencode mcp list` shows whether each connected.
OpenCode's TUI settings are not in `opencode.json` but in `~/.config/opencode/cli.json`, a file OpenCode writes itself — `opencode plugin add` records plugins there. `make setup` deep-merges the top-level `opencode-cli.overrides` into it in place after adding the plugins, so its keys win and the rest of the file is left as it is. Today it turns the tab bar off:

```jsonc
"opencode-cli": {
  "overrides": {
    "tabs": { "mode": "off" }
  }
}
```

### OpenCode plugins from npm

`make setup` installs two community plugins into OpenCode:

| Plugin | Adds |
|--------|------|
| [`oc-tps`](https://github.com/Tarquinen/oc-tps) | Live tokens per second and time to first token in the session prompt |
| [`@tarquinen/opencode-dcp`](https://github.com/Opencode-DCP/opencode-dynamic-context-pruning) | A `compress` tool the model uses to summarize finished parts of a session, and pruning of repeated or failed tool calls. Its settings are in `~/.config/opencode/dcp.jsonc`, written on first run |

A plugin has a server half, listed under `plugins` in `opencode.json`, and a TUI half, listed under `plugins` in `~/.config/opencode/cli.json`. The server halves are in `opencode.overrides.plugins` in `configs.jsonc`, so `make opencode-global` keeps them. `make setup` then runs `opencode plugin add` for every plugin in `OPENCODE_PLUGINS` in `bin/setup.sh`, and `opencode plugin update` brings each to its latest. A new plugin with a server half goes in both lists.

`@slkiser/opencode-quota` and `opencode-handoff` are out until they ship
v2-format plugins — see `docs/migrations/2026-09-27-opencode-v2.md`.

### pi packages

pi keeps its core small and ships no loop of its own, nor subagents. Its
built-in MCP cannot read OpenCode's servers, so MCP comes from a package too.
Everything of that kind lives in [pi packages](https://pi.dev/packages), so
`make setup` installs four of them:

| Package | Adds | What it does |
|---------|------|--------------|
| [`npm:@realvendex/pi-loop`](https://github.com/ZachDreamZ/pi-loop) | `/loop` | Repeat a prompt until a stop condition: `--max N`, `--until "TEXT"`, `--until-stable N` (convergence), `--timeout 5m`, `--yes` for autopilot |
| `npm:pi-goal` | `/goal` | A persistent objective the agent keeps working on across turns until it is complete, paused, or out of budget |
| [`npm:pi-mcp-adapter`](https://github.com/nicobailon/pi-mcp-adapter) | `/mcp` | MCP servers behind one `mcp` tool, started when first used |
| [`npm:@tintinweb/pi-subagents`](https://github.com/tintinweb/pi-subagents) | `/agents` | Claude Code's `Agent` tool with `general-purpose`, `Explore` and `Plan`, run in the foreground or background, plus Claude Code's `Workflow` scripts as `SubagentWorkflow` |

```
/loop "make the tests pass" --until-stable 2 --max 20
/goal "port the CLI flags to the new parser"
```

They go into pi's user settings (`~/.pi/agent/settings.json`). The list is
`PI_PACKAGES` in `bin/common.sh`, as `<source>=<slash command>` pairs. Install
a different set for one run by setting it:

```bash
PI_PACKAGES="npm:pi-reactor=/reactor" make setup
```

**MCP.** pi runs the same MCP servers as OpenCode. `make pi-global` adds an
`opencode` import to the adapter's `~/.pi/agent/mcp-adapter.json`, and the
adapter reads the `mcp` entries of the generated
`~/.config/opencode/opencode.json`, which come from `opencode.overrides.mcp` in
`configs.jsonc`. Parallel Search gives pi web search and fetch with no key, and
Playwright drives the same persistent browser profile. Only one agent at a time
can drive that profile. `/mcp` shows each server and its tools. Other keys in
`mcp-adapter.json` are kept.

`~/.pi/agent/mcp.json` is pi's built-in MCP config. The adapter replaces the
built-in: on its first start it adds `"-builtin:mcp"` to `extensions` in pi's
`settings.json`, and it still reads the servers `pi mcp add` writes to
`mcp.json`, but ignores an `imports` there and warns at every start.
`make pi-global` moves such an `imports` into `mcp-adapter.json`, and removes
`mcp.json` if nothing else is left in it.

**Subagents.** The skills written for Claude Code's `Agent` tool, such as
`deep-review` and `fanout`, run in pi unchanged. The
package's built-in `Explore` runs on Claude Haiku, which this setup reaches only
through paid providers, so `pi/agents/Explore.md` replaces it with the same
prompt and no `model:`. It then runs on the parent session's model.
`general-purpose` and `Plan` inherit it already. Each subagent is a full model
session, so running several in parallel multiplies the cost.

> **Note:** pi packages run with full system access and the registry is not
> curated. All four packages above are third-party npm packages — read the
> source before trusting them with an unattended loop, and prefer a container
> or a throwaway checkout for autopilot runs.

### pi dashboard

`make setup` links `pi/extensions/dashboard.ts` into `~/.pi/agent/extensions`,
so every `pi` starts with a two-line footer in place of the built-in one, a
to-do list the model keeps while it works, and a side panel:

```
─ todo 1/3 ─────────────────────────────────────────────────────────────
  ▶ Run hello.py with python3
  ○ Confirm the output
── ⠏ Working ────────────────────────────────────────────────────────────
◆ deepseek-v4-pro medium · ctx ▰▱▱▱▱▱▱▱ 12% 121k/1.00M · ↑51.5k ↓688 · ⚡ 60.8 tok/s · ⏱ 14s ⚙ 1 ·  main
▶ Port the CLI flags to the new parser · todo 1/3 · ▶ Run hello.py with python3 · loop: 2/10
```

| Part | What it shows |
|------|---------------|
| Footer, first line | Model and thinking level, context window use as a bar that turns yellow at 65% and red at 85%, tokens sent and received this session (cached input included), tokens per second, time since the prompt and tools running, git branch |
| Footer, second line | The topic, to-do progress and the item in progress, then whatever other extensions report there, such as `/loop` and `/goal` |
| To-do widget | The open items above the editor, while there are any |
| `/panel` or ctrl+alt+p | A side panel at the top right with the full to-do list and the session figures, including cost when the provider reports one. It does not take the keyboard, so you keep typing while it is open. Hidden below 100 columns |
| `/todos` | Hide or show the to-do widget |
| `/topic TEXT` | Name the session. The topic is an active `/goal` objective first, then this name, then the first prompt |

The to-do list comes from a `todo` tool the extension gives the model, together
with one paragraph of system prompt asking it to plan any task of more than a
few steps with that tool and to tick items off as it verifies them. The list is
stored in the tool results, so `/tree` and forks restore the list that belonged
to that point in the session.

Tokens per second is measured from the first streamed token, so waiting for the
provider does not count. A live estimate shows while a reply streams and the
provider's own output count replaces it when the reply ends. Replies shorter
than a couple of dozen tokens leave the last figure in place.

### Claude Code dashboard

`claude/mods/dashboard/` is a Claude Code mod: a plugin of function hooks that
docks a pane beside the transcript with the session's figures and its to-do
list. `make setup` (and `make setup-skills`) loads it, and every mod beside it,
by adding this repo's `claude/mods` to `CLAUDE_CODE_PLUGIN_DIRS` under `env` in
`~/.claude/settings.json`, at the path the repo has on that machine. Claude Code
reads that variable from no other settings file and loads each child of a
folder of plugins, so a new mod needs only a new session. The file is merged,
not rewritten: the keys Claude Code keeps there and any other folder in the
variable stay, and `make uninstall` takes out only this entry. A session that
was already running when setup ran does not have the mod; to try one without
setup, start a session with

```
claude --plugin-dir claude/mods/dashboard
```

| Part | What it shows |
|------|---------------|
| Header | Model and effort, session time, git branch with ahead/behind and changed files, lines added and removed, the first prompt |
| Context | The window as one bar split by content (system prompt, tools, messages, …) with the auto-compact point and the reserve after it, the fill per request, the requests left before auto-compaction, compactions and the tokens they freed |
| To-do | Progress and each item's time; the item in progress counts up live |
| Speed | Tokens per second of each response as a braille graph, the average, the peak and the wait for the response to start |
| Tokens | Cache reads, cache writes, fresh input and output as one bar; the cache hit rate of the last request and of the session, cache misses, how long the cache stays warm while idle; input and output tokens per minute; cost, cost per hour and the last turn's cost |
| Limits | On a subscription, the 5-hour and 7-day windows: their fill with a cursor where the window's time stands, `◆` ahead of that pace, `◇` behind it, `◈` on it, the reset, and where the window ends up at this pace once that passes 90% |
| Activity | The running turn and the tools running, model time against tool time, the last 24 tool calls as ✓ or ✗, and calls, failures and average time per tool |
| Agents, Files | Subagents with their model, time and tokens; the files edited with the lines added and removed |

| Command or key | What it does |
|----------------|--------------|
| `/dashboard` | Open or close the pane. It also opens by itself when a session starts in a terminal at least 144 columns wide |
| `/dashboard reset` | Zero the figures |
| `1`–`8` in the focused pane (ctrl+x tab) | Fold or unfold a section. Folds are kept for the next session |

While the pane is out of sight its gist stays in the status line. A toast says
when the context passes 80%, when a rate-limit window passes 75%, 90% and 95%
(once per window, whichever session sees it), and when the last to-do is done.

The to-do list follows Claude Code's own `TodoWrite` or task tools when the
session has them; otherwise the mod gives the model a `todo` tool of its own.

Tokens per second runs from the first streamed piece of a response to its end,
so thinking that streams no visible text counts as generation time rather than
making the text that follows look fast. The cache is assumed to expire after
5 minutes until a hit after a longer pause shows a 1-hour TTL. A cache miss is a
request that wrote back to the cache more than the conversation grew by — at
least 2,000 tokens and 5% of the prompt, the threshold Claude Code itself uses.
The figures count from the moment the mod loads, so a resumed session starts
them at zero.

`claude plugin validate claude/mods/dashboard` and
`claude plugin test claude/mods/dashboard` check it.

### Claude Code PR title

`claude/mods/pr-title/` names the session after the PR it opened. When a Bash
call runs `gh pr create` and prints the new PR's URL, the mod reads the PR's
number and title with `gh pr view` and renames the tmux window the session runs
in to `#<number> <title>` right away (`tmux rename-window`, which also turns off
`automatic-rename` for that window). The session itself gets the same name
through `/rename` once the turn ends: Claude Code does not run a slash command
from inside the tool call that holds the turn. Outside tmux only the session is
renamed. It loads like the dashboard, through `claude/mods`.

`claude plugin validate claude/mods/pr-title` and
`claude plugin test claude/mods/pr-title` check it.

### TokenEconomizer

[TokenEconomizer](https://github.com/microsoft/TokenEconomizer) cuts what a
session spends: it learns short facts about each repository from finished
sessions and adds them at the start of the next one (micro-skills), leaves out
tools a repository's sessions never use (tool pruning, Claude Code only), and
redirects a turn stuck repeating the same failure. It needs Python 3.10+ on the
`PATH` and no key of its own. `vendor/tokeneconomizer/` is upstream's tree
without `experiments/` and `docs/assets/`, plus an OpenCode 2.x plugin
upstream does not have (`plugin/opencode/tokeneconomizer.ts`, read through
`tokeneconomizer/trace/opencode.py`).

`make setup` (or `make setup-tokeneconomizer` alone) turns it on:

| Agent | How | Commands |
|-------|-----|----------|
| Claude Code | `vendor/tokeneconomizer` added as the `tokeneconomizer` marketplace and its plugin installed; Claude Code reads it from the folder, so edits here need no reinstall. Every run records the tool catalog again (`toolprune refresh-catalog`) | `/tokeneconomizer:status` and the rest |
| pi | `vendor/tokeneconomizer` as a local package in `~/.pi/agent/settings.json` | `/te status` |
| OpenCode | `~/.config/opencode/plugin/tokeneconomizer.ts`, a symlink to its plugin. The background service loads it on its next start: `opencode service restart` | `/te status` |

In OpenCode the plugin's notices arrive as messages in the session, which the
model reads too, and tool pruning does not apply. State lives in
`~/.tokeneconomizer`; `make uninstall` turns the plugin off and leaves it.

The tests run from `vendor/tokeneconomizer`:
`uv run --no-project --with pytest python -m pytest tests`.

### Impeccable

[Impeccable](https://github.com/pbakaus/impeccable) is a skill for frontend
design work: `/impeccable <command> <target>` steers a component or page
(`bolder`, `quieter`, `layout`, `polish` and more), reviews it (`critique`,
`audit`), or writes `PRODUCT.md` and `DESIGN.md` for a project (`init`,
`document`). Its detector flags the usual tells of generated UI — gradient
text, low contrast, cramped padding — with fixed rules and no model call. The
detector is a self-contained binary the skill downloads into `~/.impeccable/`
on its first run.

Upstream builds the skill once per agent, naming that agent's tools and paths
in it; `vendor/impeccable/` keeps three of the builds, and `make setup` (or
`make setup-impeccable` alone) installs each:

| Build | Goes to | Used by |
|-------|---------|---------|
| `plugin/` | the `impeccable` marketplace and its plugin: the skill, its subagents and the design hook | Claude Code (`/impeccable`) |
| `.agents/skills/impeccable/` | a symlink at `~/.agents/skills/impeccable` | Codex (`$impeccable`), pi, OpenCode and the other CLIs that read `~/.agents/skills` |
| `.opencode/commands/impeccable.md` | a symlink at `~/.config/opencode/command/impeccable.md` | OpenCode's `/impeccable` |

The design hook runs the detector after every edit of a UI file and once more
when the turn ends, and hands its findings to the model, in every project.
`/impeccable hooks off` turns it off for one project.

### Loops in OpenCode

OpenCode runs one turn per message, so `/loop` is this repo's own, like
`/goal`: `opencode/plugin/loop.js` registers the slash command and runs the
repetition behind it, installed by `make setup-skills`. It gives OpenCode what `npm:@realvendex/pi-loop` gives pi —
one prompt, run again on every turn until the model says it is done or a stop
condition is met:

```
/loop fix the failing tests, one failure at a time
/loop --until "all tests pass" run the suite and fix what fails
/loop --until-stable 2 summarise src/parser, then report nothing left to do
/loop --max 5 evaluate the options and pick one
/loop 5m check the deploy status
/loop --timeout 30m keep working through the queue
/loop                         show the current loop
/loop pause | resume | clear  control it
```

Flags come before the task, and a duration there is the interval —
`/loop 5m <task>` is `/loop --every 5m <task>`. Durations use `s`, `m`, `h` and
`d`, and may be compound: `30s`, `2h30m`, `1d`. Every turn carries the same
task, and the continuation tells the model to check what the previous turn
actually produced before acting again — the user is not there to answer
questions. `--every` runs the first turn at once and then leaves the session
idle until the interval has passed; the wait is a timer in the opencode
process, and a turn already running when it comes due finishes first
(`/loop status` shows `every 5m · next in 3m`). The loop ends when

- the model calls the `loop_finish` tool — `complete` with the evidence, or
  `blocked` with what would unblock it. That tool is the only way the model can
  end the loop itself
- a reply contains an `--until "TEXT"`, the same reply comes back
  `--until-stable N` times in a row, or a `--timeout` runs out
- the budget runs out: `--max` (1000 by default)
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
own: `opencode/plugin/goal.js` registers the slash command and runs the loop
behind it, installed by `make setup-skills`. It gives OpenCode what `npm:pi-goal` gives pi — a
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
- the budget runs out: `--turns` (1000 by default) or `--tokens`
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
| `configs.jsonc` | Every provider, grouped by heading: endpoint, API, models, limits, the tags that say which model each CLI starts on, and a `${VAR}` reference wherever a value may come from outside | yes |
| `.env` | The values those references point at — nothing else | no — gitignored, `chmod 600` |

A whole provider in `configs.jsonc` is a dozen lines, which every generator reads
through `bin/models.py`. The key one level under `providers` is the heading its
providers sit under in [OpenCode's model dialog](#opencodes-model-dialog):

```json
{
  "providers": {
    "API Key": {
      "deepseek": {
        "label": "DeepSeek",
        "API_KEY": "${DEEPSEEK_API_KEY}",
        "BASE_URL": "${DEEPSEEK_BASE_URL:-https://api.deepseek.com/anthropic}",
        "api": "anthropic",
        "defaults": { "context_window": 1000000, "max_tokens": 384000, "reasoning": true, "input": ["text"] },
        "models": [
          { "id": "deepseek-v4-pro", "tags": ["default"] },
          { "id": "deepseek-flash",  "tags": ["small"] }
        ]
      }
    }
  }
}
```

and the `.env` beside it is one line per key:

```bash
DEEPSEEK_API_KEY=sk-...
```

Two reference forms work in any string — `API_KEY`, `BASE_URL`, `api`, and each
value under `REQUEST_HEADERS` — and both resolve against the environment when the
value is needed, so nothing from `.env` is ever copied into the file:

| Written | Resolves to |
|---------|-------------|
| `${NAME}` | the environment's `NAME`, empty when it is unset |
| `${NAME:-fallback}` | the environment's `NAME`, or `fallback` when it is unset or empty |

Reading the file therefore tells you which values can come from outside and what
happens when they do not. A secret has no sensible default and is written the
first way; an endpoint ships the second, so `configs.jsonc` carries a working
default and `.env` can point the provider somewhere else — a regional host, a
metered endpoint, a proxy or gateway in front of it — without editing a
git-tracked file.

A provider whose `API_KEY` resolves to nothing is left out of every generated
config rather than breaking it.

`API_KEY` and each `REQUEST_HEADERS` value travel into the generated configs as
references, so each is one reference standing alone — a header value may be a
plain literal instead — and its fallback uses only letters, digits and `.` `_`
`:` `/` `-`, since the generated command takes it as a bare word. `make check`
refuses anything else: a reference inside a longer string, or a fallback that
needs quoting, would leave a generator nothing to write but the resolved secret.

`//` line comments are allowed, so the constraints behind a value can sit next
to it. Every model listed is offered by OpenCode's `/models` and pi's `/model`,
whether or not it carries a tag.

The `.env` is only ever read inside a subshell, so one provider's key never
leaks into the resolution of another's.

### Tags

| Tag | The model… |
|-----|------------|
| `default` | every generated config starts on |
| `small` | OpenCode titles sessions with. Falls back to `default` |

Every CLI gets **every** model in the file — they pick between them in the
session (`/models`, `/model`) — so a tag only decides where one starts, and for
OpenCode and pi only until `opencode.overrides` / `pi.overrides` name a model
(see [Default provider](#default-provider)).
`default` is required, a tag may appear on only one model, and an unknown tag is
an error rather than a label — `make setup` refuses to install until it is fixed.

### Model fields

| Field | Meaning |
|-------|---------|
| `id` | **Required.** The id sent to the provider |
| `api` | `"anthropic"` or `"openai"` — overrides the provider's `api` for this model |
| `tags` | Which slots this model fills; see [Tags](#tags) |
| `context_window`, `max_tokens` | **Required.** Every generated config carries them — pi otherwise assumes 128k / 16k, and OpenCode never compacts a session on a model without a context limit |
| `reasoning`, `input` | Whether the model supports extended thinking (`true` or `false`, default `true`) and what it accepts (`["text"]` or `["text", "image"]`) |

`defaults` at the top level supplies any of these but `id`, `api` and `tags` to
every model that does not set it itself.

### Provider fields

A provider sits under its heading, and its key there is the provider's name —
unique across headings. Each generated config but pi's files it once per API its
models speak, as the route `<name>-<api>`; `make list` prints the name.

| Field | Meaning |
|-------|---------|
| `label` | Leads each model's name in OpenCode's model dialog (`DeepSeek deepseek-v4-pro`), which tells providers sharing a heading apart, names the route in DeepSeek Harness, and is the provider's id in pi. Omit it where the heading already says whose models they are |
| `API_KEY` | **Required.** A `${VAR}` reference to the key, standing alone |
| `BASE_URL` | **Required.** The root both APIs hang off — `/v1/messages` or `/v1/chat/completions` is appended — as `${VAR:-default}` so `.env` can route it elsewhere |
| `api` | **Required.** `"anthropic"` (Anthropic Messages) or `"openai"` (OpenAI Chat Completions): what every model speaks unless it sets its own. May be a `${VAR:-default}` reference where the shape depends on the route, as `gtr`'s does |
| `catalog` | Path GET with `BASE_URL` listing the provider's models, in OpenAI's `/v1/models` shape. `make update` rewrites the provider's `models` from it, so a provider with one is not maintained by hand |
| `REQUEST_HEADERS` | Extra request headers as a `{ "Name": "value" }` object, sent by every CLI — e.g. a Cloudflare Access service token in front of a self-hosted server. A value is a literal or one `${VAR}` reference standing alone, and a reference is carried wherever the CLI's format can express one |
| `primary` | `true` on at most one provider — the one every generated config starts on |
| `picker` | `false` keeps the provider out of the checkbox list `make setup` starts from — configure it by naming it directly (`bin/setup.sh <name>`). A key that resolves still registers it like any other provider |
| `agents` | The CLIs that register the provider, from `pi`, `opencode` and `dsh`. Omit it for all of them. A provider still needs a key that resolves to be registered anywhere |
| `opencode.lean` | `true` gives the provider [a lean agent of its own](#lean-agents) |
| `opencode.context_window`, `opencode.max_tokens` | Cap every model's limits for OpenCode. These are the window a session may grow into before it is compacted, so a backend too slow to prefill its full context sets them lower — `gtr` does |

Everything else about a CLI — the command it execs, the variables it reads, the
shape of its config — is that CLI's own generator's business, not a provider's;
see [Generated configs](#generated-configs).

### Generated configs

Every CLI here reads a single global config, and this repo writes it: one
generator under `bin/`, one `make <agent>-global` target, and no CLI's shape
leaking into another's. `make setup` runs every one of them.

| CLI | Generator | What it writes |
|-----|-----------|----------------|
| pi | `bin/pi-global-models.sh` | `~/.pi/agent/models.json`, and `defaultProvider` / `defaultModel` in `settings.json` |
| OpenCode | `bin/opencode-global-config.sh` | `~/.config/opencode/opencode.json` with `opencode.overrides` merged in last, and one key file per provider under `claude-compatibles/` |
| DeepSeek Harness | `bin/dsh-global-config.sh` | `~/.dsh/cordis.patch.yml`, and the keys it names in `~/.dsh/.env` |

Every one of those files opens with a line naming the target that rewrites it.
A file at that path without the line is never touched: the generator says so and
stops, so a config written by hand survives.

**How a key reaches each of them.** `configs.jsonc` holds a reference, never a
key, and each generator carries that as far as its CLI's format allows:

- **a command run when the value is needed** — pi. `!bash -c '…'` in
  pi's `models.json`, reading the `.env` through `bin/common.sh`. Nothing is
  copied, so a rotated key needs no re-run.
- **a reference to a file this repo writes at 600** — OpenCode's
  `{file:…}`, under `~/.config/opencode/claude-compatibles/`.
- **the name of a variable the CLI resolves itself** — DeepSeek Harness, whose
  `apiKeyEnv` falls back to the `.env` in `~/.dsh` after the process
  environment, its own credentials file and the working directory's `.env`. The
  config still holds no key; the value is copied into that `.env` at 600, and a
  rotated key does need a re-run.

Request headers are carried the same way. DeepSeek Harness takes header values
only as they stand, but a `!!js` expression in a patch is evaluated when the
patch loads, so each header there runs the same `.env` command pi runs — once
per launch (and per live reload of the patch under `dsh web`) rather than per
request.

### OpenCode's model dialog

OpenCode's `/models` lists models under one heading per provider display name,
pins OpenCode Zen to the top and orders the rest by name. The generated config
names every route after the heading `configs.jsonc` files its provider under, so
each heading there is one heading in the dialog, beside OpenCode's own. A model's
display name leads with its provider's `label` when it has one:

```
OpenCode Zen          OpenCode's own, from /connect
API Key               providers."API Key"
  DeepSeek deepseek-v4-pro
  GTR9 default
Command Code          providers."Command Code"
  claude-opus-5
  deepseek/deepseek-v4.1-flash
OpenCode Go           OpenCode's own, from /connect
```

Nothing under those headings comes from OpenCode's own catalog (models.dev).
Each route is declared in full — `@ai-sdk/anthropic` for an `anthropic` one,
`@ai-sdk/openai-compatible` for an `openai` one — with exactly the models listed
in `configs.jsonc`. It is filed under `<name>-<api>`, and the suffix is also what
keeps it apart from a provider of the same name in that catalog, whose
definition OpenCode would otherwise merge into it. pi and DeepSeek Harness ship
catalogs that merge the same way, so every generator uses the same id.

OpenCode Zen and OpenCode Go are OpenCode's own services: `/connect` stores their
key in OpenCode's `auth.json`, and nothing here generates them. They serve some
of the same model ids as the providers here, so the heading, not the id, says
whose quota a request draws on. The prompt footer prints the model with its
heading — `deepseek/deepseek-v4.1-flash Command Code` against `DeepSeek V4.1 Flash OpenCode Go`.

### `.env`

One variable per line, named by whatever `configs.jsonc` references.
`.env.example` lists them all with the URL to get each key from, and
`make setup` prompts for the keys. The variables that already have a default in
`configs.jsonc` ship commented out there — uncomment one to override it. Two
variables are not a provider's: `SERVE_HOST` and `SERVE_OPENCODE_HOST`, the
hostnames [`bin/serve.sh`](#dsh-web-and-opencode-through-a-cloudflare-tunnel) serves under. The file
is sourced by bash, so a value can be computed at use time:

```bash
GTR_CF_ACCESS_CLIENT_SECRET="$(cat ~/.secrets/gtr-cf-access-client-secret)"
```

pi evaluates it on every request, and DeepSeek Harness each time it loads its
patch — but only for header values. OpenCode reads a copy taken when its
generator last ran, and so does DeepSeek Harness for its keys, so a rotated key
needs `make setup` again for those two.

## How it works

Every generator sources `bin/common.sh`, which runs `bin/models.py` — the only
reader of `configs.jsonc` besides `bin/models-update.py`, which rewrites a
provider's models there in place — inside a subshell that has the `.env` sourced — a bash
file, so a `$(...)` in a value is evaluated there. That script validates the
file, expands every `${VAR}`, resolves the tags and splits a provider into one
route per API, and prints the result as shell assignments the caller evaluates;
a tag on two models, an unknown tag, an unknown `api` or a missing `default` is
an error, not a silent default. Because the `.env` never leaves that subshell,
resolving one provider holds its key and no other's.

**OpenCode** — `make setup` (and `make opencode-global`) write every provider
that has a token into the global `~/.config/opencode/opencode.json`: one custom
provider per route, `<name>-<api>`, with `baseURL` set to `<BASE_URL>/v1` (both
AI SDK packages append only `/messages` or `/chat/completions`), named after its
heading and each model named `<label> <model>` or `<model>`. Tokens
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
(first-line marker). The `gtr` provider shows up whenever its placeholder
token is set; picking it while `llama-server` is down fails that one request
and nothing else.

**DeepSeek Harness** — `~/.dsh/cordis.patch.yml`, the home patch every profile
(`web`, `headless`, …) applies and dsh itself never writes: one
`<name>-<api>` route under the `llm-pi-ai` row with
`api: anthropic-messages` and `baseURL` set to `BASE_URL` as it stands (the
Anthropic SDK underneath appends `/v1/messages`), or
`api: openai-completions` and `<BASE_URL>/v1`, the provider's `label` (or its
heading) as its `displayName`, and every model with its window, output cap and
input kinds; then the `agent-default-model` row naming the default provider's
`default` model. A model dsh does not find in its own catalog neither reasons
nor takes images unless declared, so a model with `reasoning` offers the
`low` / `medium` / `high` efforts. The key goes in as `apiKeyEnv` with its
value copied into `~/.dsh/.env` at 600, and each header as a `!!js` expression
that runs the `.env` command when the patch loads. `settings.yaml`, which the
Web UI writes, is merged over the patch and is never touched.

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

**pi** — `make setup` (and `make pi-global`) write every provider that has a
token into `~/.pi/agent/models.json` as one entry, under its `label` or, without
one, its name — what pi prints next to a model, `default [GTR9]`. Two providers
that would share an id fail `make check`, and a name without a label must not be
one of pi's built-in provider ids, or pi merges the entry into that one. pi takes
the API per model, so a provider whose models speak both stays one entry: every
model carries its limits and either `api: "anthropic-messages"` with `baseUrl`
set to `BASE_URL` as-is (pi hands it to the Anthropic SDK, which appends
`/v1/messages`) or `api: "openai-completions"` with `baseUrl` set to
`<BASE_URL>/v1`. No secret lands in the file:
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
| `~/.dsh/AGENTS.md` | DeepSeek Harness |
| `~/.commandcode/AGENTS.md` | Command Code |

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
| `~/.agents/skills/` | Codex, Command Code, DeepSeek Harness, opencode, pi |
| `~/.agents/agents/` | nothing yet — kept as a mirror |

`~/.agents` is the vendor-neutral root: pi reads it alongside
`~/.pi/agent/skills`, opencode alongside `~/.claude/skills`, DeepSeek Harness
alongside `~/.dsh/skills`, Command Code alongside `~/.commandcode/skills`, and
Codex uses it as its skills root. Subagents have no such convention — every CLI keeps its own
place (`~/.codex/agents/*.toml`, `~/.config/opencode/agent/*.md`, pi's subagent
extension) — so `~/.agents/agents` is a mirror nothing reads today.

What linking does:

- an existing symlink → replaced
- an existing real file or directory → skipped, never overwritten
- nothing there → created

A skill renamed or removed leaves its symlink behind, so write the old name
into `bin/removed-skills.txt`: the next `make setup-skills` deletes the link
from both roots. Anything else left dangling is named in the `checks` section,
which also reports the readers actually on your PATH. Re-run it after adding,
renaming or deleting one; `make list` shows what is linked where.

### OpenCode commands and plugins

Skills cover what every CLI can read. OpenCode's own extension points live in
`opencode/` and go to its global config dir:

| Target | What goes there |
|--------|-----------------|
| `~/.config/opencode/command/<name>.md` | a symlink to `opencode/command/<name>.md` — a slash command |
| `~/.config/opencode/plugin/<name>.js` | a symlink to `opencode/plugin/<name>.js` — a plugin |

Commands are plain markdown; plugins default-export a v2 definition
(`{ id, setup }`), which OpenCode validates but does not wrap. A plugin that
imports nothing from npm — everything a plugin needs arrives on the `ctx` that
`setup(ctx)` receives — resolves from wherever the file really lives, so it is
symlinked like the commands and stays editable here:

```js
export default { id: "example", async setup(ctx) { /* ctx.command, ctx.tool, ctx.event */ } }
```

A file in either directory that this repo did not put there is left alone —
both are recognised by pointing back here.

### pi extensions and subagents

pi's own extension points live in `pi/` and are symlinked into pi's agent
directory: `pi/extensions/*.ts` into `~/.pi/agent/extensions/`, where pi loads
every `*.ts` at startup, and `pi/agents/*.md` into `~/.pi/agent/agents/`, where
the subagents package finds agent definitions. pi resolves
an extension's imports of its own packages (`@earendil-works/pi-coding-agent`,
`@earendil-works/pi-tui`, `@earendil-works/pi-ai`, `typebox`) wherever the file
really lives, so it is symlinked as it stands, like an OpenCode plugin. Edit the file here
and run `/reload` in pi to pick it up. A file you put in either directory
yourself is left alone by `make uninstall`.

The two `freelance-*` skills read a `personal-config.json` next to their
`SKILL.md` — issuer name, address, registration number, output directory. Those
are gitignored: copy the `personal-config.example.json` beside them and fill it
in, and the skill will tell you when it is missing.

## Troubleshooting

**`'opencode' is not on your PATH — its generated config needs OpenCode (https://opencode.ai)`** — the generated config is only read by OpenCode itself, and the installer in `make setup` failed or was skipped. Install it by hand:
```bash
curl -fsSL https://opencode.ai/v2/install | bash
```

**`opencode` lists none of the providers** — the config is generated, not read live. Run `make opencode-global` (or `make setup`) and check `opencode models`. A key rotated in `.env` also needs the re-run: the config references the copy under `~/.config/opencode/claude-compatibles/`.

**A model is in `opencode models` but not under its provider in `/models`** — OpenCode's dialog lists a model under **Recent** or **Favorites** *instead of* under its provider, and only searching shows both. `~/.local/state/opencode/model.json` holds that recent list.

**`'pi' is not on your PATH`** — the generated `models.json` is only read by pi itself, which this repo does not install either:
```bash
npm install -g @earendil-works/pi-coding-agent   # or: curl -fsSL https://pi.dev/install.sh | sh
```

**pi answers `401 ... Your api key: ****f2- is invalid`** — the generated
`models.json` holds the token as a `!`-prefixed shell command, which pi
runs at request time. The deprecated `@mariozechner` package (0.73 and older)
resolves references differently and sends the text itself as the key.
Install `@earendil-works/pi-coding-agent`.

**`pi` lists none of the providers** — the config is generated, not read
live. Run `make pi-global` (or `make setup`) and check `/model`. A
`~/.pi/agent/models.json` this repo did not write is left alone (first-line
marker): merge it by hand or move it aside.

**`dsh` or `cmd` is not on your PATH after `make setup`** — its install step
says why: no `npm`, the install failed, or npm's global `bin` directory is not
on your PATH. Under asdf the setup regenerates the shim itself; with another
version manager, open a new shell or reshim. `installed, but '<command>
--version' failed` means the active Node.js is too old: dsh needs
`^22.19.0 || >=24.0.0`, Command Code `>=22`.

**`dsh` starts on a model you did not pick, or ignores a change to `configs.jsonc`** —
the Web UI saves its own choices to `~/.dsh/settings.yaml`, which dsh merges
over the generated patch. Remove the `agent-default-model` section (or the
`llm-pi-ai` provider it edited) there to fall back to the patch.

**`dsh` fails with `MISSING_CREDENTIAL`** — the variable an `apiKeyEnv` names
resolved to nothing. dsh reads it from `~/.dsh/.env`, which `make dsh-global`
writes; a key rotated here needs that re-run. An exported variable or a `.env`
in the working directory holding the same name wins over it.

**A provider talks to the wrong endpoint** — a `<NAME>_BASE_URL` in `.env`
overrides the default in `configs.jsonc`. `make list` prints the endpoint each
provider actually resolves to.

**A CLI starts on the wrong model, or pi reports the wrong context size** —
`configs.jsonc` is the only source. `make list` prints each model with the tags
it carries, which is what decides the slot — for OpenCode and pi, unless
`opencode.overrides` / `pi.overrides` name a model. Re-run `make pi-global && make opencode-global` afterwards — those two configs
are generated, not read live.

**`configs.jsonc: ... unknown tag` / `... no model is tagged 'default'` / `... api must be one of`** —
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

**You moved the repo** — every installed symlink is stale. Re-run `make setup` from the new location.

## References

Where each provider's key comes from:

| Provider | API key |
|----------|---------|
| DeepSeek | https://platform.deepseek.com/ |
| Command Code | https://commandcode.ai/studio/ (not on the Go plan) |
| gtr | No account and no key; `API_KEY` is a placeholder the CLIs only require to be non-empty |

- [DeepSeek: Claude Code Integration Guide](https://api-docs.deepseek.com/guides/agent_integrations/claude_code) — where its Anthropic endpoint is documented
- [Command Code: Provider API](https://commandcode.ai/docs/provider)
- [OpenCode: Config](https://opencode.ai/docs/config/) / [Providers](https://opencode.ai/docs/providers/)
- [pi: Custom models](https://pi.dev/docs/latest/models) / [Providers](https://pi.dev/docs/latest/providers) / [DeepSeek's pi integration guide](https://api-docs.deepseek.com/quick_start/agent_integrations/pi_mono/)
- [DeepSeek Harness: Documentation](https://deepseek-harness.github.io/deepseek-harness/) / [Safety notice](https://github.com/deepseek-ai/deepseek-harness/blob/main/SAFETY.md)
- [Command Code: Documentation](https://commandcode.ai/docs)
