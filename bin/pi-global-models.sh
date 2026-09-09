#!/usr/bin/env bash
# Register every configured provider in pi's global models.json
# (`make pi-global`). pi has no launcher in this repo: a bare `pi` reads the
# generated ~/.pi/agent/models.json, and /model lists every provider.
#
# Everything comes from configs.jsonc. No secret is written here: an API_KEY or
# header value that configs.jsonc refers to as "${NAME}" becomes a shell command
# pi runs at request time to read it back out of the .env, so a rotated key or a
# computed header needs no re-run.
#
# A provider is registered under its name in configs.jsonc, which is what pi shows
# next to a model. Where that name also exists in pi's own catalog, pi keeps
# this file's endpoint and key and adds the catalog's models to the list.

set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
# shellcheck disable=SC1090
source "$ROOT/bin/common.sh"

AGENT=$(basename "${BASH_SOURCE[0]}" -global-models.sh)
settings_resolve "$AGENT"

OUT=$(pi_global_models_path)
AGENT_DIR=$(dirname "$OUT")

if [ -f "$OUT" ] && ! generated_here "$OUT"; then
  echo "pi-global: $OUT already exists and was not generated here." >&2
  echo "  merge it by hand, or move it aside and re-run 'make pi-global'." >&2
  exit 1
fi

# A value configs.jsonc points at a variable for is referenced, never copied. One
# written literally there, or whose fallback cannot be a bare word in the
# command, is already in git, so it is passed through resolved.
pi_api_key_ref() {
  if [ -n "$M_API_KEY_VAR" ] && pi_secret_ref "$M_API_KEY_VAR" "$M_API_KEY_FALLBACK"; then
    return 0
  fi
  printf '%s' "$M_API_KEY"
}

pi_header_ref() { # <header name>
  local var
  var=$(header_var "$1")
  if [ -n "$var" ] && pi_secret_ref "$var" "$(header_fallback "$1")"; then
    return 0
  fi
  header_value "$1"
}

providers=()
entries=()
while IFS= read -r provider; do
  [ -n "$provider" ] || continue
  # Each provider is resolved in a subshell so none leaks into the next.
  entry=$(
    models_resolve "$provider" "$AGENT" || exit 1
    [ -n "$M_API_KEY" ] || exit 0
    [ -n "$M_PROVIDER_ID" ] || exit 0
    pi_provider_json "$M_PROVIDER_ID" "$(pi_api_key_ref)" pi_header_ref
  )
  if [ -n "$entry" ]; then providers+=("$provider"); entries+=("$entry"); fi
done < <(provider_names)

if [ "${#entries[@]}" -eq 0 ]; then
  echo "pi-global: no provider to register." >&2
  echo "  run 'make setup' to add a key, or check that some provider in" >&2
  echo "  configs.jsonc does not set schema.resolve to a blank one." >&2
  exit 1
fi

# The provider pi starts on, and its main model.
start_provider=$(default_provider "${providers[@]}")
start_model=$(
  models_resolve "$start_provider" "$AGENT"
  printf '%s' "$M_MAIN_MODEL"
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
