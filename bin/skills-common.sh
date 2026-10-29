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

# Skill names this repo used to ship. `make setup-skills` deletes the symlink
# each one left in <root>/skills/; see bin/removed-skills.txt.
REMOVED_SKILLS_FILE="$ROOT/bin/removed-skills.txt"

# OpenCode's own extension points: a slash command per opencode/command/*.md,
# a plugin per opencode/plugin/*.js. Both are global, so they apply whichever
# provider the session runs on.
OPENCODE_SRC="$ROOT/opencode"

# pi's own extension points, each symlinked into pi's agent directory: an
# extension per pi/extensions/*.ts, and a subagent definition per
# pi/agents/*.md for the subagents package. pi resolves an extension's imports
# wherever the file really lives, so a symlink is enough.
PI_SRC="$ROOT/pi"
PI_KINDS="extensions agents"

# ~/.claude is Claude Code's own config dir. ~/.agents is the vendor-neutral
# location the other agent CLIs read skills from.
TARGET_ROOTS=("$HOME/.claude" "$HOME/.agents")

# Claude Code's mods, claude/mods/<name>/, load from the folders named in
# CLAUDE_CODE_PLUGIN_DIRS. Claude Code reads that variable from the environment
# or from the env block of its user settings — never a project's — and a folder
# of plugins loads each child, so naming claude/mods once covers every mod.
MODS_SRC="$ROOT/claude/mods"
CLAUDE_SETTINGS="$HOME/.claude/settings.json"

# One global instruction file, linked to wherever each CLI looks for it. Claude
# Code does not read AGENTS.md itself, so it gets the CLAUDE.md name, and Crush
# reads CRUSH.md beside its own config.
CONTEXT_SRC="$ROOT/AGENTS.md"
CONTEXT_TARGETS=(
  "$HOME/.claude/CLAUDE.md"
  "$HOME/.pi/agent/AGENTS.md"
  "$HOME/.codex/AGENTS.md"
  "$(crush_config_dir)/CRUSH.md"
  "$(dsh_home)/AGENTS.md"
  "$(command_code_home)/AGENTS.md"
)

context_reader() { # <target> -> the CLI that reads it
  case $1 in
    "$HOME/.claude/CLAUDE.md") echo claude ;;
    "$HOME/.pi/agent/AGENTS.md") echo pi ;;
    "$HOME/.codex/AGENTS.md") echo codex ;;
    "$(crush_config_dir)/CRUSH.md") echo crush ;;
    "$(dsh_home)/AGENTS.md") echo dsh ;;
    "$(command_code_home)/AGENTS.md") echo cmd ;;
  esac
}

skill_readers() { # <root> -> CLIs that discover skills there
  # opencode, crush and reasonix read both roots; pi reads ~/.pi/agent/skills
  # and ~/.agents/skills; codex uses .agents/skills as its skills root; dsh and
  # Command Code (cmd) read their own home and ~/.agents/skills. All of them
  # follow a symlink out to this repo — except Reasonix's *instruction* loader,
  # which is why AGENTS.md has no target under ~/.reasonix.
  case $1 in
    "$HOME/.claude") echo 'claude crush opencode reasonix' ;;
    "$HOME/.agents") echo 'cmd codex crush dsh opencode pi reasonix' ;;
  esac
}

