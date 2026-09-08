#!/usr/bin/env bash
# Interactive setup for claude-compatibles (`make setup`).
#
#   bin/setup.sh                  checkbox multi-select, then token prompts
#   bin/setup.sh deepseek glm     skip the checkbox, still prompt for tokens
#
# At a token prompt, pressing Enter with no input keeps whatever token is
# already in that provider's .env. Old-format .env files are migrated first,
# and settings added to .env.example since are appended. Then a claude<NAME>
# launcher per provider is generated into $BIN_DIR (default ~/.local/bin)
# from the template in bin/, the pi packages in $PI_PACKAGES are installed
# into pi's user settings, and every provider with a token is registered in
# pi's global models.json and OpenCode's global config.

set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
PROVIDERS_DIR="$ROOT/providers"
COMMON="$ROOT/bin/common.sh"
TEMPLATE="$ROOT/bin/launcher.template"
BIN_DIR="${BIN_DIR:-${PREFIX:-$HOME/.local}/bin}"

# shellcheck disable=SC1090
source "$COMMON"
# shellcheck disable=SC1091
source "$ROOT/bin/ui.sh"

# ------------------------------------------------------------------ helpers

discover_providers() {
  local d
  for d in "$PROVIDERS_DIR"/*/; do
    [ -f "$d/.env.example" ] && basename "$d"
  done
  return 0
}

provider_launcher() { # <provider> -> "claude<x>"
  local file="$PROVIDERS_DIR/$1/.env"
  [ -f "$file" ] || file="$PROVIDERS_DIR/$1/.env.example"
  ( load_settings "$file"; launcher_name "$1" )
}

provider_stale_launchers() { # <provider> -> commands earlier versions installed
  local file="$PROVIDERS_DIR/$1/.env"
  [ -f "$file" ] || file="$PROVIDERS_DIR/$1/.env.example"
  ( load_settings "$file"; stale_launcher_names "$1" )
}

api_key_url() { # <provider> -> signup URL from the .env.example comment, if any
  sed -n 's/^#.*get an API key at \(https\?:[^ ]*\).*/\1/p' \
    "$PROVIDERS_DIR/$1/.env.example" | head -1
}

token_key() { # <env file> -> the key holding the token: the highest-priority
              # one that is present and non-empty, else API_TOKEN
  local file=$1 key
  for key in ANTHROPIC_AUTH_TOKEN API_TOKEN; do
    if grep -qE "^$key=.+" "$file"; then printf '%s' "$key"; return 0; fi
  done
  if grep -qE '^API_TOKEN=' "$file"; then printf 'API_TOKEN'; return 0; fi
  printf 'ANTHROPIC_AUTH_TOKEN'
}

current_token() { # <env file> -> configured token (new or old format), maybe ""
  [ -f "$1" ] || return 0
  local tok
  tok=$(grep -E '^(API_TOKEN|ANTHROPIC_AUTH_TOKEN)=.+' "$1" | head -1 | cut -d= -f2- || true)
  if [ -z "$tok" ]; then
    tok=$(grep -E '^[A-Z_]+_API_KEY=.+' "$1" | head -1 | cut -d= -f2- || true)
  fi
  printf '%s' "$tok"
}

set_token() { # <env file> <token> — rewrite the line holding the token
  local file=$1 token=$2 key tmp line
  key=$(token_key "$file")
  tmp=$(mktemp "${file}.XXXXXX")
  while IFS= read -r line || [ -n "$line" ]; do
    case $line in
      "$key="*) printf '%s=%s\n' "$key" "$token" ;;
      *) printf '%s\n' "$line" ;;
    esac
  done < "$file" > "$tmp"
  chmod 600 "$tmp"
  mv "$tmp" "$file"
}

ensure_env() { # <provider> — create .env from example; migrate the old layout
  local p=$1 dir env key
  dir="$PROVIDERS_DIR/$p"
  env="$dir/.env"
  if [ ! -f "$env" ]; then
    cp "$dir/.env.example" "$env"
    chmod 600 "$env"
    printf '  %s• created providers/%s/.env from example%s\n' "$DIM" "$p" "$RST"
  elif ! grep -qE '^(BASE_URL|ANTHROPIC_BASE_URL)=' "$env"; then
    key=$(current_token "$env")
    mv "$env" "$env.bak"
    cp "$dir/.env.example" "$env"
    chmod 600 "$env"
    if [ -n "$key" ]; then set_token "$env" "$key"; fi
    printf '  %s• migrated old-format providers/%s/.env (backup: .env.bak)%s\n' "$DIM" "$p" "$RST"
  fi
}

