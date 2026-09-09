#!/usr/bin/env bash
# Print "<the id an agent files a provider under>/<model>" for one provider, so
# nothing outside configs.jsonc has to spell a model id or a provider prefix.
#
#   bin/model-ref.sh <provider> <agent> [main|small]
#
# "main" and "small" are the roles the agent names in model_tag and
# small_model_tag; which model fills each is the provider's tags.

set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
# shellcheck disable=SC1090
source "$ROOT/bin/common.sh"

provider=${1:?usage: model-ref.sh <provider> <agent> [main|small]}
agent=${2:?usage: model-ref.sh <provider> <agent> [main|small]}
role=${3:-main}

models_resolve "$provider" "$agent"

case $role in
  main) model=$M_MAIN_MODEL ;;
  small) model=$M_SMALL_MODEL ;;
  *) echo "model-ref.sh: role must be 'main' or 'small', got '$role'" >&2; exit 2 ;;
esac

if [ -z "$M_PROVIDER_ID" ] || [ -z "$model" ]; then
  echo "model-ref.sh: '$provider' is not registered with '$agent'" >&2
  exit 1
fi

printf '%s/%s\n' "$M_PROVIDER_ID" "$model"