skill_names() { # every skills/<name>/ directory in the repo
  local d
  for d in "$SKILLS_SRC"/*/; do
    [ -d "$d" ] && basename "$d"
  done
  return 0
}

removed_skill_names() { # every name registered as no longer shipped
  [ -f "$REMOVED_SKILLS_FILE" ] || return 0
  sed -e 's/#.*//' -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' \
    "$REMOVED_SKILLS_FILE" | grep -v '^$'
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

mod_names() { # every claude/mods/<name>/ directory in the repo
  local d
  for d in "$MODS_SRC"/*/; do
    [ -d "$d" ] && basename "$d"
  done
  return 0
}

claude_plugin_dirs() { # add|remove -> added | present | removed | absent
  # Puts MODS_SRC into CLAUDE_CODE_PLUGIN_DIRS in Claude Code's user settings,
  # or takes it out. Claude Code writes that file itself (/model, /effort, the
  # rules you allow), so it is merged, never rewritten: every other key and
  # every other folder in the variable stays.
  "$PYTHON" - "$1" "$CLAUDE_SETTINGS" "$MODS_SRC" <<'EOF'
import json, os, sys
action, path, folder = sys.argv[1:4]
var = "CLAUDE_CODE_PLUGIN_DIRS"
try:
    with open(path) as f:
        data = json.load(f)
except FileNotFoundError:
    data = {}
except ValueError as exc:
    print(f"  {path} is not valid JSON ({exc}) — left as it is", file=sys.stderr)
    sys.exit(1)

def same(entry):
    return os.path.normpath(os.path.expanduser(entry.strip())) == folder

env = data.get("env", {})
dirs = [d for d in env.get(var, "").split(os.pathsep) if d.strip()]
named = any(same(d) for d in dirs)
if action == "add":
    if named:
        print("present")
        sys.exit(0)
    dirs.append(folder)
    status = "added"
else:
    if not named:
        print("absent")
        sys.exit(0)
    dirs = [d for d in dirs if not same(d)]
    status = "removed"

if dirs:
    env[var] = os.pathsep.join(dirs)
else:
    env.pop(var, None)
if env:
    data["env"] = env
else:
    data.pop("env", None)

# A settings.json linked in from elsewhere (a dotfiles repo) keeps its link.
path = os.path.realpath(path)
os.makedirs(os.path.dirname(path), exist_ok=True)
tmp = path + ".tmp"
with open(tmp, "w") as f:
    json.dump(data, f, indent=2, ensure_ascii=False)
    f.write("\n")
os.replace(tmp, path)
print(status)
EOF
}

pi_kind_dir() { # <kind> -> where pi reads that kind from
  printf '%s/%s' "$(pi_agent_dir)" "$1"
}

pi_names() { # <kind> -> every pi/<kind>/ file in the repo
  local f
  for f in "$PI_SRC/$1"/*.ts "$PI_SRC/$1"/*.md; do
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
                     # the first line of the header comment for a plugin or
                     # a pi extension
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

# A tool kept under vendor/ goes into an agent CLI as a link back here, or, in
# Claude Code, as a plugin from the folder added as a marketplace of the same
# name. Claude Code reads a directory marketplace's plugin from the folder
# itself, so an edit here needs no reinstall. A real file at a link's place, a
# link somewhere else, and a marketplace of the same name read from anywhere
# else are someone else's and are left alone.

link_vendored() { # <src> <target>
  if [ -e "$2" ] && ! linked_to_repo "$2"; then
    warn "skipped — $(tilde "$2") is not a link into this repo"
    return 0
  fi
  mkdir -p "$(dirname "$2")"
  ln -sfn "$1" "$2"
  ok "$(tilde "$2")"
}

unlink_vendored() { # <target> -> 0 when it removed a link into this repo
  linked_to_repo "$1" || return 1
  rm "$1"
  ok "removed $(tilde "$1")"
}

claude_marketplace_source() { # <name> -> the folder or repository Claude Code's
                              # marketplace of that name reads, empty when none
  claude plugin marketplace list --json 2>/dev/null | "$PYTHON" -c '
import json, sys
for m in json.load(sys.stdin):
    if m.get("name") == sys.argv[1]:
        print(m.get("path") or m.get("repo") or m.get("url") or "?")
' "$1"
}

claude_plugin_state() { # <plugin@marketplace> -> enabled | disabled | absent
  claude plugin list --json 2>/dev/null | "$PYTHON" -c '
import json, sys
found = [p for p in json.load(sys.stdin) if p.get("id") == sys.argv[1]]
print("absent" if not found else "enabled" if any(p.get("enabled") for p in found) else "disabled")
' "$1"
}

claude_vendor_plugin() { # <name> <folder> — the folder as marketplace <name> and
                         # <name>@<name> installed and enabled; fails when it is not
  local name=$1 folder=$2 id="$1@$1" source
  section 'Claude Code'
  if ! command -v claude >/dev/null 2>&1; then
    warn "skipped — 'claude' is not on your PATH"
    return 1
  fi
  source=$(claude_marketplace_source "$name")
  case $source in
    '')
      if ! claude plugin marketplace add "$folder" >/dev/null 2>&1; then
        warn "marketplace add failed — run 'claude plugin marketplace add $folder' by hand"
        return 1
      fi
      ok "marketplace $name -> $(tilde "$folder")"
      ;;
    "$folder") ok "marketplace $name already reads $(tilde "$folder")" ;;
    *)
      warn "skipped — the $name marketplace reads $(tilde "$source")"
      return 1
      ;;
  esac
  case $(claude_plugin_state "$id") in
    absent)
      if ! claude plugin install "$id" >/dev/null 2>&1; then
        warn "install failed — run 'claude plugin install $id' by hand"
        return 1
      fi
      ok "plugin $id installed"
      ;;
    disabled)
      if ! claude plugin enable "$id" >/dev/null 2>&1; then
        warn "enable failed — run 'claude plugin enable $id' by hand"
        return 1
      fi
      ok "plugin $id enabled"
      ;;
    enabled) ok "plugin $id already enabled" ;;
  esac
}

claude_vendor_plugin_remove() { # <name> <folder> -> 0 when it removed them
  command -v claude >/dev/null 2>&1 || return 1
  [ "$(claude_marketplace_source "$1")" = "$2" ] || return 1
  claude plugin uninstall "$1@$1" >/dev/null 2>&1 || true
  claude plugin marketplace remove "$1" >/dev/null 2>&1 || return 1
  ok "removed the Claude Code plugin and marketplace $1"
}
