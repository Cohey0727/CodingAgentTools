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
# A line that genuinely has to carry one ends with "style-check: allow".

set -uo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
# shellcheck disable=SC1090
source "$ROOT/bin/common.sh"

# Everything that runs. Documentation may name providers; it describes them.
scanned() {
  git -C "$ROOT" ls-files -- \
    'bin/*' 'Makefile' 'lefthook.yml' 'opencode/*' 'skills/**/*.json' '.claude/*.json' \
    | grep -v -E '^bin/opencode-lean-prompt\.md$'
}

vocabulary=$("$PYTHON" "$ROOT/bin/models.py" vocabulary) || exit 1
[ -n "$vocabulary" ] || exit 0

found=0
while IFS= read -r word; do
  [ -n "$word" ] || continue
  while IFS= read -r file; do
    [ -f "$ROOT/$file" ] || continue
    while IFS= read -r hit; do
      case $hit in *'style-check: allow'*) continue ;; esac
      printf '  %s:%s\n' "$file" "$hit"
      found=1
    done < <(grep -Fn -- "$word" "$ROOT/$file" 2>/dev/null)
  done < <(scanned)
done <<<"$vocabulary"

if [ "$found" -eq 1 ]; then
  echo
  echo "style-check: the lines above name something only configs.jsonc may name." >&2
  echo "  Read it from configs.jsonc instead — bin/models.py resolves every one of" >&2
  echo "  them, and bin/model-ref.sh turns a provider and a role into a model id." >&2
  echo "  See CLAUDE.md. A line that truly has to carry one ends with" >&2
  echo "  'style-check: allow'." >&2
  exit 1
fi