sync_env_keys() { # <provider> — append settings added to .env.example since .env was written
  local p=$1 dir env tmp line key buf added=0
  dir="$PROVIDERS_DIR/$p"
  env="$dir/.env"
  [ -f "$env" ] || return 0
  tmp=$(mktemp "${env}.XXXXXX")
  buf=''
  while IFS= read -r line || [ -n "$line" ]; do
    case $line in
      # A blank line ends a block; the comments right above a setting come with it.
      '') buf=''; continue ;;
      '#'*) buf="$buf$line"$'\n'; continue ;;
    esac
    key=${line%%=*}
    case $key in
      ''|*[!A-Za-z0-9_]*) buf=''; continue ;;
    esac
    if grep -q "^$key=" "$env"; then buf=''; continue; fi
    printf '\n%s%s\n' "$buf" "$line" >> "$tmp"
    buf=''
    added=$((added + 1))
  done < "$dir/.env.example"
  if [ "$added" -gt 0 ]; then
    cat "$tmp" >> "$env"
    printf '  %s• added %d new setting(s) to providers/%s/.env%s\n' "$DIM" "$added" "$p" "$RST"
  fi
  rm -f "$tmp"
}

# --------------------------------------------------------- checkbox picker

ITEMS=()   # provider names
CHECKED=() # 1/0 per ITEMS index
CURSOR=0
SELECTED=()
OLD_STTY=

cleanup_tty() {
  if [ -n "$OLD_STTY" ]; then
    stty "$OLD_STTY" 2>/dev/null || true
    OLD_STTY=
  fi
  tput cnorm 2>/dev/null || true
}

draw_item() { # <index>
  local i=$1 mark cmd tok
  if [ "${CHECKED[$i]}" = 1 ]; then mark="${GRN}x${RST}"; else mark=' '; fi
  cmd=$(provider_launcher "${ITEMS[$i]}")
  tok=$(current_token "$PROVIDERS_DIR/${ITEMS[$i]}/.env")
  printf '\033[2K\r'
  if [ "$i" = "$CURSOR" ]; then
    printf '\033[7m> [%s] %-12s\033[0m' "$mark" "${ITEMS[$i]}"
  else
    printf '  [%s] %s%-12s%s' "$mark" "$B" "${ITEMS[$i]}" "$RST"
  fi
  if [ -n "$tok" ]; then
    printf '  %s→ %-44s%s %stoken: set%s\n' "$DIM" "$cmd" "$RST" "$GRN" "$RST"
  else
    printf '  %s→ %-44s%s %stoken: not set%s\n' "$DIM" "$cmd" "$RST" "$DIM" "$RST"
  fi
}

redraw() {
  local i
  printf '\033[%dA' "${#ITEMS[@]}"
  for i in "${!ITEMS[@]}"; do draw_item "$i"; done
}

pick_providers() { # <provider>... -> SELECTED; returns 1 if nothing chosen
  ITEMS=("$@")
  CURSOR=0
  SELECTED=()
  local i key s1 s2 target n=${#ITEMS[@]}

  OLD_STTY=$(stty -g)
  trap cleanup_tty EXIT
  trap 'exit 130' INT TERM
  stty -icanon -echo
  tput civis 2>/dev/null || true

  printf '%sSpace: toggle · a: all · Enter: confirm · Ctrl-C: abort%s\n' "$DIM" "$RST"
  for i in "${!ITEMS[@]}"; do draw_item "$i"; done

  while true; do
    IFS= read -rsn1 key || key=''
    if [ "$key" = "$(printf '\033')" ]; then
      IFS= read -rsn1 -t 1 s1 || s1=''
      IFS= read -rsn1 -t 1 s2 || s2=''
      case $s1$s2 in
        '[A') key=up ;;
        '[B') key=down ;;
        *)    key=ignore ;;
      esac
    fi
    case $key in
      up|k)   if [ "$CURSOR" -gt 0 ]; then CURSOR=$((CURSOR - 1)); fi ;;
      down|j) if [ "$CURSOR" -lt $((n - 1)) ]; then CURSOR=$((CURSOR + 1)); fi ;;
      ' ')    CHECKED[$CURSOR]=$((1 - ${CHECKED[$CURSOR]})) ;;
      a)
        target=0
        for i in "${!ITEMS[@]}"; do
          if [ "${CHECKED[$i]}" = 0 ]; then target=1; fi
        done
        for i in "${!ITEMS[@]}"; do CHECKED[$i]=$target; done
        ;;
      ''|$'\r'|$'\n') break ;;
      *) continue ;;
    esac
    redraw
  done

  cleanup_tty
  trap - EXIT INT TERM

  for i in "${!ITEMS[@]}"; do
    if [ "${CHECKED[$i]}" = 1 ]; then SELECTED+=("${ITEMS[$i]}"); fi
  done
  [ "${#SELECTED[@]}" -gt 0 ]
}

