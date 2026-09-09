#!/usr/bin/env bash
# Target overview (`make help`).

set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
# shellcheck disable=SC1091
source "$ROOT/bin/ui.sh"

target() { printf '  %s%-22s%s %s\n' "$B" "$1" "$RST" "$2"; }

banner

section 'targets'
target 'make setup' 'both halves: the provider wizard, then the skill symlinks'
target 'make setup-providers' 'pick providers, paste tokens, install launchers and the pi / OpenCode configs'
target 'make setup-skills' 'link skills/, agents/, AGENTS.md and opencode/ into every agent CLI'
target 'make list' 'every provider, skill, subagent and OpenCode extension, with its install status'
target 'make pi-global' "re-generate pi's global models.json from configs.json"
target 'make opencode-global' "re-generate OpenCode's global config from configs.json"
target 'make uninstall' 'remove the launchers, generated configs and symlinks this repo installed'
target 'make help' 'this screen'

section 'notes'
note 'configs.json holds every provider: endpoint, models and the tags naming each slot'
note '.env holds the values configs.json refers to as ${NAME} — nothing else'
note 'skills and AGENTS.md are installed as symlinks — edits here take effect immediately'
note '~/.claude/skills is read by Claude Code and opencode'
note '~/.agents/skills is read by Codex, opencode and pi'
note 'opencode/ adds OpenCode-only extensions: /goal keeps one objective going across turns'
note 'AGENTS.md is the single global instruction file — Claude Code reads it as ~/.claude/CLAUDE.md'
note 'real files and directories at a target path are never overwritten'
note '.env is never touched by uninstall'
echo
