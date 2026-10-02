#!/usr/bin/env bash
# Register every configured provider in DeepSeek Harness's home patch
# (`make dsh-global`). Every profile dsh boots —
# `dsh web`, `dsh --profile headless` — applies the generated
# ~/.dsh/cordis.patch.yml, and every provider in it is offered there — once per
# API its models speak, since a dsh route takes one API and one base URL.
#
# Everything comes from configs.jsonc. The patch is the file written, not
# settings.yaml: dsh never writes a patch, while its Web UI saves into
# settings.yaml, which is merged over the patch — so a model picked or a
# provider edited in the UI still wins, and a re-run here does not erase it.
#
# A provider's key can only be named: apiKeyEnv resolves from the process
# environment, dsh's credentials file, a .env in the working directory, then the
# .env in dsh's home. The value is copied into that last one at 600, so a rotated
# key needs a re-run. A header takes a value, but a `!!js` expression in a patch
# is evaluated when the patch loads, so a header configs.jsonc references is read
# back out of this repo's .env by the command pi and Crush run, and nothing is
# copied.

set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
# shellcheck disable=SC1090
source "$ROOT/bin/common.sh"

OUT=$(dsh_global_config_path)
ENV_OUT=$(dsh_env_path)

if [ -f "$OUT" ] && ! generated_here "$OUT"; then
  echo "dsh-global: $OUT already exists and was not generated here." >&2
  echo "  merge it by hand, or move it aside and re-run 'make dsh-global'." >&2
  exit 1
fi

yaml_quote() { # <text> -> a single-quoted YAML scalar, which escapes nothing but '
  printf "'%s'" "${1//\'/\'\'}"
}

js_quote() { # <text> -> a double-quoted JavaScript string
  local s=${1//\\/\\\\}
  printf '"%s"' "${s//\"/\\\"}"
}

header_yaml() { # <header name> -> its value: a `!!js` expression running the
                # command that prints it, or the literal when configs.jsonc
                # writes one
  local var command
  var=$(header_var "$1")
  if [ -n "$var" ] && command=$(secret_command "$var" "$(header_fallback "$1")"); then
    printf '!!js %s' "$(yaml_quote \
      "process.getBuiltinModule('node:child_process').execSync($(js_quote "$command"), { encoding: 'utf8' })")"
    return 0
  fi
  yaml_quote "$(header_value "$1")"
}

models_yaml() { # -> one `models` entry per model, after models_resolve. dsh
                # treats a model missing from its catalog as text-only and not
                # reasoning unless the entry says otherwise. The effort names are
                # Anthropic's; an endpoint on budget-based thinking reads only
                # which levels are offered.
  local id context max reasoning input kinds efforts
  while IFS=$'\x1f' read -r id context max reasoning input; do
    [ -n "$id" ] || continue
    kinds=$(printf '%s' "$input" | sed "s/[^,][^,]*/'&'/g; s/,/, /g")
    case $reasoning in
      true) efforts="{ 'off': null, 'low': 'low', 'medium': 'medium', 'high': 'high' }" ;;
      *) efforts=false ;;
    esac
    cat <<EOF
          - id: $(yaml_quote "$id")
            name: $(yaml_quote "$id")
            contextWindow: $context
            maxTokens: $max
            input: [$kinds]
            reasoningEfforts: $efforts
EOF
  done < <(model_rows)
}

provider_yaml() { # -> the resolved route under `providers`. dsh's Anthropic
                  # client appends /v1/messages itself; its OpenAI one appends
                  # only /chat/completions.
  local name headers='' api base_url
  while IFS= read -r name; do
    [ -n "$name" ] || continue
    headers="$headers
          $(yaml_quote "$name"): $(header_yaml "$name")"
  done < <(header_names)
  case $M_API in
    anthropic) api=anthropic-messages; base_url=$M_BASE_URL ;;
    openai) api=openai-completions; base_url=$M_BASE_URL/v1 ;;
  esac
  cat <<EOF
      $(yaml_quote "$(route_id)"):
        displayName: $(yaml_quote "${M_LABEL:-$M_SECTION}")
        api: $(yaml_quote "$api")
        baseURL: $(yaml_quote "$base_url")
        apiKeyEnv: $(yaml_quote "$M_API_KEY_VAR")${headers:+
        headers:$headers}
        models:
$(models_yaml)
EOF
}

providers=()
blocks=()
skipped=()
while IFS= read -r provider; do
  [ -n "$provider" ] || continue
  configured_provider "$provider" || continue
  if ! ( models_resolve "$provider" && [ -n "$M_API_KEY_VAR" ] ); then
    skipped+=("$provider: its API_KEY is written out in configs.jsonc, not referenced")
    continue
  fi
  providers+=("$provider")
  for api in $(models_resolve "$provider"; printf '%s' "$M_APIS"); do
    blocks+=("$(models_resolve "$provider" "$api"; provider_yaml)")
  done
done < <(provider_names)

if [ "${#blocks[@]}" -eq 0 ]; then
  echo "dsh-global: no provider has a key yet — run 'make setup' first." >&2
  exit 1
fi

primary=$(default_provider "${providers[@]}")
start=$(
  models_resolve "$primary"
  printf '%s\n%s' "$(route_id "$M_DEFAULT_API")" "$M_DEFAULT_MODEL"
)

# A patch row's `config` replaces the row's config as a whole. Neither row has
# one of its own worth keeping: the provider row ships empty, and the model row
# holds only the selection written here.
mkdir -p "$(dirname "$OUT")"
{
  printf '%s\n\n' "$DSH_GLOBAL_MARKER"
  echo '- id: llm-pi-ai'
  echo '  config:'
  echo '    providers:'
  for block in "${blocks[@]}"; do
    printf '%s\n' "$block"
  done
  echo
  echo '- id: agent-default-model'
  echo '  config:'
  printf '    provider: %s\n' "$(yaml_quote "$(sed -n 1p <<<"$start")")"
  printf '    model: %s\n' "$(yaml_quote "$(sed -n 2p <<<"$start")")"
} > "$OUT"

echo "  Wrote $OUT (${#blocks[@]} routes, default $(sed -n 2p <<<"$start"))"

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
