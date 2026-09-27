#!/usr/bin/env bash
# Serve DeepSeek Harness's Web UI behind a Cloudflare Tunnel (`make serve`).
#
# SERVE_HOST, from the environment or else .env, is the hostname the tunnel
# publishes it under; without it nothing is started. dsh keeps listening on
# 127.0.0.1 and accepts that hostname's Host and Origin headers, so the tunnel
# has to pass Host through unchanged. The startup URL dsh prints carries a
# token minted per process, and is printed a second time under the hostname.

set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
# shellcheck disable=SC1090
source "$ROOT/bin/common.sh"
# shellcheck disable=SC1091
source "$ROOT/bin/ui.sh"

host=${SERVE_HOST:-$(env_value SERVE_HOST)}
if [ -z "$host" ]; then
  note "SERVE_HOST is not set — check 'dsh web' in 'make setup', or set it in .env"
  exit 0
fi
if ! command -v dsh >/dev/null 2>&1; then
  echo "serve: 'dsh' is not on your PATH — run 'make setup' first." >&2
  exit 1
fi

dsh web --no-open --trusted-host "$host" | while IFS= read -r line; do
  printf '%s\n' "$line"
  case $line in
    'dsh web: '*'token='*)
      token=${line#*token=}
      printf 'dsh web: https://%s/?token=%s\n' "$host" "${token%%[&# ]*}"
      ;;
  esac
done
