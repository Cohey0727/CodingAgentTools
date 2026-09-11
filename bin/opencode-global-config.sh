#!/usr/bin/env bash
# Register every configured provider in OpenCode's global config
# (`make opencode-global`). OpenCode has no launcher in this repo: a bare
# `opencode` reads the generated ~/.config/opencode/opencode.json, and /models
# lists every provider under one heading, apart from OpenCode's own services.
#
# Everything comes from configs.jsonc. The config itself carries no secret: each
# key and header value is referenced as {file:...} pointing at a copy this
# script writes (chmod 600) from the .env. Re-run after rotating a key — the
# copies are replaced, and copies of providers whose key was emptied are dropped.
#
# A provider whose configs.jsonc entry sets "opencode": { "lean": true } also gets
# an agent of its own, pinned to its model, that replaces OpenCode's stock system
# prompt with a short one and drops the tools a small self-hosted model has no
# use for. The session starts on that agent when the provider is also the
# default one.

set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
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

# Every provider whose key resolves to something.
providers=()
while IFS= read -r provider; do
  [ -n "$provider" ] || continue
  if configured_provider "$provider"; then providers+=("$provider"); fi
done < <(provider_names)

if [ "${#providers[@]}" -eq 0 ]; then
  echo "opencode-global: no provider has a key yet — run 'make setup' first." >&2
  exit 1
fi

# The provider the session's model / small_model start on.
default_provider=$(default_provider "${providers[@]}")

# The prefix is the id the provider is filed under in OpenCode.
default_models=$(
  models_resolve "$default_provider"
  printf '%s\n%s\n%s' "$(opencode_provider_id)" "$M_DEFAULT_MODEL" "$M_SMALL_MODEL"
)
default_id=$(sed -n 1p <<<"$default_models")
model="$default_id/$(sed -n 2p <<<"$default_models")"
small_model="$default_id/$(sed -n 3p <<<"$default_models")"

# The secrets dir is fully managed here: wipe it, then write the current set so
# a provider whose key was emptied leaves no stale copy behind.
mkdir -p "$TOKENS_DIR"
chmod 700 "$TOKENS_DIR"
rm -f "$TOKENS_DIR"/*.token "$TOKENS_DIR"/*.header "$TOKENS_DIR"/*.prompt.md

opencode_header_ref() { # <name> -> {file:...} reference for the provider in scope
  printf '{file:%s/%s.%s.header}' "$TOKENS_DIR" "$provider" "$1"
}

lean_provider() { # <provider> — does configs.jsonc ask for the lean agent?
  ( models_resolve "$1"; [ "$M_OPENCODE_LEAN" = true ] )
}

entries=()
agents=()
for provider in "${providers[@]}"; do
  entries+=("$(
    models_resolve "$provider"
    printf '%s' "$M_API_KEY" > "$TOKENS_DIR/$provider.token"
    chmod 600 "$TOKENS_DIR/$provider.token"
    while IFS= read -r name; do
      [ -n "$name" ] || continue
      printf '%s' "$(header_value "$name")" > "$TOKENS_DIR/$provider.$name.header"
      chmod 600 "$TOKENS_DIR/$provider.$name.header"
    done < <(header_names)
    opencode_provider_json "{file:$TOKENS_DIR/$provider.token}" opencode_header_ref
  )")
  if lean_provider "$provider"; then
    cp "$LEAN_PROMPT" "$TOKENS_DIR/$provider.prompt.md"
    agents+=("$(
      models_resolve "$provider"
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
