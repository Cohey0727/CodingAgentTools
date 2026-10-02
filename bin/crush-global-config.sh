#!/usr/bin/env bash
# Register every configured provider in Crush's global config
# (`make crush-global`). A bare `crush`
# reads the generated ~/.config/crush/crushrc, and every provider in it is
# offered there.
#
# Everything comes from configs.jsonc. No secret is written here: a crushrc is
# bash, run by Crush when it starts, so an API_KEY or header value that
# configs.jsonc refers to as "${NAME}" goes in as the command that reads it back
# out of the .env — a rotated key needs no re-run.
#
# Crush ships a provider catalog of its own and merges an entry into the one
# whose id matches, so a provider declared here takes a route id of its own —
# one per API its models speak — and its models are declared in full.

set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
# shellcheck disable=SC1090
source "$ROOT/bin/common.sh"

OUT=$(crush_global_config_path)

if [ -f "$OUT" ] && ! generated_here "$OUT"; then
  echo "crush-global: $OUT already exists and was not generated here." >&2
  echo "  merge it by hand, or move it aside and re-run 'make crush-global'." >&2
  exit 1
fi

# A value configs.jsonc points at a variable for is referenced, never copied. One
# written literally there is already in git, so it is passed through as written.
crush_api_key() {
  if [ -n "$M_API_KEY_VAR" ] && crush_secret_ref "$M_API_KEY_VAR" "$M_API_KEY_FALLBACK"; then
    return 0
  fi
  printf '%s' "$M_API_KEY"
}

crush_header() { # <header name>
  local var
  var=$(header_var "$1")
  if [ -n "$var" ] && crush_secret_ref "$var" "$(header_fallback "$1")"; then
    return 0
  fi
  header_value "$1"
}

provider_crushrc() { # -> the resolved route's provider and model lines. Crush's
                     # Anthropic client appends v1/messages itself; its OpenAI
                     # one appends only chat/completions.
  local id name context max reasoning input images type base_url
  id=$(route_id)
  case $M_API in
    anthropic) type=anthropic; base_url=$M_BASE_URL ;;
    openai) type=openai-compat; base_url=$M_BASE_URL/v1 ;;
  esac

  printf 'provider add %s \\\n' "$id"
  printf '  --type %s \\\n' "$type"
  printf '  --base-url "%s" \\\n' "$base_url"
  while IFS= read -r name; do
    [ -n "$name" ] || continue
    printf '  --extra-header %s "%s" \\\n' "$name" "$(crush_header "$name")"
  done < <(header_names)
  printf '  --api-key "%s"\n' "$(crush_api_key)"

  # Crush keeps a window, an output cap and both capability flags per model, and
  # reads none of them from the provider, so every model carries its own. A flag
  # left out is false, which would quietly drop thinking or images.
  while IFS=$'\x1f' read -r name context max reasoning input; do
    [ -n "$name" ] || continue
    case $input in *image*) images=true ;; *) images=false ;; esac
    printf '\nmodel add %s/%s \\\n' "$id" "$name"
    printf '  --name "%s" \\\n' "$name"
    printf '  --context-window %s \\\n' "$context"
    printf '  --default-max-tokens %s \\\n' "$max"
    printf '  --can-reason %s \\\n' "$reasoning"
    printf '  --supports-images %s\n' "$images"
  done < <(model_rows)
}

providers=()
blocks=()
while IFS= read -r provider; do
  [ -n "$provider" ] || continue
  configured_provider "$provider" || continue
  providers+=("$provider")
  for api in $(models_resolve "$provider"; printf '%s' "$M_APIS"); do
    blocks+=("$(models_resolve "$provider" "$api"; provider_crushrc)")
  done
done < <(provider_names)

if [ "${#blocks[@]}" -eq 0 ]; then
  echo "crush-global: no provider has a key yet — run 'make setup' first." >&2
  exit 1
fi

# Crush has two model slots and the interactive agent runs on the large one, so
# they take the default provider's two models.
primary=$(default_provider "${providers[@]}")
slots=$(
  models_resolve "$primary"
  printf '%s/%s\n%s/%s' "$(route_id "$M_DEFAULT_API")" "$M_DEFAULT_MODEL" \
    "$(route_id "$M_SMALL_API")" "$M_SMALL_MODEL"
)
large=$(sed -n 1p <<<"$slots")
small=$(sed -n 2p <<<"$slots")

mkdir -p "$(dirname "$OUT")"
{
  printf '%s\n' "$CRUSH_GLOBAL_MARKER"
  for block in "${blocks[@]}"; do
    printf '\n%s\n' "$block"
  done
  printf '\nmodel large %s\n' "$large"
  printf 'model small %s\n' "$small"
} > "$OUT"

echo "  Wrote $OUT (${#blocks[@]} routes, large $large)"
