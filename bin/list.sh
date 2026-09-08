#!/usr/bin/env bash
# Everything this repo manages (`make list`): every provider with its launcher
# command and endpoint, then every skill and subagent with its install status.

set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
PROVIDERS_DIR="$ROOT/providers"
COMMON="$ROOT/bin/common.sh"
# shellcheck disable=SC1091
source "$ROOT/bin/ui.sh"

provider_names() { # every providers/<name>/ that has a .env.example
  local d
  for d in "$PROVIDERS_DIR"/*/; do
    [ -f "$d/.env.example" ] && basename "$d"
  done
  return 0
}

list_providers() {
  local p file cmd url
  section "providers ($(provider_names | wc -l | tr -d ' '))"
  while IFS= read -r p; do
    file="$PROVIDERS_DIR/$p/.env"
    [ -f "$file" ] || file="$PROVIDERS_DIR/$p/.env.example"
    cmd=$(set +e; . "$COMMON"; load_settings "$file"; launcher_name "$p")
    url=$(set +e; . "$COMMON"; load_settings "$file"; printf '%s' "$CFG_BASE_URL")
    printf '  %s%-10s%s %s->%s %-24s %s%s%s\n' \
      "$B" "$p" "$RST" "$DIM" "$RST" "$cmd" "$DIM" "$url" "$RST"
  done < <(provider_names)
}

banner
list_providers
SKIP_BANNER=1 "$ROOT/bin/skills-list.sh"
