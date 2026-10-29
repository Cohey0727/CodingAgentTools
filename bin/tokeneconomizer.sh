#!/usr/bin/env bash
# Turn TokenEconomizer (vendor/tokeneconomizer) on in Claude Code, pi and
# OpenCode, or off again.
#
#   bin/tokeneconomizer.sh          turn it on (`make setup-tokeneconomizer`, part of `make setup`)
#   bin/tokeneconomizer.sh remove   turn it off (`make uninstall`)
#
#   Claude Code  the folder is the "tokeneconomizer" marketplace and its plugin
#                is installed from it. The tool catalog tool pruning reads is
#                recorded again on every run, as Claude Code updates change it.
#   pi           the folder is a local package in pi's user settings, loaded
#                where it is.
#   OpenCode     its server plugin is symlinked into OpenCode's plugin folder.
#                The background service loads it on its next start.

set -euo pipefail

# shellcheck disable=SC1091
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/skills-common.sh"

TE_SRC="$ROOT/vendor/tokeneconomizer"
TE_NAME=tokeneconomizer

opencode_target() { printf '%s/%s.ts' "$(opencode_plugin_dir)" "$TE_NAME"; }

setup_claude() {
  claude_vendor_plugin "$TE_NAME" "$TE_SRC" || return 0
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
  section 'OpenCode'
  link_vendored "$TE_SRC/plugin/opencode/$TE_NAME.ts" "$(opencode_target)"
  note "OpenCode's background service loads it on its next start: opencode service restart"
}

remove_all() {
  local removed=0
  section 'TokenEconomizer'
  claude_vendor_plugin_remove "$TE_NAME" "$TE_SRC" && removed=1
  if command -v pi >/dev/null 2>&1 && pi remove "$TE_SRC" >/dev/null 2>&1; then
    ok "removed pi package $(tilde "$TE_SRC")"
    removed=1
  fi
  unlink_vendored "$(opencode_target)" && removed=1
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
