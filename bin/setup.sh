#!/usr/bin/env bash
# Interactive setup for claude-compatibles (`make setup`).
#
#   bin/setup.sh                  checkbox multi-select, then key prompts
#   bin/setup.sh <provider>...    skip the checkbox, still prompt for keys
#
# configs.jsonc lists every provider and refers to its secrets as "${NAME}";
# the .env beside it holds those values and is the only file with a key in it.
# At a prompt, pressing Enter with no input keeps whatever is already set.
# Keys still sitting in the old providers/<name>/.env files are carried over
# first. Then a claude<name> launcher per provider is generated into $BIN_DIR
# (default ~/.local/bin) from the template in bin/, the pi packages in
# $PI_PACKAGES are installed into pi's user settings, and every provider whose
# key resolves is registered in the global config of every agent CLI that has
# no launcher — one generator each, listed in $GLOBAL_GENERATORS.

set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
COMMON="$ROOT/bin/common.sh"
TEMPLATE="$ROOT/bin/launcher.template"
BIN_DIR="${BIN_DIR:-${PREFIX:-$HOME/.local}/bin}"

# shellcheck disable=SC1090
source "$COMMON"
# shellcheck disable=SC1091
source "$ROOT/bin/ui.sh"

# ------------------------------------------------------------------ helpers

discover_providers() { provider_names; }

provider_launcher() { # <provider> -> "claude<x>"
  provider_command "$1"
}

provider_stale_launchers() { # <provider> -> commands earlier versions installed
  provider_stale_commands "$1"
}

api_key_var() { # <provider> -> the .env variable its API_KEY points at
  ( models_resolve "$1" && printf '%s' "$M_API_KEY_VAR" )
}

current_token() { # <provider> -> its resolved key, maybe ""
  ( models_resolve "$1" 2>/dev/null && printf '%s' "$M_API_KEY" )
}

api_key_url() { # <provider> -> the signup URL commented above its variable in
                # .env.example, if there is one
  local var
  var=$(api_key_var "$1")
  [ -n "$var" ] || return 0
  awk -v want="$var=" '
    /^#/ { if (match($0, /https?:\/\/[^ ]+/)) url = substr($0, RSTART, RLENGTH); next }
    index($0, want) == 1 { print url; exit }
    { url = "" }
  ' "$ENV_EXAMPLE"
}

set_env_var() { # <variable> <value> — rewrite its line in .env, or append one
  env_file_set "$ENV_FILE" "$1" "$2"
}

# ------------------------------------------------------------------ the .env

ensure_env() { # create .env from the example, carrying over the old per-provider files
  if [ ! -f "$ENV_FILE" ]; then
    cp "$ENV_EXAMPLE" "$ENV_FILE"
    chmod 600 "$ENV_FILE"
    printf '  %s• created .env from .env.example%s\n' "$DIM" "$RST"
  fi
  migrate_provider_envs
}

sync_env_keys() { # append variables added to .env.example since .env was written
  local tmp line key buf added=0
  [ -f "$ENV_FILE" ] || return 0
  tmp=$(mktemp "${ENV_FILE}.XXXXXX")
  buf=''
  while IFS= read -r line || [ -n "$line" ]; do
    case $line in
      # A blank line ends a block; the comments right above a variable come with it.
      '') buf=''; continue ;;
      '#'*) buf="$buf$line"$'\n'; continue ;;
    esac
    key=${line%%=*}
    case $key in
      ''|*[!A-Za-z0-9_]*) buf=''; continue ;;
    esac
    if grep -q "^$key=" "$ENV_FILE"; then buf=''; continue; fi
    printf '\n%s%s\n' "$buf" "$line" >> "$tmp"
    buf=''
    added=$((added + 1))
  done < "$ENV_EXAMPLE"
  if [ "$added" -gt 0 ]; then
    cat "$tmp" >> "$ENV_FILE"
    printf '  %s• added %d new variable(s) to .env%s\n' "$DIM" "$added" "$RST"
  fi
  rm -f "$tmp"
}

