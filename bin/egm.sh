#!/usr/bin/env bash
# Turn the Elephant-Goldfish Model plugin on in Claude Code, or off again.
#
#   bin/egm.sh          turn it on (`make setup-egm`, part of `make setup`)
#   bin/egm.sh remove   turn it off (`make uninstall`)
#
# Unlike Impeccable and TokenEconomizer it is not vendored: Claude Code clones
# the upstream repository as the "egm" marketplace and installs its plugin.

set -euo pipefail

# shellcheck disable=SC1091
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/skills-common.sh"

EGM_REPO=google/elephant-goldfish-model
EGM_NAME=egm

case ${1:-} in
  remove)
    section 'Elephant-Goldfish Model'
    claude_vendor_plugin_remove "$EGM_NAME" "$EGM_REPO" || note 'nothing installed from this repo'
    ;;
  '')
    banner
    claude_vendor_plugin "$EGM_NAME" "$EGM_REPO" || true
    echo
    ;;
  *)
    echo "usage: $0 [remove]" >&2
    exit 2
    ;;
esac
