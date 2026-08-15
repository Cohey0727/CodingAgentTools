SHELL := /bin/bash
ROOT  := $(abspath $(dir $(lastword $(MAKEFILE_LIST))))

.PHONY: setup list uninstall help

# Symlink every skill under skills/ and every subagent under agents/ into
# ~/.claude (Claude Code) and ~/.agents (Codex and other agent CLIs).
setup:
	@"$(ROOT)/bin/setup.sh"

# Show what this repo manages, with install status per target directory.
list:
	@"$(ROOT)/bin/list.sh"

# Remove only the symlinks that point back into this repo.
uninstall:
	@"$(ROOT)/bin/uninstall.sh"

help:
	@"$(ROOT)/bin/help.sh"
