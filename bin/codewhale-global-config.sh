#!/usr/bin/env bash
# Register every configured provider in Codewhale's global config
# (`make codewhale-global`). Codewhale has no launcher in this repo: a bare
# `codewhale` reads the generated ~/.codewhale/config.toml, and every provider
# in it is offered there.
#
# Everything comes from configs.jsonc. This is the one generated config that
# carries the keys themselves, and it is written at 600 because of it: the only
# indirection Codewhale offers a provider is `api_key_env`, which it resolves
# from the process environment alone — not from any file — so a reference would
# leave every provider unusable unless the surrounding shell already exported
# it. Re-run after rotating a key.
#
# Codewhale ships a provider catalog of its own, and an entry it does not
# recognise has to declare itself custom. A provider declared here therefore
# takes an id of its own, says which wire protocol it speaks, and declares its
# models in full.

set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
# shellcheck disable=SC1090
source "$ROOT/bin/common.sh"

OUT=$(codewhale_global_config_path)

if [ -f "$OUT" ] && ! generated_here "$OUT"; then
  echo "codewhale-global: $OUT already exists and was not generated here." >&2
  echo "  merge it by hand, or move it aside and re-run 'make codewhale-global'." >&2
  exit 1
fi

headers_toml() { # -> an `http_headers = { ... }` line, or nothing when there are none
  local name out=''
  while IFS= read -r name; do
    [ -n "$name" ] || continue
    out="$out${out:+, }\"$name\" = \"$(header_value "$name")\""
  done < <(header_names)
  [ -n "$out" ] || return 0
  printf 'http_headers = { %s }' "$out"
}

provider_toml() { # <provider> — its [providers.x] table, after models_resolve
  local headers
  headers=$(headers_toml)
  cat <<EOF
[providers.$(codewhale_provider_id)]
kind = "openai-compatible"
wire = "anthropic-messages"
base_url = "$M_BASE_URL"
api_key = "$M_API_KEY"${headers:+
$headers}
EOF
}

models_toml() { # <provider> — one [[custom_models]] entry per model, after
                # models_resolve. Codewhale reads a model's limits from nowhere
                # else, and an entry's base_url has to match its provider's.
  local id context max reasoning input images
  while IFS=$'\x1f' read -r id context max reasoning input; do
    [ -n "$id" ] || continue
    case $input in *image*) images=true ;; *) images=false ;; esac
    cat <<EOF

[[custom_models]]
provider = "$(codewhale_provider_id)"
base_url = "$M_BASE_URL"
id = "$id"
display_name = "$id"
reasoning = $reasoning
tool_call = true
attachment = $images
limit = { context = $context, output = $max }
EOF
  done < <(model_rows)
}

providers=()
blocks=()
while IFS= read -r provider; do
  [ -n "$provider" ] || continue
  configured_provider "$provider" || continue
  providers+=("$provider")
  blocks+=("$(
    models_resolve "$provider"
    provider_toml "$provider"
    models_toml "$provider"
  )")
done < <(provider_names)

if [ "${#blocks[@]}" -eq 0 ]; then
  echo "codewhale-global: no provider has a key yet — run 'make setup' first." >&2
  exit 1
fi

# The provider and model a session starts on.
primary=$(default_provider "${providers[@]}")
start=$(
  models_resolve "$primary"
  printf '%s\n%s' "$(codewhale_provider_id)" "$M_DEFAULT_MODEL"
)

# The file holds keys, so it is created at 600 before anything is written to it.
mkdir -p "$(dirname "$OUT")"
touch "$OUT"
chmod 600 "$OUT"
{
  printf '%s\n\n' "$CODEWHALE_GLOBAL_MARKER"
  printf 'provider = "%s"\n' "$(sed -n 1p <<<"$start")"
  printf 'default_text_model = "%s"\n' "$(sed -n 2p <<<"$start")"
  for block in "${blocks[@]}"; do
    printf '\n%s\n' "$block"
  done
} > "$OUT"
chmod 600 "$OUT"

echo "  Wrote $OUT (${#blocks[@]} providers, default $(sed -n 2p <<<"$start"), mode 600 — it holds the keys)"
