#!/usr/bin/env bash
# Install this repo's skills, subagents and OpenCode extensions
# (`make setup-skills`).
#
# Every skill under skills/ and every subagent under agents/ is symlinked into
# both ~/.claude (Claude Code) and ~/.agents (Codex and other agent CLIs), so
# editing a file in this repo takes effect immediately without reinstalling.
# The same goes for OpenCode's slash commands under opencode/command/; its
# plugins get a generated shim pointing back here instead, for the reason in
# bin/opencode-plugin.template.
#
#   existing symlink or own shim  -> replaced
#   existing real file/directory  -> skipped, never overwritten
#   nothing there                 -> created

set -euo pipefail

# shellcheck disable=SC1091
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/skills-common.sh"

N_LINKED=0
N_UPDATED=0
N_SKIPPED=0

link_item() { # <src> <target> <label>
  local src=$1 target=$2 label=$3

  if [ -L "$target" ]; then
    rm "$target"
    ln -s "$src" "$target"
    N_UPDATED=$((N_UPDATED + 1))
    printf '  %s✔%s %-30s %supdated%s\n' "$GRN" "$RST" "$label" "$DIM" "$RST"
  elif [ -e "$target" ]; then
    N_SKIPPED=$((N_SKIPPED + 1))
    printf '  %s⚠%s %-30s %sskipped — real file, not a symlink%s\n' \
      "$YLW" "$RST" "$label" "$YLW" "$RST"
  else
    ln -s "$src" "$target"
    N_LINKED=$((N_LINKED + 1))
    printf '  %s✔%s %-30s %s%slinked%s\n' "$GRN" "$RST" "$label" "$B" "$GRN" "$RST"
  fi
}

install_root() { # <root>
  local root=$1 name
  section "$(tilde "$root")"
  mkdir -p "$root/skills" "$root/agents"

  while IFS= read -r name; do
    link_item "$SKILLS_SRC/$name" "$root/skills/$name" "skills/$name"
  done < <(skill_names)

  while IFS= read -r name; do
    link_item "$AGENTS_SRC/$name" "$root/agents/$name" "agents/$name"
  done < <(agent_names)
}

write_shim() { # <impl> <target> <label> — the generated stand-in for a plugin
  local impl=$1 target=$2 label=$3 verb='generated'

  if [ -e "$target" ] || [ -L "$target" ]; then
    if ! shim_from_repo "$target"; then
      N_SKIPPED=$((N_SKIPPED + 1))
      printf '  %s⚠%s %-30s %sskipped — not generated here%s\n' \
        "$YLW" "$RST" "$label" "$YLW" "$RST"
      return 0
    fi
    verb='updated'
  fi

  sed -e "s|@@MARKER@@|$OPENCODE_PLUGIN_MARKER|" -e "s|@@IMPL@@|$impl|" \
    "$OPENCODE_PLUGIN_TEMPLATE" > "$target"

  if [ "$verb" = updated ]; then
    N_UPDATED=$((N_UPDATED + 1))
    printf '  %s✔%s %-30s %supdated%s\n' "$GRN" "$RST" "$label" "$DIM" "$RST"
  else
    N_LINKED=$((N_LINKED + 1))
    printf '  %s✔%s %-30s %s%sgenerated%s\n' "$GRN" "$RST" "$label" "$B" "$GRN" "$RST"
  fi
}

install_opencode() { # OpenCode's global slash commands and plugins
  local dir name
  [ -d "$OPENCODE_SRC" ] || return 0

  section "$(tilde "$(opencode_config_dir)")"

  dir=$(opencode_command_dir)
  mkdir -p "$dir"
  while IFS= read -r name; do
    link_item "$OPENCODE_SRC/command/$name" "$dir/$name" "command/$name"
  done < <(opencode_command_names)

  dir=$(opencode_plugin_dir)
  mkdir -p "$dir"
  while IFS= read -r name; do
    write_shim "$OPENCODE_SRC/plugin/$name" "$dir/$name" "plugin/$name"
  done < <(opencode_plugin_names)
}

