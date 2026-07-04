#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLAUDE_DIR="$HOME/.claude"

echo "Setting up Claude Code settings..."

# Ensure ~/.claude directory exists
mkdir -p "$CLAUDE_DIR"

# Link skills
if [ -d "$SCRIPT_DIR/skills" ]; then
  for skill_dir in "$SCRIPT_DIR/skills"/*/; do
    skill_name="$(basename "$skill_dir")"
    target="$CLAUDE_DIR/skills/$skill_name"

    if [ -L "$target" ]; then
      echo "  Updating symlink: skills/$skill_name"
      rm "$target"
    elif [ -d "$target" ]; then
      echo "  Skipping skills/$skill_name (directory already exists, not a symlink)"
      continue
    else
      echo "  Linking: skills/$skill_name"
    fi

    mkdir -p "$CLAUDE_DIR/skills"
    ln -s "$skill_dir" "$target"
  done
fi

# Link agents
if [ -d "$SCRIPT_DIR/agents" ]; then
  mkdir -p "$CLAUDE_DIR/agents"
  for agent_file in "$SCRIPT_DIR/agents"/*.md; do
    [ -e "$agent_file" ] || continue
    agent_name="$(basename "$agent_file")"
    target="$CLAUDE_DIR/agents/$agent_name"

    if [ -L "$target" ]; then
      echo "  Updating symlink: agents/$agent_name"
      rm "$target"
    elif [ -e "$target" ]; then
      echo "  Skipping agents/$agent_name (file already exists, not a symlink)"
      continue
    else
      echo "  Linking: agents/$agent_name"
    fi

    ln -s "$agent_file" "$target"
  done
fi

echo "Done."
