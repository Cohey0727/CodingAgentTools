#!/usr/bin/env bash
# Register every configured provider in OpenCode's global config
# (`make opencode-global`). OpenCode has no launcher in this repo: a bare
# `opencode` reads the generated ~/.config/opencode/opencode.json, and /models
# lists every provider.
#
# Models come from providers/<name>/models.json. The token and each HEADERS
# value stay in providers/<name>/.env: the config references them as {file:...}
# pointing at a copy this script writes (chmod 600), so the config itself
# carries no secrets. Re-run after editing either file — the copies are replaced.
#
# A provider whose models.json sets "opencode": { "lean": true } also gets an
# agent of its own, pinned to its model, that replaces OpenCode's stock system
# prompt with a short one and drops the tools a small self-hosted model has no
# use for. The session starts on that agent when the provider is also the
# default one.

set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
PROVIDERS_DIR="$ROOT/providers"
LEAN_PROMPT="$ROOT/bin/opencode-lean-prompt.md"
# shellcheck disable=SC1090
source "$ROOT/bin/common.sh"

OUT=$(opencode_global_config_path)
CONFIG_DIR=$(dirname "$OUT")
TOKENS_DIR=$(opencode_tokens_dir)

if [ -f "$OUT" ] && ! generated_here "$OUT"; then
  echo "opencode-global: $OUT already exists and was not generated here." >&2
  echo "  merge it by hand, or move it aside and re-run 'make opencode-global'." >&2
  exit 1
fi

# Every provider with a token, an endpoint and a valid models.json. Each is
# resolved in a subshell: load_settings exports the whole .env, and providers
# must not leak into each other.
providers=()
for dir in "$PROVIDERS_DIR"/*/; do
  provider=$(basename "$dir")
  dir="${dir%/}"
  [ -f "$dir/.env" ] && [ -f "$dir/models.json" ] || continue
  if ( load_settings "$dir/.env"; [ -n "$CFG_TOKEN" ] && [ -n "$CFG_BASE_URL" ] ) && models_check "$dir"; then
    providers+=("$provider")
  fi
done

if [ "${#providers[@]}" -eq 0 ]; then
  echo "opencode-global: no provider has a token yet — run 'make setup' first." >&2
  exit 1
fi

# The provider the session's model / small_model start on.
default_provider=$(default_provider "${providers[@]}")

default_models=$(
  models_resolve "$PROVIDERS_DIR/$default_provider"
  printf '%s\n%s' "$M_DEFAULT_MODEL" "$M_SMALL_MODEL"
)
model="$default_provider-anthropic/$(head -1 <<<"$default_models")"
small_model="$default_provider-anthropic/$(tail -n +2 <<<"$default_models")"

# The tokens dir is fully managed here: wipe it, then write the current set so
# providers whose .env lost their token leave no stale secret behind. HEADERS
# values are stored the same way, one file per header.
mkdir -p "$TOKENS_DIR"
chmod 700 "$TOKENS_DIR"
rm -f "$TOKENS_DIR"/*.token "$TOKENS_DIR"/*.header "$TOKENS_DIR"/*.prompt.md

opencode_header_ref() { # <name> -> {file:...} reference for the provider in scope
  printf '{file:%s/%s.%s.header}' "$TOKENS_DIR" "$provider" "$1"
}

lean_provider() { # <provider> — does its models.json ask for the lean agent?
  ( models_resolve "$PROVIDERS_DIR/$1"; [ "$M_OPENCODE_LEAN" = true ] )
}

entries=()
agents=()
for provider in "${providers[@]}"; do
  entries+=("$(
    load_settings "$PROVIDERS_DIR/$provider/.env"
    models_resolve "$PROVIDERS_DIR/$provider"
    printf '%s' "$CFG_TOKEN" > "$TOKENS_DIR/$provider.token"
    chmod 600 "$TOKENS_DIR/$provider.token"
    while IFS= read -r name; do
      [ -n "$name" ] || continue
      printf '%s' "$(header_value "$name")" > "$TOKENS_DIR/$provider.$name.header"
      chmod 600 "$TOKENS_DIR/$provider.$name.header"
    done < <(header_names)
    opencode_provider_json "$provider" "{file:$TOKENS_DIR/$provider.token}" opencode_header_ref
  )")
  if lean_provider "$provider"; then
    cp "$LEAN_PROMPT" "$TOKENS_DIR/$provider.prompt.md"
    agents+=("$(
      models_resolve "$PROVIDERS_DIR/$provider"
      opencode_agent_json "$provider" "$TOKENS_DIR/$provider.prompt.md"
    )")
  fi
done

# The session starts on the default provider's model, so it may as well start
# on that provider's lean agent when it has one.
default_agent=''
if lean_provider "$default_provider"; then
  default_agent="$default_provider"
fi

mkdir -p "$CONFIG_DIR"
{
  printf '%s\n' "$OPENCODE_GLOBAL_MARKER"
  echo '{'
  echo '  "$schema": "https://opencode.ai/config.json",'
  echo '  "provider": {'
  for i in "${!entries[@]}"; do
    printf '%s' "${entries[$i]}"
    if [ "$i" -lt $(( ${#entries[@]} - 1 )) ]; then echo ','; fi
  done
  echo '  },'
  if [ "${#agents[@]}" -gt 0 ]; then
    echo '  "agent": {'
    for i in "${!agents[@]}"; do
      printf '%s' "${agents[$i]}"
      if [ "$i" -lt $(( ${#agents[@]} - 1 )) ]; then echo ','; fi
    done
    echo '  },'
  fi
  if [ -n "$default_agent" ]; then
    printf '  "default_agent": "%s",\n' "$default_agent"
  fi
  printf '  "model": "%s",\n' "$model"
  printf '  "small_model": "%s"\n' "$small_model"
  echo '}'
} > "$OUT"

echo "  Wrote $OUT (${#entries[@]} providers, ${#agents[@]} lean agents, default $model)"
