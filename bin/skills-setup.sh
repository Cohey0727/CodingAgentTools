#!/usr/bin/env bash
# Install this repo's skills and subagents (`make setup-skills`).
#
# Every skill under skills/ and every subagent under agents/ is symlinked into
# both ~/.claude (Claude Code) and ~/.agents (Codex and other agent CLIs), so
# editing a file in this repo takes effect immediately without reinstalling.
#
#   existing symlink              -> replaced
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
    done < <(dangling_links "$root")
  done
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
}

main() {
  local root n_skills n_agents roots='' line

  banner

  n_skills=$(skill_names | wc -l | tr -d ' ')
  n_agents=$(agent_names | wc -l | tr -d ' ')

  for root in "${TARGET_ROOTS[@]}"; do
    install_root "$root"
    [ -z "$roots" ] || roots="$roots, "
    roots="$roots$(tilde "$root")"
  done

  install_context

  section 'summary'
  printf '  %s%s skills%s · %s%s subagents%s %s->%s %s\n' \
    "$B" "$n_skills" "$RST" "$B" "$n_agents" "$RST" "$DIM" "$RST" "$roots"
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
