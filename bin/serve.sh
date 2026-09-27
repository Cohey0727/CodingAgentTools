#!/usr/bin/env bash
# Serve DeepSeek Harness's and OpenCode's Web UIs behind a Cloudflare Tunnel
# (`make serve`).
#
# SERVE_HOST and SERVE_OPENCODE_HOST, from the environment or else .env, are the
# hostnames the tunnel publishes dsh web and OpenCode under; each app starts
# only when its hostname is set. Both listen on 127.0.0.1 and nginx in front of
# them on 127.0.0.1:$RELAY_PORT, where every route of the tunnel points, telling
# them apart by Host. nginx signs a visitor in to each app, so behind Cloudflare
# Access nobody handles an app's own login: dsh's startup token is new every
# time dsh starts, and OpenCode gets a password made up for this run. So nginx
# gets a config written for this run, in a directory only this user can read,
# removed on the way out.

set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
# shellcheck disable=SC1090
source "$ROOT/bin/common.sh"
# shellcheck disable=SC1091
source "$ROOT/bin/ui.sh"

DSH_PORT=3080      # dsh web's own default
RELAY_PORT=3081    # where the tunnel's routes point
OPENCODE_PORT=3082

dsh_host=${SERVE_HOST:-$(env_value SERVE_HOST)}
opencode_host=${SERVE_OPENCODE_HOST:-$(env_value SERVE_OPENCODE_HOST)}
if [ -z "$dsh_host$opencode_host" ]; then
  note "SERVE_HOST and SERVE_OPENCODE_HOST are not set — check 'dsh web' or 'opencode web' in 'make setup', or set them in .env"
  exit 0
fi
need=(nginx)
if [ -n "$dsh_host" ]; then need+=(dsh); fi
if [ -n "$opencode_host" ]; then need+=(opencode); fi
for cmd in "${need[@]}"; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "serve: '$cmd' is not on your PATH — run 'make setup' first." >&2
    exit 1
  fi
done

dir=$(mktemp -d)
mkdir "$dir/sites"
pids=()  # every process started here, killed on the way out
names=() # what each of them is, for the one that exits first
cleanup() {
  local pid
  for pid in ${pids[@]+"${pids[@]}"}; do kill "$pid" 2>/dev/null || true; done
  wait 2>/dev/null || true
  rm -rf "$dir"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

fill() { # <template> -> it with this run's @NAME@ values
  local conf
  conf=$(<"$1")
  conf=${conf//@RELAY_PORT@/$RELAY_PORT}
  conf=${conf//@DSH_PORT@/$DSH_PORT}
  conf=${conf//@OPENCODE_PORT@/$OPENCODE_PORT}
  conf=${conf//@SERVE_HOST@/$dsh_host}
  conf=${conf//@SERVE_TOKEN@/${token:-}}
  conf=${conf//@SERVE_OPENCODE_HOST@/$opencode_host}
  conf=${conf//@OPENCODE_AUTH@/${opencode_auth:-}}
  printf '%s\n' "$conf"
}

if [ -n "$dsh_host" ]; then
  mkfifo "$dir/dsh.out"
  dsh web --no-open --port "$DSH_PORT" --trusted-host "$dsh_host" > "$dir/dsh.out" &
  pids+=("$!"); names+=('dsh web')
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
  # dsh's output keeps coming through, and its pipe drained.
  cat <&3 &
  pids+=("$!"); names+=('dsh web output')
  fill "$ROOT/bin/serve.dsh.nginx.conf" > "$dir/sites/dsh.conf"
  printf 'dsh web: https://%s/ — through the tunnel, no token needed\n' "$dsh_host"
fi

if [ -n "$opencode_host" ]; then
  password=$(LC_ALL=C tr -dc 'A-Za-z0-9' < /dev/urandom | head -c 32 || true)
  opencode_auth=$(printf 'opencode:%s' "$password" | base64 | tr -d '\n')
  # From $HOME, as OpenCode's own background service runs: the Web UI opens
  # whichever project it is asked to.
  (cd "$HOME" && OPENCODE_PASSWORD=$password exec opencode serve \
    --hostname 127.0.0.1 --port "$OPENCODE_PORT") &
  pids+=("$!"); names+=('opencode serve')
  fill "$ROOT/bin/serve.opencode.nginx.conf" > "$dir/sites/opencode.conf"
  printf 'opencode: https://%s/ — through the tunnel, no password needed\n' "$opencode_host"
fi

fill "$ROOT/bin/serve.nginx.conf" > "$dir/nginx.conf"
nginx -p "$dir" -c "$dir/nginx.conf" -e stderr &
pids+=("$!"); names+=("nginx on 127.0.0.1:$RELAY_PORT")

while true; do
  for i in "${!pids[@]}"; do
    if ! kill -0 "${pids[$i]}" 2>/dev/null; then
      echo "serve: ${names[$i]} exited — stopping the rest." >&2
      exit 1
    fi
  done
  sleep 1
done
