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
# A line that genuinely has to carry one ends with "style-check: allow"; a file
# that may name a provider to SELECT it lists that word in .style-check-allow.

set -uo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
# shellcheck disable=SC1090
source "$ROOT/bin/common.sh"

# Everything that runs, tracked or newly staged — a file added in this very
# commit has to be refused too. Documentation may name providers; it describes
# them, so it is not scanned.
scanned() {
  local paths=('bin/*' 'Makefile' 'lefthook.yml' 'opencode/*' '.claude/*.json' \
               'skills/**/*.json' 'skills/**/SKILL.md')
  {
    git -C "$ROOT" ls-files -- "${paths[@]}"
    git -C "$ROOT" diff --cached --name-only --diff-filter=A -- "${paths[@]}"
  } | sort -u | grep -v -E '^bin/opencode-lean-prompt\.md$'
}

vocabulary=$("$PYTHON" "$ROOT/bin/models.py" vocabulary) || exit 1
[ -n "$vocabulary" ] || exit 0

allowed() { # <file> <word> — listed in .style-check-allow?
  local list="$ROOT/.style-check-allow" path words
  [ -f "$list" ] || return 1
  while IFS=$'\t' read -r path words; do
    case $path in ''|'#'*) continue ;; esac
    [ "$path" = "$1" ] || continue
    case ",$words," in *",$2,"*) return 0 ;; esac
  done < "$list"
  return 1
}

report() { # <file> <word> <grep output>
  local hit
  while IFS= read -r hit; do
    [ -n "$hit" ] || continue
    case $hit in *'style-check: allow'*) continue ;; esac
    allowed "$1" "$2" && continue
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
    report "$file" "$word" < <(grep -Fn -- "$word" "$ROOT/$file" 2>/dev/null) >> "$hits"
  done < <(scanned)
done <<<"$vocabulary"

# A provider named too briefly to grep for on its own is still refused where it
# is used as a value — quoted, or on the right of an assignment.
while IFS= read -r short; do
  [ -n "$short" ] || continue
  [ "${#short}" -lt 4 ] || continue
  while IFS= read -r file; do
    [ -f "$ROOT/$file" ] || continue
    report "$file" "$short" < <(grep -En -- "[\"'=]${short}([^A-Za-z0-9_-]|\$)" "$ROOT/$file" 2>/dev/null) >> "$hits"
  done < <(scanned)
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
