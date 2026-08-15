#!/usr/bin/env bash
# Target overview (`make help`).

set -euo pipefail

# shellcheck disable=SC1091
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

banner

section 'targets'
printf '  %s%-18s%s %s\n' "$B" 'make setup' "$RST" 'link skills/, agents/ and AGENTS.md into every agent CLI'
printf '  %s%-18s%s %s\n' "$B" 'make list' "$RST" 'show what this repo manages and where it is installed'
printf '  %s%-18s%s %s\n' "$B" 'make uninstall' "$RST" 'remove the symlinks setup created'
printf '  %s%-18s%s %s\n' "$B" 'make help' "$RST" 'this screen'

section 'notes'
note 'everything is installed as a symlink — edits here take effect immediately'
note '~/.claude/skills is read by Claude Code and opencode'
note '~/.agents/skills is read by Codex, opencode and pi'
note 'AGENTS.md is the single global instruction file — Claude Code reads it as ~/.claude/CLAUDE.md'
note 'real files and directories at a target path are never overwritten'
echo
