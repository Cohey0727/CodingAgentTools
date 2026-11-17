#!/usr/bin/env bash
# Install Open Code Review — its `ocr` CLI and its two review skills — or remove
# the skills again.
#
#   bin/ocr.sh          install or upgrade both (`make setup-ocr`, part of `make setup`)
#   bin/ocr.sh remove   remove the skills (`make uninstall`)
#
# The skills install a missing `ocr` with npm themselves, so the CLI is put in
# place here first, with bun.

set -euo pipefail

# shellcheck disable=SC1091
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/skills-common.sh"

OCR_PACKAGE=@alibaba-group/open-code-review
OCR_SKILLS_REPO=alibaba/open-code-review
OCR_SKILLS=(open-code-review open-code-review-delegate)

ocr_version() { ocr --version 2>/dev/null | head -n 1 || true; }

install_cli() {
  local before= after
  section 'ocr CLI'
  if command -v ocr >/dev/null 2>&1; then
    before=$(ocr_version)
  fi
  if ! command -v bun >/dev/null 2>&1; then
    warn "skipped — 'bun' is not on your PATH"
    return 0
  fi
  if ! bun add -g "$OCR_PACKAGE@latest" >/dev/null 2>&1; then
    warn "failed — run 'bun add -g $OCR_PACKAGE@latest' by hand"
    return 0
  fi
  hash -r
  if ! command -v ocr >/dev/null 2>&1; then
    warn "installed into $(tilde "${BUN_INSTALL:-$HOME/.bun}/bin"), which is not on your PATH"
    return 0
  fi
  after=$(ocr_version)
  if [ -z "$before" ]; then
    ok "$after installed"
  elif [ "$before" = "$after" ]; then
    ok "$after is already the latest"
  else
    ok "$before → $after upgraded"
  fi
}

install_skills() {
  section 'skills'
  if ! command -v npx >/dev/null 2>&1; then
    warn "skipped — 'npx' is not on your PATH"
    return 0
  fi
  # codex is one of the skills CLI's "universal" agents: its copy goes to
  # ~/.agents/skills, which every CLI but Claude Code reads. claude-code adds
  # the symlink in ~/.claude/skills.
  if ! npx -y skills add "$OCR_SKILLS_REPO" -g -s '*' -a claude-code codex -y >/dev/null 2>&1; then
    warn "failed — run 'npx skills add $OCR_SKILLS_REPO -g' by hand"
    return 0
  fi
  ok "${OCR_SKILLS[*]} -> ~/.agents/skills, ~/.claude/skills"
}

remove_skills() {
  local name installed=()
  section 'Open Code Review'
  for name in "${OCR_SKILLS[@]}"; do
    [ -e "$HOME/.agents/skills/$name" ] && installed+=("$name")
  done
  if [ ${#installed[@]} -eq 0 ]; then
    note 'no skills installed'
    return 0
  fi
  if ! command -v npx >/dev/null 2>&1 \
    || ! npx -y skills remove -g -s "${installed[@]}" -y >/dev/null 2>&1; then
    warn "failed — run 'npx skills remove -g ${installed[*]}' by hand"
    return 0
  fi
  ok "removed ${installed[*]}"
}

case ${1:-} in
  remove) remove_skills ;;
  '')
    banner
    install_cli
    install_skills
    echo
    ;;
  *)
    echo "usage: $0 [remove]" >&2
    exit 2
    ;;
esac