# ------------------------------------------------------------ token prompt

prompt_token() { # <provider>
  local p=$1 env tok url hint new
  env="$PROVIDERS_DIR/$p/.env"
  tok=$(current_token "$env")
  url=$(api_key_url "$p")
  section "$p"
  if [ -n "$url" ]; then printf '  %sget an API key at %s%s\n' "$DIM" "$url" "$RST"; fi
  if [ -n "$tok" ]; then
    if [ "${#tok}" -gt 4 ]; then hint="****${tok: -4}"; else hint='****'; fi
    printf '  %stoken%s [%s — Enter to keep]: ' "$B" "$RST" "$hint"
  else
    printf '  %stoken%s: ' "$B" "$RST"
  fi
  IFS= read -r new || new=''
  new=$(printf '%s' "$new" | tr -d '[:space:]')
  if [ -z "$new" ]; then
    if [ -n "$tok" ]; then
      printf '  %s✔ kept existing token%s\n' "$GRN" "$RST"
    else
      printf '  %s⚠ left empty — edit providers/%s/.env later%s\n' "$YLW" "$p" "$RST"
    fi
  else
    set_token "$env" "$new"
    printf '  %s✔ token updated%s\n' "$GRN" "$RST"
  fi
}

# ------------------------------------------------------------- installation

install_one() { # <provider> <command> <template>
  local p=$1 cmd=$2 template=$3 dir env bin
  dir="$PROVIDERS_DIR/$p"
  env="$dir/.env"
  sed -e 's|@@PROVIDER_DIR@@|'"$dir"'|g' \
    -e 's|@@COMMON@@|'"$COMMON"'|g' \
    "$template" > "$BIN_DIR/$cmd"
  chmod +x "$BIN_DIR/$cmd"
  bin=$(tilde "$BIN_DIR/$cmd")
  if grep -Eq '^(API_TOKEN|ANTHROPIC_AUTH_TOKEN)=.+' "$env"; then
    printf '  %s✔%s %s%s%-10s%s %s%-29s%s %stoken: set%s\n' \
      "$GRN" "$RST" "$B" "$CYN" "$p" "$RST" "$DIM" "$bin" "$RST" "$GRN" "$RST"
  else
    printf '  %s✔%s %s%s%-10s%s %s%-29s%s %stoken: not set — edit providers/%s/.env%s\n' \
      "$GRN" "$RST" "$B" "$CYN" "$p" "$RST" "$DIM" "$bin" "$RST" "$YLW" "$p" "$RST"
  fi
}

install_launcher() { # <provider> — the claude<NAME> command. Commands earlier
                     # versions generated for the provider (recognised by the
                     # baked-in PROVIDER_DIR) and its .pi-agent dir go away.
  local p=$1 cmd
  install_one "$p" "$(provider_launcher "$p")" "$TEMPLATE"
  for cmd in $(provider_stale_launchers "$p"); do
    if [ -f "$BIN_DIR/$cmd" ] && grep -q '^PROVIDER_DIR="' "$BIN_DIR/$cmd"; then
      rm -f "$BIN_DIR/$cmd"
      printf '  %s• removed %s%s\n' "$DIM" "$BIN_DIR/$cmd" "$RST"
    fi
  done
  rm -rf "$PROVIDERS_DIR/$p/.pi-agent"
}

