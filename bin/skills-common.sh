#!/usr/bin/env bash
# Shared helpers for the skills half of bin/ — where skills, subagents,
# AGENTS.md and OpenCode's commands and plugins are installed, and what is
# already linked there. Sourced, never executed directly.

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
# shellcheck disable=SC1091
source "$ROOT/bin/ui.sh"
# shellcheck disable=SC1091
source "$ROOT/bin/common.sh"

SKILLS_SRC="$ROOT/skills"
AGENTS_SRC="$ROOT/agents"

# OpenCode's own extension points: a slash command per opencode/command/*.md,
# a plugin per opencode/plugin/*.js. Both are global, so they apply whichever
# provider the session runs on.
OPENCODE_SRC="$ROOT/opencode"
OPENCODE_PLUGIN_TEMPLATE="$ROOT/bin/opencode-plugin.template"

# ~/.claude is Claude Code's own config dir. ~/.agents is the vendor-neutral
# location the other agent CLIs read skills from.
TARGET_ROOTS=("$HOME/.claude" "$HOME/.agents")

# One global instruction file, linked to wherever each CLI looks for it.
# Claude Code does not read AGENTS.md itself, so it gets the CLAUDE.md name.
CONTEXT_SRC="$ROOT/AGENTS.md"
CONTEXT_TARGETS=("$HOME/.claude/CLAUDE.md" "$HOME/.pi/agent/AGENTS.md" "$HOME/.codex/AGENTS.md")

context_reader() { # <target> -> the CLI that reads it
  case $1 in
    "$HOME/.claude/CLAUDE.md") echo claude ;;
    "$HOME/.pi/agent/AGENTS.md") echo pi ;;
    "$HOME/.codex/AGENTS.md") echo codex ;;
  esac
}

skill_readers() { # <root> -> CLIs that discover skills there
  # opencode reads both roots; pi reads ~/.pi/agent/skills and ~/.agents/skills;
  # codex uses .agents/skills as its skills root.
  case $1 in
    "$HOME/.claude") echo 'claude opencode' ;;
    "$HOME/.agents") echo 'codex opencode pi' ;;
  esac
}

skill_names() { # every skills/<name>/ directory in the repo
  local d
  for d in "$SKILLS_SRC"/*/; do
    [ -d "$d" ] && basename "$d"
  done
  return 0
}

agent_names() { # every agents/<name>.md file in the repo
  local f
  for f in "$AGENTS_SRC"/*.md; do
    [ -e "$f" ] && basename "$f"
  done
  return 0
}

opencode_command_names() { # every opencode/command/*.md file in the repo
  local f
  for f in "$OPENCODE_SRC"/command/*.md; do
    [ -e "$f" ] && basename "$f"
  done
  return 0
}

opencode_plugin_names() { # every opencode/plugin/*.js file in the repo
  local f
  for f in "$OPENCODE_SRC"/plugin/*.js; do
    [ -e "$f" ] && basename "$f"
  done
  return 0
}

shim_from_repo() { # <path> -> 0 when it is a plugin shim generated from this repo
  [ -f "$1" ] || return 1
  generated_here "$1" || return 1
  grep -q "\"$ROOT/" "$1"
}

frontmatter_field() { # <file> <field> -> first value, empty when absent
  [ -f "$1" ] || return 0
  sed -n "s/^$2: *//p" "$1" | head -1
}

opencode_summary() { # <file> -> what it does: frontmatter for a command,
                     # the first line of the header comment for a plugin
  case $1 in
    *.md) frontmatter_field "$1" description ;;
    *) sed -n 's|^ \* \(..*\)|\1|p' "$1" | head -1 ;;
  esac
}

# Trim to a display width, counting CJK as two columns. Width is derived from
# the byte/character ratio rather than per-character lookup: exact for pure
# ASCII or pure CJK, close enough for the mixed descriptions we print.
str_bytes() { # <text> -> byte length (runs in a subshell, so the C locale
              # never leaks into the caller's character-based expansions)
  LC_ALL=C
  printf '%d' "${#1}"
}

trunc() { # <text> <max columns>
  local text=$1 max=$2 chars bytes width keep
  chars=${#text}
  [ "$chars" -gt 0 ] || return 0
  bytes=$(str_bytes "$text")
  width=$(( chars + (bytes - chars + 1) / 2 ))
  if [ "$width" -le "$max" ]; then
    printf '%s' "$text"
    return 0
  fi
  keep=$(( max * chars / width - 1 ))
  [ "$keep" -gt 0 ] || keep=1
  printf '%s…' "${text:0:keep}"
}

linked_to_repo() { # <path> -> 0 when it is a symlink into this repo
  [ -L "$1" ] || return 1
  case "$(readlink "$1")" in
    "$ROOT"/*) return 0 ;;
    *) return 1 ;;
  esac
}

installed_in() { # <root> <kind: skills|agents> <name>
  linked_to_repo "$1/$2/$3"
}

# Dangling symlinks left behind when a skill is renamed or removed upstream.
dangling_links() { # <dir>...
  local dir
  for dir in "$@"; do
    [ -d "$dir" ] || continue
    find "$dir" -maxdepth 1 -type l ! -exec test -e {} \; -print 2>/dev/null
  done
  return 0
}
