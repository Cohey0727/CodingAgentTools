SHELL   := /bin/bash
PREFIX  ?= $(HOME)/.local
BIN_DIR := $(PREFIX)/bin

ROOT          := $(abspath $(dir $(lastword $(MAKEFILE_LIST))))
COMMON        := $(ROOT)/bin/common.sh

# Every provider target acts on every provider in configs.json.
PROVIDER_LIST := $(shell . $(ROOT)/bin/common.sh && provider_names)

.PHONY: setup setup-providers setup-skills list uninstall help pi-global opencode-global

# Both halves of the repo: the provider wizard first (it prompts), then the
# skill symlinks. SKIP_BANNER keeps it to a single banner.
setup: setup-providers
	@SKIP_BANNER=1 "$(ROOT)/bin/skills-setup.sh"

# Interactive wizard: checkbox provider picker, per-provider API token
# prompts (Enter keeps the current token), launcher install, pi package
# install, pi / OpenCode global configs, PATH checks.
setup-providers:
	@BIN_DIR="$(BIN_DIR)" "$(ROOT)/bin/setup.sh"

# Symlink every skill under skills/ and every subagent under agents/ into
# ~/.claude (Claude Code) and ~/.agents (Codex and other agent CLIs), and
# AGENTS.md into whatever name each CLI reads it under.
setup-skills:
	@"$(ROOT)/bin/skills-setup.sh"

# Show what this repo manages, with install status.
list:
	@"$(ROOT)/bin/list.sh"

uninstall:
	@for p in $(PROVIDER_LIST); do \
		for cmd in $$(. "$(COMMON)"; provider_command "$$p"; printf ' '; provider_stale_commands "$$p"); do \
			rm -f "$(BIN_DIR)/$$cmd" && echo "  Removed $(BIN_DIR)/$$cmd"; \
		done; \
	done
	@. "$(COMMON)"; out=$$(pi_global_models_path); \
		if generated_here "$$out"; then \
			rm -f "$$out" && echo "  Removed $$out"; \
		fi
	@. "$(COMMON)"; out=$$(opencode_global_config_path); \
		if generated_here "$$out"; then \
			rm -f "$$out" && echo "  Removed $$out"; \
		fi; \
		rm -rf "$$(opencode_tokens_dir)" && echo "  Removed $$(opencode_tokens_dir)"
	@if command -v pi >/dev/null 2>&1; then \
		. "$(COMMON)"; \
		for spec in $$PI_PACKAGES; do \
			src=$$(pi_package_source "$$spec"); \
			if pi_package_installed "$$src"; then \
				pi remove "$$src" >/dev/null 2>&1 \
					&& echo "  Removed pi package $$src"; \
			fi; \
		done; \
	fi
	@echo "  Note: .env is left in place. Delete it manually if no longer needed."
	@"$(ROOT)/bin/skills-uninstall.sh"

# Re-generate pi's global models.json from configs.json (there are no pi<name>
# launchers); `make setup` does this too.
pi-global:
	@"$(ROOT)/bin/pi-global-models.sh"

# Register every provider from configs.json in OpenCode's global config, so a
# bare `opencode` (there are no open<name> launchers) lists them all.
opencode-global:
	@"$(ROOT)/bin/opencode-global-config.sh"

help:
	@"$(ROOT)/bin/help.sh"