# The layout before configs.jsonc kept one .env per provider, holding the key as
# API_TOKEN and any extra headers as "Name: Value" lines in HEADERS. Values
# still sitting there are moved into the single .env, once, and only into
# variables that are still empty.
raw_headers() { # <old provider .env> -> its HEADERS value, one "Name: Value" per
                # line, quotes removed and any $(...) left unevaluated
  awk '
    !started && /^HEADERS=/ { started = 1; quotes = 0; sub(/^HEADERS=/, "") }
    started {
      quotes += gsub(/"/, "")
      print
      if (quotes % 2 == 0) exit
    }
  ' "$1"
}

migrate_provider_envs() {
  local dir provider file token headers name value target moved=0
  [ -d "$ROOT/providers" ] || return 0
  for dir in "$ROOT"/providers/*/; do
    provider=$(basename "$dir")
    file="$dir.env"
    [ -f "$file" ] || continue
    provider_names | grep -qx "$provider" || continue
    models_resolve "$provider" || continue

    token=$(grep -E '^(API_TOKEN|ANTHROPIC_AUTH_TOKEN)=.+' "$file" | head -1 | cut -d= -f2- || true)
    if [ -n "$M_API_KEY_VAR" ] && [ -n "$token" ] && [ -z "$(env_value "$M_API_KEY_VAR")" ]; then
      set_env_var "$M_API_KEY_VAR" "$token"
      moved=$((moved + 1))
    fi

    headers=$(raw_headers "$file")
    [ -n "$headers" ] || continue
    while IFS= read -r name; do
      [ -n "$name" ] || continue
      target=$(header_var "$name")
      [ -n "$target" ] || continue
      [ -z "$(env_value "$target")" ] || continue
      value=$(printf '%s\n' "$headers" | awk -v want="$name:" '
        { sub(/^[ \t]+/, "") }
        index($0, want) == 1 { sub(/^[^:]*:[ \t]*/, ""); print; exit }')
      [ -n "$value" ] || continue
      set_env_var "$target" "$value"
      moved=$((moved + 1))
    done < <(header_names)
  done
  if [ "$moved" -gt 0 ]; then
    printf '  %s• carried %d value(s) over from providers/*/.env into .env%s\n' "$DIM" "$moved" "$RST"
    printf '  %s  the old files are left in place — delete providers/ once you are happy%s\n' "$DIM" "$RST"
  fi
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
  tok=$(current_token "${ITEMS[$i]}")
  printf '\033[2K\r'
  if [ "$i" = "$CURSOR" ]; then
    printf '\033[7m> [%s] %-12s\033[0m' "$mark" "${ITEMS[$i]}"
  else
    printf '  [%s] %s%-12s%s' "$mark" "$B" "${ITEMS[$i]}" "$RST"
  fi
  if [ -n "$tok" ]; then
    printf '  %s→ %-44s%s %skey: set%s\n' "$DIM" "$cmd" "$RST" "$GRN" "$RST"
  else
    printf '  %s→ %-44s%s %skey: not set%s\n' "$DIM" "$cmd" "$RST" "$DIM" "$RST"
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
  local p=$1 var tok url hint new
  var=$(api_key_var "$p")
  tok=$(current_token "$p")
  url=$(api_key_url "$p")
  section "$p"
  if [ -z "$var" ]; then
    printf '  %s✔ API_KEY is set in configs.jsonc — nothing to paste%s\n' "$GRN" "$RST"
    return 0
  fi
  printf '  %s%s%s\n' "$DIM" "$var in .env" "$RST"
  if [ -n "$url" ]; then printf '  %sget an API key at %s%s\n' "$DIM" "$url" "$RST"; fi
  if [ -n "$tok" ]; then
    if [ "${#tok}" -gt 4 ]; then hint="****${tok: -4}"; else hint='****'; fi
    printf '  %skey%s [%s — Enter to keep]: ' "$B" "$RST" "$hint"
  else
    printf '  %skey%s: ' "$B" "$RST"
  fi
  IFS= read -r new || new=''
  new=$(printf '%s' "$new" | tr -d '[:space:]')
  if [ -z "$new" ]; then
    if [ -n "$tok" ]; then
      printf '  %s✔ kept existing key%s\n' "$GRN" "$RST"
    else
      printf '  %s⚠ left empty — set %s in %s later%s\n' "$YLW" "$var" "$(tilde "$ENV_FILE")" "$RST"
    fi
  else
    set_env_var "$var" "$new"
    printf '  %s✔ key updated%s\n' "$GRN" "$RST"
  fi
  # A provider may also need headers; those are edited by hand.
  while IFS= read -r hint; do
    [ -n "$hint" ] || continue
    printf '  %s⚠ %s is empty — needed for the %s header%s\n' \
      "$YLW" "${hint%%	*}" "${hint#*	}" "$RST"
  done < <(
    models_resolve "$p"
    while IFS= read -r name; do
      [ -n "$name" ] || continue
      v=$(header_var "$name")
      [ -n "$v" ] && [ -z "$(env_value "$v")" ] && printf '%s\t%s\n' "$v" "$name"
    done < <(header_names)
  )
}

# ------------------------------------------------------------- installation

