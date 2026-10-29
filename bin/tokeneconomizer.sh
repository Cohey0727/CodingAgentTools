#!/usr/bin/env bash
# Turn TokenEconomizer (vendor/tokeneconomizer) on in Claude Code, pi and
# OpenCode, or off again.
#
#   bin/tokeneconomizer.sh          turn it on (`make setup-tokeneconomizer`, part of `make setup`)
#   bin/tokeneconomizer.sh remove   turn it off (`make uninstall`)
#
#   Claude Code  the folder is added as the "tokeneconomizer" marketplace and its
#                plugin installed and enabled; Claude Code reads a directory
#                marketplace's plugin from the folder itself, so an edit here
#                needs no reinstall. The tool catalog tool pruning reads is
#                recorded again on every run, as Claude Code updates change it.
#   pi           the folder is a local package in pi's user settings, loaded
#                where it is.
#   OpenCode     its server plugin is symlinked into OpenCode's plugin folder.
#                The background service loads it on its next start.
#
# A marketplace of the same name read from another folder, and a plugin file
# that is not a link back here, are someone else's and are left alone.

set -euo pipefail

# shellcheck disable=SC1091
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/skills-common.sh"

TE_SRC="$ROOT/vendor/tokeneconomizer"
TE_NAME=tokeneconomizer
TE_PLUGIN="$TE_NAME@$TE_NAME"

marketplace_source() { # -> the folder or repository Claude Code's marketplace of
                       # that name reads, empty when there is none
  claude plugin marketplace list --json 2>/dev/null | "$PYTHON" -c '
import json, sys
for m in json.load(sys.stdin):
    if m.get("name") == sys.argv[1]:
        print(m.get("path") or m.get("repo") or m.get("url") or "?")
' "$TE_NAME"
}

plugin_state() { # -> enabled | disabled | absent
  claude plugin list --json 2>/dev/null | "$PYTHON" -c '
import json, sys
found = [p for p in json.load(sys.stdin) if p.get("id") == sys.argv[1]]
print("absent" if not found else "enabled" if any(p.get("enabled") for p in found) else "disabled")
' "$TE_PLUGIN"
}

opencode_target() { printf '%s/%s.ts' "$(opencode_plugin_dir)" "$TE_NAME"; }

setup_claude() {
  local source
  section 'Claude Code'
  if ! command -v claude >/dev/null 2>&1; then
    warn "skipped — 'claude' is not on your PATH"
    return 0
  fi
  source=$(marketplace_source)
  case $source in
    '')
      if ! claude plugin marketplace add "$TE_SRC" >/dev/null 2>&1; then
        warn "marketplace add failed — run 'claude plugin marketplace add $TE_SRC' by hand"
        return 0
      fi
      ok "marketplace $TE_NAME -> $(tilde "$TE_SRC")"
      ;;
    "$TE_SRC") ok "marketplace $TE_NAME already reads $(tilde "$TE_SRC")" ;;
    *)
      warn "skipped — the $TE_NAME marketplace reads $(tilde "$source")"
      return 0
      ;;
  esac
  case $(plugin_state) in
    absent)
      if claude plugin install "$TE_PLUGIN" >/dev/null 2>&1; then
        ok "plugin $TE_PLUGIN installed"
      else
        warn "install failed — run 'claude plugin install $TE_PLUGIN' by hand"
        return 0
      fi
      ;;
    disabled)
      if claude plugin enable "$TE_PLUGIN" >/dev/null 2>&1; then
        ok "plugin $TE_PLUGIN enabled"
      else
        warn "enable failed — run 'claude plugin enable $TE_PLUGIN' by hand"
      fi
      ;;
    enabled) ok "plugin $TE_PLUGIN already enabled" ;;
  esac
  if "$TE_SRC/plugin/scripts/te" --host claude toolprune refresh-catalog >/dev/null 2>&1; then
    ok 'tool catalog recorded'
  else
    warn "tool catalog not recorded — run '$(tilde "$TE_SRC")/plugin/scripts/te --host claude toolprune refresh-catalog' by hand"
  fi
}

setup_pi() {
  section 'pi'
  if ! command -v pi >/dev/null 2>&1; then
    warn "skipped — 'pi' is not on your PATH"
    return 0
  fi
  if pi install "$TE_SRC" >/dev/null 2>&1; then
    ok "package $(tilde "$TE_SRC")"
  else
    warn "install failed — run 'pi install $TE_SRC' by hand"
  fi
}

setup_opencode() {
  local target
  section 'OpenCode'
  target=$(opencode_target)
  if [ -e "$target" ] && ! linked_to_repo "$target"; then
    warn "skipped — $(tilde "$target") is not a link into this repo"
    return 0
  fi
  mkdir -p "$(dirname "$target")"
  ln -sfn "$TE_SRC/plugin/opencode/$TE_NAME.ts" "$target"
  ok "$(tilde "$target")"
  note "OpenCode's background service loads it on its next start: opencode service restart"
}

remove_all() {
  local target removed=0
  section 'TokenEconomizer'
  if command -v claude >/dev/null 2>&1 && [ "$(marketplace_source)" = "$TE_SRC" ]; then
    claude plugin uninstall "$TE_PLUGIN" >/dev/null 2>&1 || true
    if claude plugin marketplace remove "$TE_NAME" >/dev/null 2>&1; then
      ok "removed the Claude Code plugin and marketplace $TE_NAME"
      removed=1
    fi
  fi
  if command -v pi >/dev/null 2>&1 && pi remove "$TE_SRC" >/dev/null 2>&1; then
    ok "removed pi package $(tilde "$TE_SRC")"
    removed=1
  fi
  target=$(opencode_target)
  if linked_to_repo "$target"; then
    rm "$target"
    ok "removed $(tilde "$target")"
    removed=1
  fi
  [ "$removed" = 1 ] || note 'nothing installed from this repo'
}

case ${1:-} in
  remove) remove_all ;;
  '')
    banner
    setup_claude
    setup_pi
    setup_opencode
    echo
    ;;
  *)
    echo "usage: $0 [remove]" >&2
    exit 2
    ;;
esac
