#!/usr/bin/env bash
# Register every configured provider in pi's global models.json
# (`make pi-global`). A bare `pi` reads the
# generated ~/.pi/agent/models.json, and /model lists every provider.
#
# Everything comes from configs.jsonc. No secret is written here: an API_KEY or
# header value that configs.jsonc refers to as "${NAME}" becomes a shell command
# pi runs at request time to read it back out of the .env, so a rotated key or a
# computed header needs no re-run.
#
# A provider is registered once per API its models speak, as "<name>-<api>":
# pi takes one base URL and one API per provider entry.
#
# Providers connected with OpenCode's /connect stay OpenCode's and are not in
# configs.jsonc. Every one pi also has built in gets an entry in pi's auth.json
# that reads the key back out of OpenCode's store.

set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
# shellcheck disable=SC1090
source "$ROOT/bin/common.sh"

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
  configured_provider "$provider" || continue
  providers+=("$provider")
  # Each route is resolved in a subshell so none leaks into the next.
  for api in $(models_resolve "$provider"; printf '%s' "$M_APIS"); do
    entries+=("$(
      models_resolve "$provider" "$api"
      pi_provider_json "$(pi_api_key_ref)" pi_header_ref
    )")
  done
done < <(provider_names)

if [ "${#entries[@]}" -eq 0 ]; then
  echo "pi-global: no provider has a key yet — run 'make setup' first." >&2
  exit 1
fi

# The route pi starts on, and its main model.
primary=$(default_provider "${providers[@]}")
start=$(
  models_resolve "$primary"
  printf '%s\n%s' "$(route_id "$M_DEFAULT_API")" "$M_DEFAULT_MODEL"
)
start_route=$(sed -n 1p <<<"$start")
start_model=$(sed -n 2p <<<"$start")

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

echo "  Wrote $OUT (${#entries[@]} routes)"

# pi starts on defaultProvider / defaultModel from its own user settings, which
# also hold the theme and the installed packages — so the file is merged, never
# rewritten. Ctrl+S in /model writes the same two keys. configs.jsonc's
# top-level pi.overrides is merged in after them, so its keys win.
settings="$AGENT_DIR/settings.json"
if command -v python3 >/dev/null 2>&1; then
  python3 - "$settings" "$start_route" "$start_model" <<'EOF'
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
  merged=$("$PYTHON" "$ROOT/bin/models.py" pi-merge <"$settings")
  printf '%s\n' "$merged" >"$settings.tmp" && mv "$settings.tmp" "$settings"
  startup=$("$PYTHON" -c 'import json, sys; d = json.load(open(sys.argv[1])); print(d.get("defaultProvider"), d.get("defaultModel"), sep="/")' "$settings")
  echo "  Set pi's startup model to $startup"
else
  echo "  pi's startup model needs python3 — pick it with /model then Ctrl+S" >&2
fi

# Keys held by OpenCode's /connect, for the providers pi has built in.
if ! command -v pi >/dev/null 2>&1; then
  echo "  pi is not on PATH — skipped linking OpenCode's /connect keys" >&2
elif [ ! -f "$(opencode_auth_path)" ]; then
  pi_link_opencode_auth | sed 's/^/  pi auth: /'
else
  linked=()
  while IFS= read -r id; do
    [ -n "$id" ] || continue
    pi_knows_provider "$id" && linked+=("$id")
  done < <(opencode_auth_ids)
  pi_link_opencode_auth ${linked[@]+"${linked[@]}"} | sed 's/^/  pi auth: /'
fi

# pi-mcp-adapter reads OpenCode's MCP servers from its generated opencode.json,
# so configs.jsonc's opencode.overrides.mcp is the one list both CLIs run.
# Anything else in pi's mcp.json is kept.
"$PYTHON" - "$AGENT_DIR/mcp.json" <<'EOF'
import json, os, sys
path = sys.argv[1]
try:
    with open(path) as f:
        data = json.load(f)
except FileNotFoundError:
    data = {}
imports = data.setdefault("imports", [])
if "opencode" not in imports:
    imports.append("opencode")
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(data, f, indent=2)
        f.write("\n")
    os.replace(tmp, path)
EOF
echo "  Pointed pi's MCP servers at OpenCode's config in $AGENT_DIR/mcp.json"