install_one() { # <provider> <command> <template>
  local p=$1 cmd=$2 template=$3 bin
  sed -e 's|@@PROVIDER@@|'"$p"'|g' \
    -e 's|@@COMMON@@|'"$COMMON"'|g' \
    "$template" > "$BIN_DIR/$cmd"
  chmod +x "$BIN_DIR/$cmd"
  bin=$(tilde "$BIN_DIR/$cmd")
  if [ -n "$(current_token "$p")" ]; then
    printf '  %s✔%s %s%s%-10s%s %s%-29s%s %skey: set%s\n' \
      "$GRN" "$RST" "$B" "$CYN" "$p" "$RST" "$DIM" "$bin" "$RST" "$GRN" "$RST"
  else
    printf '  %s✔%s %s%s%-10s%s %s%-29s%s %skey: not set — edit %s%s\n' \
      "$GRN" "$RST" "$B" "$CYN" "$p" "$RST" "$DIM" "$bin" "$RST" "$YLW" "$(tilde "$ENV_FILE")" "$RST"
  fi
}

install_launcher() { # <provider> — the claude<name> command. Commands earlier
                     # versions generated for the provider go away.
  local p=$1 cmd
  install_one "$p" "$(provider_launcher "$p")" "$TEMPLATE"
  for cmd in $(provider_stale_launchers "$p"); do
    if [ -f "$BIN_DIR/$cmd" ] && grep -qE '^PROVIDER(_DIR)?="' "$BIN_DIR/$cmd"; then
      rm -f "$BIN_DIR/$cmd"
      printf '  %s• removed %s%s\n' "$DIM" "$BIN_DIR/$cmd" "$RST"
    fi
  done
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
  local cmd where
  echo
  if ! command -v claude >/dev/null 2>&1; then
    warn "'claude' is not on your PATH — install Claude Code first."
  fi
  # A generated config is inert until the CLI that reads it is installed, so
  # each missing one is named with where to get it.
  while IFS='|' read -r cmd where; do
    [ -n "$cmd" ] || continue
    command -v "$cmd" >/dev/null 2>&1 && continue
    warn "'$cmd' is not on your PATH — its generated config needs $where"
  done <<'AGENTS'
opencode|OpenCode (https://opencode.ai)
pi|the pi coding agent (https://pi.dev)
crush|Crush (https://github.com/charmbracelet/crush)
reasonix|Reasonix (https://github.com/esengine/DeepSeek-Reasonix)
codewhale|Codewhale (https://codewhale.net)
AGENTS
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
  local providers=() all=() p i tok generator

  banner

  if ! models_check; then
    echo "setup: configs.jsonc is invalid — fix it and re-run." >&2
    exit 1
  fi

  if [ "$#" -gt 0 ]; then
    providers=("$@")
    for p in "${providers[@]}"; do
      if ! provider_names | grep -qx "$p"; then
        echo "setup: unknown provider '$p' (not in configs.jsonc)" >&2
        exit 1
      fi
    done
  else
    if [ ! -t 0 ]; then
      echo "setup: the checkbox picker needs an interactive terminal." >&2
      echo "  or name providers directly: bin/setup.sh $(provider_names | tr '\n' ' ')" >&2
      exit 1
    fi
    while IFS= read -r p; do all+=("$p"); done < <(discover_providers)
    if [ "${#all[@]}" -eq 0 ]; then
      echo "setup: configs.jsonc lists no providers" >&2
      exit 1
    fi
    ensure_env
    sync_env_keys
    # Pre-check providers whose key already resolves.
    CHECKED=()
    for i in "${!all[@]}"; do
      tok=$(current_token "${all[$i]}")
      if [ -n "$tok" ]; then CHECKED[$i]=1; else CHECKED[$i]=0; fi
    done
    if ! pick_providers "${all[@]}"; then
      printf '%s⚠ no providers selected — nothing to do%s\n' "$YLW" "$RST"
      exit 0
    fi
    providers=("${SELECTED[@]}")
  fi

  ensure_env
  sync_env_keys

  for p in "${providers[@]}"; do
    prompt_token "$p"
  done

  section 'installing claude code compatibles'
  mkdir -p "$BIN_DIR"
  for p in "${providers[@]}"; do
    install_launcher "$p"
  done

  install_pi_packages

  for generator in $GLOBAL_GENERATORS; do
    section "generating global ${generator%%-*} config"
    if ! "$ROOT/bin/$generator.sh"; then
      printf '  %s⚠ skipped — set a key and re-run%s\n' "$YLW" "$RST"
    fi
  done

  check_environment
}

main "$@"
