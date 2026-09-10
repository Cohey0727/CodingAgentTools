#!/usr/bin/env bash
# Register every configured provider in Reasonix's global config
# (`make reasonix-global`). Reasonix has no launcher in this repo: a bare
# `reasonix` reads the generated ~/.reasonix/config.toml, and every provider in
# it is offered there.
#
# Everything comes from configs.jsonc. The config carries no secret: a provider
# entry names the variable its key lives in and never the key, which is the only
# shape Reasonix accepts. That variable has to resolve inside Reasonix's own
# directory — it reads neither this repo's .env nor the surrounding shell — so
# the value is copied into the .env beside the config, at 600, and a rotated key
# needs a re-run.
#
# A provider whose REQUEST_HEADERS reference the .env is left out: Reasonix
# sends header values exactly as written, so registering one would mean writing
# a secret into a config file. Declare it by hand if you want it.

set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
# shellcheck disable=SC1090
source "$ROOT/bin/common.sh"

OUT=$(reasonix_global_config_path)
ENV_OUT=$(reasonix_env_path)

if [ -f "$OUT" ] && ! generated_here "$OUT"; then
  echo "reasonix-global: $OUT already exists and was not generated here." >&2
  echo "  merge it by hand, or move it aside and re-run 'make reasonix-global'." >&2
  exit 1
fi

secret_headers() { # -> 0 when a header value would have to be written out in full
  local name
  while IFS= read -r name; do
    [ -n "$name" ] || continue
    [ -n "$(header_var "$name")" ] && return 0
  done < <(header_names)
  return 1
}

headers_toml() { # -> a `headers = { ... }` line, or nothing when there are none
  local name out=''
  while IFS= read -r name; do
    [ -n "$name" ] || continue
    out="$out${out:+, }\"$name\" = \"$(header_value "$name")\""
  done < <(header_names)
  [ -n "$out" ] || return 0
  printf 'headers = { %s }' "$out"
}

models_toml() { # -> the `models` array, in configs.jsonc order
  local id rest out=''
  while IFS=$'\x1f' read -r id rest; do
    [ -n "$id" ] || continue
    out="$out${out:+, }\"$id\""
  done < <(model_rows)
  printf 'models = [%s]' "$out"
}

overrides_toml() { # -> one `model_overrides` entry per model, so each carries the
                   # window and output cap configs.jsonc gives it rather than
                   # inheriting the provider's
  local id context max rest out=''
  while IFS=$'\x1f' read -r id context max rest; do
    [ -n "$id" ] || continue
    out="$out${out:+, }\"$id\" = { context_window = $context, max_output_tokens = $max }"
  done < <(model_rows)
  printf 'model_overrides = { %s }' "$out"
}

provider_toml() { # <provider> — one [[providers]] block, after models_resolve
  local headers
  headers=$(headers_toml)
  cat <<EOF
[[providers]]
name = "$1"
kind = "anthropic"
base_url = "$M_BASE_URL"
api_key_env = "$M_API_KEY_VAR"
$(models_toml)
default = "$M_DEFAULT_MODEL"
$(overrides_toml)${headers:+
$headers}
EOF
}

providers=()
blocks=()
skipped=()
while IFS= read -r provider; do
  [ -n "$provider" ] || continue
  configured_provider "$provider" || continue
  # A key Reasonix can only be handed through a variable it reads itself, and a
  # header it would carry in the clear, are the two things this config cannot
  # express. Both are reported rather than written around.
  if ! ( models_resolve "$provider" && [ -n "$M_API_KEY_VAR" ] ); then
    skipped+=("$provider: its API_KEY is written out in configs.jsonc, not referenced")
    continue
  fi
  if ( models_resolve "$provider" && secret_headers ); then
    skipped+=("$provider: its REQUEST_HEADERS carry a secret Reasonix cannot reference")
    continue
  fi
  providers+=("$provider")
  blocks+=("$(models_resolve "$provider"; provider_toml "$provider")")
done < <(provider_names)

if [ "${#blocks[@]}" -eq 0 ]; then
  echo "reasonix-global: no provider has a key yet — run 'make setup' first." >&2
  exit 1
fi

# The provider a session starts on, named with its model so the entry's own
# `default` is not the only thing deciding it.
primary=$(default_provider "${providers[@]}")
start_model=$(models_resolve "$primary"; printf '%s' "$M_DEFAULT_MODEL")

mkdir -p "$(dirname "$OUT")"
{
  printf '%s\n\n' "$REASONIX_GLOBAL_MARKER"
  printf 'default_model = "%s/%s"\n' "$primary" "$start_model"
  for block in "${blocks[@]}"; do
    printf '\n%s\n' "$block"
  done
} > "$OUT"

echo "  Wrote $OUT (${#blocks[@]} providers, default $primary/$start_model)"

# Reasonix resolves a provider key only from the .env in its own directory, so
# every variable the config names is copied there. Nothing else in that file is
# touched, and it stays at 600.
for provider in "${providers[@]}"; do
  (
    models_resolve "$provider"
    env_file_set "$ENV_OUT" "$M_API_KEY_VAR" "$M_API_KEY"
  )
done
echo "  Wrote ${#providers[@]} key(s) into $ENV_OUT"

for note in ${skipped[@]+"${skipped[@]}"}; do
  echo "  Left out $note" >&2
done
