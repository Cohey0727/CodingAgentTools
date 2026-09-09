#!/usr/bin/env bash
# Register every configured provider in pi's global models.json
# (`make pi-global`). pi has no launcher in this repo: a bare `pi` reads the
# generated ~/.pi/agent/models.json, and /model lists every provider.
#
# Models come from providers/<name>/models.json. Tokens and HEADERS values stay
# in providers/<name>/.env: the generated file only holds shell commands that
# read them back out at request time, so a rotated token or a computed header
# needs no re-run.
#
# A provider is registered under its plain folder name, which is what pi shows
# next to a model. Where that name also exists in pi's own catalog, pi keeps
# this file's endpoint and token and adds the catalog's models to the list.

set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
PROVIDERS_DIR="$ROOT/providers"
# shellcheck disable=SC1090
source "$ROOT/bin/common.sh"

OUT=$(pi_global_models_path)
AGENT_DIR=$(dirname "$OUT")

if [ -f "$OUT" ] && ! generated_here "$OUT"; then
  echo "pi-global: $OUT already exists and was not generated here." >&2
  echo "  merge it by hand, or move it aside and re-run 'make pi-global'." >&2
  exit 1
fi

pi_global_header_ref() { # <name> -> command pi runs to read the value from .env
  printf "!bash -c '. %s; load_settings %s; header_value %s'" \
    "$ROOT/bin/common.sh" "$env_file" "$1"
}

providers=()
entries=()
for dir in "$PROVIDERS_DIR"/*/; do
  provider=$(basename "$dir")
  dir="${dir%/}"
  env_file="$dir/.env"
  [ -f "$env_file" ] && [ -f "$dir/models.json" ] || continue
  # Each provider is resolved in a subshell: load_settings exports the whole
  # .env, and providers must not leak into each other.
  entry=$(
    load_settings "$env_file"
    [ -n "$CFG_TOKEN" ] && [ -n "$CFG_BASE_URL" ] || exit 0
    models_resolve "$dir" || exit 1
    pi_provider_json "$provider" \
      "!grep -m1 -E '^API_TOKEN=.+' '$env_file' | cut -d= -f2-" \
      pi_global_header_ref
  )
  if [ -n "$entry" ]; then providers+=("$provider"); entries+=("$entry"); fi
done

if [ "${#entries[@]}" -eq 0 ]; then
  echo "pi-global: no provider has a token yet — run 'make setup' first." >&2
  exit 1
fi

# The provider pi starts on, and its main model.
start_provider=$(default_provider "${providers[@]}")
start_model=$(
  models_resolve "$PROVIDERS_DIR/$start_provider"
  printf '%s' "$M_DEFAULT_MODEL"
)

mkdir -p "$AGENT_DIR"
{
  printf '%s\n' "$PI_GLOBAL_MARKER"
  echo '{'
  echo '  "providers": {'
  for i in "${!entries[@]}"; do
    printf '%s' "${entries[$i]}"
    if [ "$i" -lt $(( ${#entries[@]} - 1 )) ]; then echo ','; fi
  done
  echo '  }'
  echo '}'
} > "$OUT"

echo "  Wrote $OUT (${#entries[@]} providers)"

# pi starts on defaultProvider / defaultModel from its own user settings, which
# also hold the theme and the installed packages — so the file is merged, never
# rewritten. Ctrl+S in /model writes the same two keys.
settings="$AGENT_DIR/settings.json"
if command -v python3 >/dev/null 2>&1; then
  python3 - "$settings" "$start_provider" "$start_model" <<'EOF'
import json, os, sys
path, provider, model = sys.argv[1:4]
try:
    with open(path) as f:
        data = json.load(f)
except (FileNotFoundError, ValueError):
    data = {}
data["defaultProvider"] = provider
data["defaultModel"] = model
tmp = path + ".tmp"
with open(tmp, "w") as f:
    json.dump(data, f, indent=2)
    f.write("\n")
os.replace(tmp, path)
EOF
  echo "  Set pi's startup model to $start_provider/$start_model"
else
  echo "  pi's startup model needs python3 — pick it with /model then Ctrl+S" >&2
fi
