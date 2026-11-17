#!/usr/bin/env bash
# Turn Superpowers (obra/superpowers) on in Claude Code and Codex, or off again.
#
#   bin/superpowers.sh          turn it on (`make setup-superpowers`, part of `make setup`)
#   bin/superpowers.sh remove   turn it off (`make uninstall`)
#
# Each CLI installs it from the marketplace it ships with. pi takes it from
# PI_PACKAGES in bin/common.sh and OpenCode from OPENCODE_PLUGINS in
# bin/setup.sh, so `make setup` installs those with the rest of their packages.

set -euo pipefail

# shellcheck disable=SC1091
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/skills-common.sh"

CLAUDE_PLUGIN=superpowers@claude-plugins-official
CODEX_PLUGIN=superpowers@openai-curated

codex_plugin_installed() { # -> 0 when Codex lists the plugin as installed
  codex plugin list 2>/dev/null | grep -E "^$CODEX_PLUGIN +installed" >/dev/null
}

setup_claude() {
  section 'Claude Code'
  if ! command -v claude >/dev/null 2>&1; then
    warn "skipped — 'claude' is not on your PATH"
    return 0
  fi
  case $(claude_plugin_state "$CLAUDE_PLUGIN") in
    absent)
      if claude plugin install "$CLAUDE_PLUGIN" >/dev/null 2>&1; then
        ok "plugin $CLAUDE_PLUGIN installed"
      else
        warn "install failed — run 'claude plugin install $CLAUDE_PLUGIN' by hand"
      fi
      ;;
    disabled)
      if claude plugin enable "$CLAUDE_PLUGIN" >/dev/null 2>&1; then
        ok "plugin $CLAUDE_PLUGIN enabled"
      else
        warn "enable failed — run 'claude plugin enable $CLAUDE_PLUGIN' by hand"
      fi
      ;;
    enabled) ok "plugin $CLAUDE_PLUGIN already enabled" ;;
  esac
}

setup_codex() {
  section 'Codex'
  if ! command -v codex >/dev/null 2>&1; then
    warn "skipped — 'codex' is not on your PATH"
    return 0
  fi
  if codex_plugin_installed; then
    ok "plugin $CODEX_PLUGIN already installed"
  elif codex plugin add "$CODEX_PLUGIN" >/dev/null 2>&1; then
    ok "plugin $CODEX_PLUGIN installed"
  else
    warn "install failed — run 'codex plugin add $CODEX_PLUGIN' by hand"
  fi
}

remove_all() {
  local removed=0
  section 'Superpowers'
  if command -v claude >/dev/null 2>&1 \
    && [ "$(claude_plugin_state "$CLAUDE_PLUGIN")" != absent ] \
    && claude plugin uninstall "$CLAUDE_PLUGIN" >/dev/null 2>&1; then
    ok "removed the Claude Code plugin $CLAUDE_PLUGIN"
    removed=1
  fi
  if command -v codex >/dev/null 2>&1 && codex_plugin_installed \
    && codex plugin remove "$CODEX_PLUGIN" >/dev/null 2>&1; then
    ok "removed the Codex plugin $CODEX_PLUGIN"
    removed=1
  fi
  [ "$removed" = 1 ] || note 'nothing installed'
}

case ${1:-} in
  remove) remove_all ;;
  '')
    banner
    setup_claude
    setup_codex
    echo
    ;;
  *)
    echo "usage: $0 [remove]" >&2
    exit 2
    ;;
esac