# pi resolves packages from its user settings, so one install covers every
# provider.
install_pi_packages() {
  local spec src cmd
  section 'installing pi packages'
  if ! command -v pi >/dev/null 2>&1; then
    printf '  %s⚠%s %s\n' "$YLW" "$RST" \
      "skipped — 'pi' is not on your PATH. Install it (https://pi.dev), then re-run."
    return 0
  fi
  # shellcheck disable=SC2086  # word-splitting PI_PACKAGES is intended
  for spec in $PI_PACKAGES; do
    src=$(pi_package_source "$spec")
    cmd=$(pi_package_command "$spec")
    if pi install "$src" >/dev/null 2>&1; then
      printf '  %s✔%s %s%-26s%s %s%-6s%s\n' \
        "$GRN" "$RST" "$B" "$src" "$RST" "$CYN" "$cmd" "$RST"
    else
      printf '  %s⚠%s %s%-26s%s %sfailed — run '\''pi install %s'\'' by hand%s\n' \
        "$YLW" "$RST" "$B" "$src" "$RST" "$YLW" "$src" "$RST"
    fi
  done
}

check_environment() {
  echo
  if ! command -v claude >/dev/null 2>&1; then
    warn "'claude' is not on your PATH — install Claude Code first."
  fi
  if ! command -v opencode >/dev/null 2>&1; then
    warn "'opencode' is not on your PATH — the generated global config needs OpenCode (https://opencode.ai)."
  fi
  if ! command -v pi >/dev/null 2>&1; then
    warn "'pi' is not on your PATH — the generated models.json needs the pi coding agent (https://pi.dev)."
  fi
  case ":$PATH:" in
    *":$BIN_DIR:"*) ;;
    *)
      printf '  %s⚠%s %s\n      %s\n' "$YLW" "$RST" \
        "$BIN_DIR is not on your PATH — add to your shell rc:" \
        "export PATH=\"$BIN_DIR:\$PATH\""
      ;;
  esac
}

# -------------------------------------------------------------------- main

main() {
  local providers=() all=() p i tok

  banner

  if [ "$#" -gt 0 ]; then
    providers=("$@")
    for p in "${providers[@]}"; do
      if [ ! -f "$PROVIDERS_DIR/$p/.env.example" ]; then
        echo "setup: unknown provider '$p' (no providers/$p/.env.example)" >&2
        exit 1
      fi
    done
  else
    if [ ! -t 0 ]; then
      echo "setup: the checkbox picker needs an interactive terminal." >&2
      echo "  or name providers directly: bin/setup.sh deepseek glm" >&2
      exit 1
    fi
    while IFS= read -r p; do all+=("$p"); done < <(discover_providers)
    if [ "${#all[@]}" -eq 0 ]; then
      echo "setup: no providers found under $PROVIDERS_DIR" >&2
      exit 1
    fi
    # Pre-check providers that already have a token configured.
    CHECKED=()
    for i in "${!all[@]}"; do
      tok=$(current_token "$PROVIDERS_DIR/${all[$i]}/.env")
      if [ -n "$tok" ]; then CHECKED[$i]=1; else CHECKED[$i]=0; fi
    done
    if ! pick_providers "${all[@]}"; then
      printf '%s⚠ no providers selected — nothing to do%s\n' "$YLW" "$RST"
      exit 0
    fi
    providers=("${SELECTED[@]}")
  fi

  for p in "${providers[@]}"; do
    ensure_env "$p"
    sync_env_keys "$p"
    prompt_token "$p"
  done

  section 'installing launchers'
  mkdir -p "$BIN_DIR"
  for p in "${providers[@]}"; do
    install_launcher "$p"
  done

  install_pi_packages

  section 'generating global pi models.json'
  if ! "$ROOT/bin/pi-global-models.sh"; then
    printf '  %s⚠ skipped — set a token and re-run%s\n' "$YLW" "$RST"
  fi

  section 'generating global OpenCode config'
  if ! "$ROOT/bin/opencode-global-config.sh"; then
    printf '  %s⚠ skipped — set a token and re-run%s\n' "$YLW" "$RST"
  fi

  check_environment
}

main "$@"
