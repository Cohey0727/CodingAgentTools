#!/usr/bin/env bash
# Terminal output shared by every script under bin/. Sourced, never executed.

# Colors only on a TTY, and never when NO_COLOR is set.
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  B=$'\033[1m'; DIM=$'\033[2m'; GRN=$'\033[32m'; YLW=$'\033[33m'; CYN=$'\033[36m'; RST=$'\033[0m'
else
  B=''; DIM=''; GRN=''; YLW=''; CYN=''; RST=''
fi

banner() { # [<subtitle>] — SKIP_BANNER=1 keeps a make target that runs
           # several scripts down to a single banner.
  [ -z "${SKIP_BANNER:-}" ] || return 0
  local subtitle=${1:-launchers, provider configs and skills for every agent CLI}
  printf '%s\n' \
    "      ${CYN} ██████╗ █████╗ ████████╗${RST}" \
    "      ${CYN}██╔════╝██╔══██╗╚══██╔══╝${RST}" \
    "      ${CYN}██║     ███████║   ██║   ${RST}" \
    "      ${CYN}██║     ██╔══██║   ██║   ${RST}" \
    "      ${CYN}╚██████╗██║  ██║   ██║   ${RST}" \
    "      ${CYN} ╚═════╝╚═╝  ╚═╝   ╚═╝   ${RST}" \
    "  ${B}C O D I N G   A G E N T   T O O L S${RST}" \
    "  ${DIM}${subtitle}${RST}"
  echo
}

section() { printf '\n%s▸ %s%s\n' "$B$CYN" "$1" "$RST"; }

ok()   { printf '  %s✔%s %s\n' "$GRN" "$RST" "$1"; }
warn() { printf '  %s⚠%s %s\n' "$YLW" "$RST" "$1"; }
note() { printf '  %s%s%s\n' "$DIM" "$1" "$RST"; }

tilde() { # <abs path> -> ~/... for display
  case $1 in
    "$HOME"/*) printf '~/%s' "${1#"$HOME"/}" ;;
    *) printf '%s' "$1" ;;
  esac
}

term_cols() { tput cols 2>/dev/null || echo 100; }
