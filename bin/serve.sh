#!/usr/bin/env bash
# Serve DeepSeek Harness's Web UI behind a Cloudflare Tunnel (`make serve`).
#
# SERVE_HOST, from the environment or else .env, is the hostname the tunnel
# publishes it under; without it nothing is started. dsh web listens on
# 127.0.0.1:$DSH_PORT and accepts that hostname's Host and Origin headers.
# nginx listens on 127.0.0.1:$RELAY_PORT, where the tunnel's route points, and
# answers a visitor dsh has not seen yet with its startup-token URL — so behind
# Cloudflare Access nobody handles the token. The token is new every time dsh
# starts, so nginx gets a config written for this run, in a directory only this
# user can read, removed on the way out.

set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
# shellcheck disable=SC1090
source "$ROOT/bin/common.sh"
# shellcheck disable=SC1091
source "$ROOT/bin/ui.sh"

DSH_PORT=3080   # dsh web's own default
RELAY_PORT=3081 # where the tunnel's route points

host=${SERVE_HOST:-$(env_value SERVE_HOST)}
if [ -z "$host" ]; then
  note "SERVE_HOST is not set — check 'dsh web' in 'make setup', or set it in .env"
  exit 0
fi
for cmd in dsh nginx; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "serve: '$cmd' is not on your PATH — run 'make setup' first." >&2
    exit 1
  fi
done

dir=$(mktemp -d)
dsh_pid='' cat_pid='' nginx_pid=''
cleanup() {
  local pid
  for pid in $nginx_pid $cat_pid $dsh_pid; do kill "$pid" 2>/dev/null || true; done
  wait 2>/dev/null || true
  rm -rf "$dir"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

mkfifo "$dir/dsh.out"
dsh web --no-open --port "$DSH_PORT" --trusted-host "$host" > "$dir/dsh.out" &
dsh_pid=$!
exec 3< "$dir/dsh.out"

token=''
while IFS= read -r line <&3; do
  printf '%s\n' "$line"
  case $line in
    'dsh web: '*'token='*)
      token=${line#*token=}
      token=${token%%[&# ]*}
      break
      ;;
  esac
done
if [ -z "$token" ]; then
  echo "serve: dsh web exited before printing its URL." >&2
  exit 1
fi
cat <&3 &
cat_pid=$!

conf=$(<"$ROOT/bin/serve.nginx.conf")
conf=${conf//@SERVE_HOST@/$host}
conf=${conf//@SERVE_TOKEN@/$token}
conf=${conf//@DSH_PORT@/$DSH_PORT}
conf=${conf//@RELAY_PORT@/$RELAY_PORT}
printf '%s\n' "$conf" > "$dir/nginx.conf"
nginx -p "$dir" -c "$dir/nginx.conf" -e stderr &
nginx_pid=$!
printf 'dsh web: https://%s/ — through the tunnel on 127.0.0.1:%s, no token needed\n' \
  "$host" "$RELAY_PORT"

while kill -0 "$dsh_pid" 2>/dev/null && kill -0 "$nginx_pid" 2>/dev/null; do
  sleep 1
done
if kill -0 "$dsh_pid" 2>/dev/null; then
  echo "serve: nginx exited — is 127.0.0.1:$RELAY_PORT already taken?" >&2
else
  echo "serve: dsh web exited." >&2
fi
exit 1
