#!/usr/bin/env bash
# Print "<the id OpenCode files a provider under>/<model>", so nothing outside
# configs.jsonc has to spell a model id or a provider prefix.
#
#   bin/model-ref.sh <provider> [main|small]

set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
# shellcheck disable=SC1090
source "$ROOT/bin/common.sh"

provider=${1:?usage: model-ref.sh <provider> [main|small]}
role=${2:-main}

models_resolve "$provider"

case $role in
  main) model=$M_DEFAULT_MODEL ;;
  small) model=$M_SMALL_MODEL ;;
  *) echo "model-ref.sh: role must be 'main' or 'small', got '$role'" >&2; exit 2 ;;
esac

printf '%s/%s\n' "$(opencode_provider_id "$provider")" "$model"