install_context() { # the shared AGENTS.md, under whatever name each CLI expects
  local target
  [ -f "$CONTEXT_SRC" ] || return 0

  section 'AGENTS.md'
  for target in "${CONTEXT_TARGETS[@]}"; do
    mkdir -p "$(dirname "$target")"
    link_item "$CONTEXT_SRC" "$target" "$(tilde "$target")"
  done
}

warnings() { # every problem worth surfacing, one per line
  local root link
  for root in "${TARGET_ROOTS[@]}"; do
    while IFS= read -r link; do
      [ -n "$link" ] || continue
      echo "dangling symlink: $(tilde "$link") -> $(readlink "$link")"
    done < <(dangling_links "$root/skills" "$root/agents")
  done
  while IFS= read -r link; do
    [ -n "$link" ] || continue
    echo "dangling symlink: $(tilde "$link") -> $(readlink "$link")"
  done < <(dangling_links "$(opencode_command_dir)")
  return 0
}

report_readers() { # which installed CLIs actually pick up what we linked
  local root cli found target

  for root in "${TARGET_ROOTS[@]}"; do
    found=''
    for cli in $(skill_readers "$root"); do
      command -v "$cli" >/dev/null 2>&1 || continue
      [ -z "$found" ] || found="$found, "
      found="$found$cli"
    done
    if [ -n "$found" ]; then
      ok "$(tilde "$root")/skills $DIM->$RST $found"
    else
      warn "$(tilde "$root")/skills -> no reader on PATH (expects: $(skill_readers "$root"))"
    fi
  done

  for target in "${CONTEXT_TARGETS[@]}"; do
    cli=$(context_reader "$target")
    if command -v "$cli" >/dev/null 2>&1; then
      ok "$(tilde "$target") $DIM->$RST $cli"
    else
      warn "$(tilde "$target") -> $cli is not on PATH"
    fi
  done

  if command -v opencode >/dev/null 2>&1; then
    ok "$(tilde "$(opencode_config_dir)") $DIM->$RST opencode"
  else
    warn "$(tilde "$(opencode_config_dir)") -> opencode is not on PATH"
  fi
}

main() {
  local root n_skills n_agents n_commands n_plugins roots='' line

  banner

  n_skills=$(skill_names | wc -l | tr -d ' ')
  n_agents=$(agent_names | wc -l | tr -d ' ')
  n_commands=$(opencode_command_names | wc -l | tr -d ' ')
  n_plugins=$(opencode_plugin_names | wc -l | tr -d ' ')

  for root in "${TARGET_ROOTS[@]}"; do
    install_root "$root"
    [ -z "$roots" ] || roots="$roots, "
    roots="$roots$(tilde "$root")"
  done

  install_opencode
  install_context

  section 'summary'
  printf '  %s%s skills%s · %s%s subagents%s %s->%s %s\n' \
    "$B" "$n_skills" "$RST" "$B" "$n_agents" "$RST" "$DIM" "$RST" "$roots"
  printf '  %s%s commands%s · %s%s plugins%s %s->%s %s\n' \
    "$B" "$n_commands" "$RST" "$B" "$n_plugins" "$RST" "$DIM" "$RST" \
    "$(tilde "$(opencode_config_dir)")"
  printf '  %sAGENTS.md%s %s->%s %s targets\n' \
    "$B" "$RST" "$DIM" "$RST" "${#CONTEXT_TARGETS[@]}"
  printf '  %slinked %s · updated %s · skipped %s%s\n' \
    "$DIM" "$N_LINKED" "$N_UPDATED" "$N_SKIPPED" "$RST"

  section 'checks'
  report_readers
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    warn "$line"
  done < <(warnings)

  echo
}

main "$@"
