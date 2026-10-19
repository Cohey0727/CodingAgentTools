#!/usr/bin/env bash
# Keep bin/serve.sh running in the background as a service of this user's — a
# launchd agent on macOS, a systemd user unit elsewhere — started at login and
# again whenever it exits with an error, which it does when one of its apps
# exits.
#
#   bin/serve-service.sh          (re)start it while there is something to serve,
#                                 remove it once there is not (`make setup`)
#   bin/serve-service.sh remove   remove it (`make uninstall`)
#
# There is something to serve once SERVE_HOST or SERVE_OPENCODE_HOST is set in
# .env, or dsh is set up. The service gets this shell's PATH, where every app it
# starts was found, and each start of it reads .env afresh.

set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
# shellcheck disable=SC1090
source "$ROOT/bin/common.sh"
# shellcheck disable=SC1091
source "$ROOT/bin/ui.sh"

SERVICE=codingagenttools-serve

if [ "$(uname -s)" = Darwin ]; then
  kind=launchd
  template="$ROOT/bin/serve.launchd.plist"
  service_file="$HOME/Library/LaunchAgents/$SERVICE.plist"
  log="$HOME/Library/Logs/$SERVICE.log"
  domain="gui/$(id -u)"
else
  kind=systemd
  template="$ROOT/bin/serve.systemd.service"
  service_file="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user/$SERVICE.service"
fi

fill() { # <template> -> it with this service's @NAME@ values
  local conf
  conf=$(<"$1")
  conf=${conf//@SERVICE@/$SERVICE}
  conf=${conf//@SERVE@/$ROOT/bin/serve.sh}
  conf=${conf//@HOME@/$HOME}
  conf=${conf//@PATH@/$PATH}
  conf=${conf//@LOG@/${log:-}}
  printf '%s\n' "$conf"
}

launchd_loaded() { launchctl print "$domain/$SERVICE" >/dev/null 2>&1; }

stop_launchd() {
  local i
  launchd_loaded || return 0
  launchctl bootout "$domain/$SERVICE" 2>/dev/null || true
  # bootout can return while the job is still exiting, and bootstrapping it
  # again fails until it is gone.
  for i in $(seq 50); do
    launchd_loaded || return 0
    sleep 0.2
  done
}

start_launchd() {
  stop_launchd
  launchctl bootstrap "$domain" "$service_file"
}

stop_systemd() {
  systemctl --user disable --now "$SERVICE" >/dev/null 2>&1 || true
}

start_systemd() {
  systemctl --user daemon-reload
  systemctl --user --quiet enable "$SERVICE"
  systemctl --user restart "$SERVICE"
}

remove() {
  [ -f "$service_file" ] || return 0
  "stop_$kind"
  rm -f "$service_file"
  if [ "$kind" = systemd ]; then systemctl --user daemon-reload >/dev/null 2>&1 || true; fi
}

if [ "${1:-}" = remove ]; then
  if [ -f "$service_file" ]; then
    remove
    echo "  Removed $service_file"
  fi
  exit 0
fi

apps=()
if [ -n "$(env_value SERVE_HOST)" ] || dsh_set_up; then apps+=('dsh web'); fi
if [ -n "$(env_value SERVE_OPENCODE_HOST)" ]; then apps+=('opencode web'); fi

if [ "${#apps[@]}" -eq 0 ]; then
  [ -f "$service_file" ] || exit 0
  section 'serving in the background'
  remove
  ok "nothing to serve — removed $(tilde "$service_file")"
  exit 0
fi

section "serving ${apps[0]}${apps[1]:+ and ${apps[1]}} in the background"
if [ "$kind" = systemd ] && ! systemctl --user show-environment >/dev/null 2>&1; then
  warn "skipped — no systemd user manager to run it. Run bin/serve.sh yourself."
  exit 1
fi
mkdir -p "$(dirname "$service_file")"
fill "$template" > "$service_file"
if ! "start_$kind"; then
  warn "failed to start $SERVICE from $(tilde "$service_file")"
  exit 1
fi
if [ "$kind" = launchd ]; then
  ok "running as $SERVICE — its output, dsh web's token URL among it, goes to $(tilde "$log")"
else
  ok "running as $SERVICE — 'journalctl --user -u $SERVICE' shows its output, dsh web's token URL among it"
  # Without lingering, the user manager and every unit of it stop at logout.
  if [ "$(loginctl show-user "$(id -un)" --property=Linger --value 2>/dev/null)" != yes ] &&
    ! loginctl enable-linger >/dev/null 2>&1; then
    warn "it stops when you log out — run 'sudo loginctl enable-linger $(id -un)' to keep it running"
  fi
fi
