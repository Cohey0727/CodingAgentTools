#!/usr/bin/env bash
# Refresh the model list of every provider configs.jsonc gives a "catalog"
# (`make update`). GET <BASE_URL><catalog> with the provider's key and headers,
# and hand the answer to bin/models-update.py with the provider's name, which
# rewrites that provider's models in configs.jsonc.

set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
# shellcheck disable=SC1090
source "$ROOT/bin/common.sh"

status=0
while IFS= read -r provider; do
  [ -n "$provider" ] || continue
  models_resolve "$provider" || { echo "update: $provider does not resolve" >&2; status=1; continue; }
  [ -n "$M_CATALOG" ] || continue
  if [ -z "$M_API_KEY" ]; then
    echo "update: $provider names a catalog but its API_KEY resolves to nothing — skipped" >&2
    continue
  fi
  request=(curl -sS -m 30 -w '\n%{http_code}' -H "Authorization: Bearer $M_API_KEY")
  while IFS= read -r header; do
    [ -n "$header" ] || continue
    request+=(-H "$header: $(header_value "$header")")
  done < <(header_names)
  if ! response=$("${request[@]}" "$M_BASE_URL$M_CATALOG"); then
    echo "update: $provider's catalog at $M_BASE_URL$M_CATALOG did not answer" >&2
    status=1
    continue
  fi
  code=${response##*$'\n'}
  body=${response%$'\n'*}
  if [ "$code" != 200 ]; then
    echo "update: $provider's catalog answered $code: $(head -1 <<<"$body")" >&2
    status=1
    continue
  fi
  "$PYTHON" "$COMMON_DIR/models-update.py" "$provider" <<<"$body" || status=1
done < <(provider_names)
exit $status
