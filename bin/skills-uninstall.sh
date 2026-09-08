#!/usr/bin/env bash
# Remove the symlinks `make setup-skills` created (`make uninstall`).
#
# Only symlinks pointing back into this repo are removed — skills installed
# from anywhere else are left untouched.

set -euo pipefail

# shellcheck disable=SC1091
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/skills-common.sh"

N_REMOVED=0

clean_dir() { # <root> <kind: skills|agents>
  local root=$1 kind=$2 target dest
  [ -d "$root/$kind" ] || return 0

  for target in "$root/$kind"/*; do
    [ -L "$target" ] || continue
    dest=$(readlink "$target")
    case $dest in
      "$ROOT"/*)
        rm "$target"
        N_REMOVED=$((N_REMOVED + 1))
        ok "removed $kind/$(basename "$target")"
        ;;
    esac
  done
}

banner

for root in "${TARGET_ROOTS[@]}"; do
  section "$(tilde "$root")"
  before=$N_REMOVED
  clean_dir "$root" skills
  clean_dir "$root" agents
  [ "$N_REMOVED" -gt "$before" ] || note 'nothing linked from this repo'
done

section 'AGENTS.md'
before=$N_REMOVED
for target in "${CONTEXT_TARGETS[@]}"; do
  linked_to_repo "$target" || continue
  rm "$target"
  N_REMOVED=$((N_REMOVED + 1))
  ok "removed $(tilde "$target")"
done
[ "$N_REMOVED" -gt "$before" ] || note 'nothing linked from this repo'

section 'summary'
printf '  %s%s symlink(s)%s removed\n' "$B" "$N_REMOVED" "$RST"
note 'the repo itself is untouched — run `make setup-skills` to link again'
echo
