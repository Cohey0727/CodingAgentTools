#!/usr/bin/env bash
# Fail if anything but configs.jsonc contains a name configs.jsonc owns.
#
# The forbidden words are not written here: `models.py vocabulary` builds them
# from configs.jsonc itself, so adding a provider or renaming a variable changes
# what is refused without touching this file.
#
# Comments count. A comment naming a model goes stale the moment configs.jsonc
# changes, and it teaches the next reader the wrong place to look.
#
# A provider NAME is refused only in this repo's own machinery. A skill config
# names a provider to select one as a reviewer or a target; that is its job, and
# it holds no provider knowledge — the model id and the endpoint still come from
# configs.jsonc. Everything else in the vocabulary is refused everywhere.
#
# A line that genuinely has to carry one ends with "style-check: allow".

set -uo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
# shellcheck disable=SC1090
source "$ROOT/bin/common.sh"

# Everything that runs, tracked or newly staged — a file added in this very
# commit has to be refused too. Documentation may name providers; it describes
# them, so it is not scanned.
scanned() {
  tracked_and_staged 'bin/*' 'Makefile' 'lefthook.yml' 'opencode/*' '.claude/*.json' \
    'skills/**/*.json' 'skills/**/SKILL.md'
}

# This repo's own machinery, where a provider may not even be named.
machinery() {
  tracked_and_staged 'bin/*' 'Makefile' 'lefthook.yml' 'opencode/*'
}

tracked_and_staged() {
  {
    git -C "$ROOT" ls-files -- "$@"
    git -C "$ROOT" diff --cached --name-only --diff-filter=A -- "$@"
  } | sort -u | grep -v -E '^bin/opencode-lean-prompt\.md$'
}

vocabulary=$("$PYTHON" "$ROOT/bin/models.py" vocabulary) || exit 1
[ -n "$vocabulary" ] || exit 0

report() { # <file> <grep output>
  local hit
  while IFS= read -r hit; do
    [ -n "$hit" ] || continue
    case $hit in *'style-check: allow'*) continue ;; esac
    printf '%s\t%s\n' "$1" "${hit%%:*}"
  done
}

hits=$(mktemp)
trap 'rm -f "$hits"' EXIT

# Names long enough to search for as they stand.
while IFS= read -r word; do
  [ -n "$word" ] || continue
  while IFS= read -r file; do
    [ -f "$ROOT/$file" ] || continue
    report "$file" < <(grep -Fn -- "$word" "$ROOT/$file" 2>/dev/null) >> "$hits"
  done < <(scanned)
done <<<"$vocabulary"

# Provider names, in the machinery only. A name too brief to grep for on its own
# is still refused where it is used as a value — quoted, or after "=".
while IFS= read -r name; do
  [ -n "$name" ] || continue
  case $name in local|default|small|main|command|exec|name) continue ;; esac
  while IFS= read -r file; do
    [ -f "$ROOT/$file" ] || continue
    if [ "${#name}" -lt 4 ]; then
      report "$file" < <(grep -En -- "[\"'=]${name}([^A-Za-z0-9_-]|\$)" "$ROOT/$file" 2>/dev/null)
    else
      report "$file" < <(grep -Fn -- "$name" "$ROOT/$file" 2>/dev/null)
    fi >> "$hits"
  done < <(machinery)
done < <("$PYTHON" "$ROOT/bin/models.py" providers)

# One line per offending line, however many words it matched.
if [ -s "$hits" ]; then
  sort -u "$hits" | while IFS=$'\t' read -r file line; do
    printf '  %s:%s: %s\n' "$file" "$line" \
      "$(sed -n "${line}p" "$ROOT/$file" | sed 's/^[[:space:]]*//')"
  done
fi

if [ -s "$hits" ]; then
  echo
  echo "style-check: the lines above name something only configs.jsonc may name." >&2
  echo "  Read it from configs.jsonc instead — bin/models.py resolves every one of" >&2
  echo "  them, and bin/model-ref.sh turns a provider and a role into a model id." >&2
  echo "  See CLAUDE.md. A line that truly has to carry one ends with" >&2
  echo "  'style-check: allow'." >&2
  exit 1
fi
