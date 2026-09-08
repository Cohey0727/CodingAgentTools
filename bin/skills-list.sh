#!/usr/bin/env bash
# Show what this repo manages and where it is installed (`make list`).

set -euo pipefail

# shellcheck disable=SC1091
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/skills-common.sh"

DESC_COLS=$(( $(term_cols) - 32 ))
[ "$DESC_COLS" -ge 20 ] || DESC_COLS=20

row() { # <kind> <name> <label> <description>
  local kind=$1 name=$2 label=$3 desc=$4 root mark="${GRN}✔${RST}"

  for root in "${TARGET_ROOTS[@]}"; do
    installed_in "$root" "$kind" "$name" || mark="${YLW}⚠${RST}"
  done

  printf '  %s %-26s %s%s%s\n' "$mark" "$label" "$DIM" "$(trunc "$desc" "$DESC_COLS")" "$RST"
}

list_skills() {
  local name
  section "skills ($(skill_names | wc -l | tr -d ' '))"
  while IFS= read -r name; do
    row skills "$name" "$name" "$(frontmatter_field "$SKILLS_SRC/$name/SKILL.md" description)"
  done < <(skill_names)
}

list_agents() {
  local name
  section "subagents ($(agent_names | wc -l | tr -d ' '))"
  while IFS= read -r name; do
    row agents "$name" "${name%.md}" "$(frontmatter_field "$AGENTS_SRC/$name" description)"
  done < <(agent_names)
}

list_opencode() {
  local name target mark

  section "opencode ($(( $(opencode_command_names | wc -l) + $(opencode_plugin_names | wc -l) )))"

  while IFS= read -r name; do
    target="$(opencode_command_dir)/$name"
    if linked_to_repo "$target"; then mark="${GRN}✔${RST}"; else mark="${YLW}⚠${RST}"; fi
    printf '  %s %-26s %s%s%s\n' "$mark" "/${name%.md}" "$DIM" \
      "$(trunc "$(opencode_summary "$OPENCODE_SRC/command/$name")" "$DESC_COLS")" "$RST"
  done < <(opencode_command_names)

  while IFS= read -r name; do
    target="$(opencode_plugin_dir)/$name"
    if shim_from_repo "$target"; then mark="${GRN}✔${RST}"; else mark="${YLW}⚠${RST}"; fi
    printf '  %s %-26s %s%s%s\n' "$mark" "plugin/$name" "$DIM" \
      "$(trunc "$(opencode_summary "$OPENCODE_SRC/plugin/$name")" "$DESC_COLS")" "$RST"
  done < <(opencode_plugin_names)
}

list_context() {
  local target mark

  section 'AGENTS.md'
  for target in "${CONTEXT_TARGETS[@]}"; do
    if linked_to_repo "$target"; then mark="${GRN}✔${RST}"; else mark="${YLW}⚠${RST}"; fi
    printf '  %s %-26s %s%s%s\n' \
      "$mark" "$(tilde "$target")" "$DIM" "$(context_reader "$target")" "$RST"
  done
}

list_targets() {
  local root name skills agents

  section 'skill targets'
  for root in "${TARGET_ROOTS[@]}"; do
    skills=0
    agents=0
    while IFS= read -r name; do
      installed_in "$root" skills "$name" && skills=$((skills + 1))
    done < <(skill_names)
    while IFS= read -r name; do
      installed_in "$root" agents "$name" && agents=$((agents + 1))
    done < <(agent_names)
    printf '  %s%-12s%s %s%s skills · %s subagents linked%s\n' \
      "$B" "$(tilde "$root")" "$RST" "$DIM" "$skills" "$agents" "$RST"
  done
}

banner
list_skills
list_agents
list_opencode
list_context
list_targets
echo
note 'run `make setup-skills` to (re)link everything'
echo
