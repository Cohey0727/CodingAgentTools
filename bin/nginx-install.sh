#!/usr/bin/env bash
# Install or upgrade the nginx `make serve` puts in front of the apps it serves:
# with Homebrew where there is one, otherwise with apt-get through sudo.
# `make setup` runs this once a hostname says nginx is in use, and `make serve`
# whenever nginx is missing. Exits non-zero when nginx is still not on the PATH.

set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
# shellcheck disable=SC1091
source "$ROOT/bin/ui.sh"

# Debian installs nginx into /usr/sbin, which a regular user's PATH may lack.
PATH="$PATH:/usr/sbin"

nginx_version() { nginx -v 2>&1 | sed 's|.*/||'; }

before=
if command -v nginx >/dev/null 2>&1; then before=$(nginx_version); fi

section 'installing nginx for make serve'
if command -v brew >/dev/null 2>&1; then
  hint='brew install nginx'
  install() { brew install nginx; }
elif command -v apt-get >/dev/null 2>&1; then
  hint='sudo apt-get install nginx'
  # sudo asks for its password on the terminal, past the redirect below.
  install() {
    sudo apt-get update && sudo apt-get install -y nginx || return 1
    # The package also starts nginx as a system service on port 80, while
    # `make serve` runs one of its own on 127.0.0.1.
    [ -n "$before" ] || sudo systemctl disable --now nginx || true
  }
else
  hint=
fi

if [ -z "$hint" ]; then
  if [ -n "$before" ]; then
    warn "nginx $before left as is — neither 'brew' nor 'apt-get' is on your PATH, so it cannot be upgraded"
  else
    warn "skipped — neither 'brew' nor 'apt-get' is on your PATH. Install nginx with your package manager."
  fi
elif ! install >/dev/null 2>&1; then
  warn "failed — run '$hint' by hand"
else
  hash -r
  if ! command -v nginx >/dev/null 2>&1; then
    warn "installed, but 'nginx' is not on your PATH"
  elif [ -z "$before" ]; then
    ok "nginx $(nginx_version) installed"
  elif [ "$before" = "$(nginx_version)" ]; then
    ok "nginx $before is already the latest"
  else
    ok "nginx $before → $(nginx_version) upgraded"
  fi
fi

command -v nginx >/dev/null 2>&1
