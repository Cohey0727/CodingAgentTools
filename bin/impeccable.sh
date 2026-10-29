#!/usr/bin/env bash
# Turn Impeccable (vendor/impeccable), the frontend design skill, on in every
# agent CLI, or off again.
#
#   bin/impeccable.sh          turn it on (`make setup-impeccable`, part of `make setup`)
#   bin/impeccable.sh remove   turn it off (`make uninstall`)
#
# Upstream builds the skill once per agent, naming that agent's tools and
# paths in it. Three of the builds are kept:
#
#   Claude Code  plugin/, through the "impeccable" marketplace: the skill, its
#                subagents, and the design hook that runs the detector after
#                each edit of a UI file and again when the turn ends
#   ~/.agents    .agents/skills/impeccable, linked into ~/.agents/skills, where
#                Codex, pi, OpenCode and the other agent CLIs read skills
#   OpenCode     .opencode/commands/impeccable.md, its /impeccable command

set -euo pipefail

# shellcheck disable=SC1091
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/skills-common.sh"

IMP_SRC="$ROOT/vendor/impeccable"
IMP_NAME=impeccable

skill_target() { printf '%s/.agents/skills/%s' "$HOME" "$IMP_NAME"; }
command_target() { printf '%s/%s.md' "$(opencode_command_dir)" "$IMP_NAME"; }

remove_all() {
  local removed=0
  section 'Impeccable'
  claude_vendor_plugin_remove "$IMP_NAME" "$IMP_SRC" && removed=1
  unlink_vendored "$(skill_target)" && removed=1
  unlink_vendored "$(command_target)" && removed=1
  [ "$removed" = 1 ] || note 'nothing installed from this repo'
}

case ${1:-} in
  remove) remove_all ;;
  '')
    banner
    claude_vendor_plugin "$IMP_NAME" "$IMP_SRC" || true
    section '~/.agents'
    link_vendored "$IMP_SRC/.agents/skills/$IMP_NAME" "$(skill_target)"
    section 'OpenCode'
    link_vendored "$IMP_SRC/.opencode/commands/$IMP_NAME.md" "$(command_target)"
    echo
    ;;
  *)
    echo "usage: $0 [remove]" >&2
    exit 2
    ;;
esac
