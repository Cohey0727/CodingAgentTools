#!/usr/bin/env bash
# Everything this repo manages (`make list`): every provider with its launcher
# command and endpoint, then every skill and subagent with its install status.

set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
PROVIDERS_DIR="$ROOT/providers"
COMMON="$ROOT/bin/common.sh"
# shellcheck disable=SC1091
source "$ROOT/bin/ui.sh"

list_providers() {
  local p url id tags count
  count=$(set +e; . "$COMMON"; provider_names | wc -l | tr -d ' ')
  section "providers ($count)"
  while IFS= read -r p; do
    [ -n "$p" ] || continue
    url=$(set +e; . "$COMMON"; models_resolve "$p" && printf '%s' "$M_BASE_URL")
    printf '  %s%-10s%s %s->%s %-24s %s%s%s\n' \
      "$B" "$p" "$RST" "$DIM" "$RST" \
      "$(set +e; . "$COMMON"; provider_command "$p")" "$DIM" "$url" "$RST"
    while IFS=$'\t' read -r id tags; do
      [ -n "$id" ] || continue
      printf '  %s%13s%s %-24s %s%s%s\n' "$DIM" '' "$RST" "$id" "$DIM" "$tags" "$RST"
    done < <(set +e; . "$COMMON"; models_tags "$p")
  done < <(set +e; . "$COMMON"; provider_names)
}

banner
list_providers
SKIP_BANNER=1 "$ROOT/bin/skills-list.sh"
