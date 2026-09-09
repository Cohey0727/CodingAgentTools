SHELL   := /bin/bash
PREFIX  ?= $(HOME)/.local
BIN_DIR := $(PREFIX)/bin

ROOT          := $(abspath $(dir $(lastword $(MAKEFILE_LIST))))
COMMON        := $(ROOT)/bin/common.sh

# Every provider target acts on every provider in configs.jsonc.
PROVIDER_LIST := $(shell . $(ROOT)/bin/common.sh && provider_names)

.PHONY: setup setup-providers setup-skills list uninstall help pi-global opencode-global check hooks

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

# Validate configs.jsonc, then refuse any concrete name outside it.
check:
	@. "$(COMMON)"; models_check && echo "  configs.jsonc ok"
	@"$(ROOT)/bin/style-check.sh" && echo "  style ok"

# Install the git hooks that run `make check` before every commit.
hooks:
	@command -v lefthook >/dev/null 2>&1 || { \
		echo "hooks: lefthook is not on your PATH." >&2; \
		echo "  brew install lefthook   (or: npm install -g lefthook)" >&2; \
		exit 1; \
	}
	@lefthook install

# Show what this repo manages, with install status.
list:
	@"$(ROOT)/bin/list.sh"

uninstall:
	@for p in $(PROVIDER_LIST); do \
		for a in $$(. "$(COMMON)"; agent_names); do \
			for cmd in $$(. "$(COMMON)"; provider_command "$$p" "$$a"; printf ' '; provider_stale_commands "$$p" "$$a"); do \
				rm -f "$(BIN_DIR)/$$cmd" && echo "  Removed $(BIN_DIR)/$$cmd"; \
			done; \
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
	@. "$(COMMON)"; for a in $$(agent_names); do \
		command -v "$$a" >/dev/null 2>&1 || continue; \
		settings_resolve "$$a"; \
		for spec in $$S_PACKAGES; do \
			src=$$(pi_package_source "$$spec"); \
			if pi_package_installed "$$src"; then \
				"$$a" remove "$$src" >/dev/null 2>&1 \
					&& echo "  Removed $$a package $$src"; \
			fi; \
		done; \
	done
	@echo "  Note: .env is left in place. Delete it manually if no longer needed."
	@"$(ROOT)/bin/skills-uninstall.sh"

# Re-generate pi's global models.json from configs.jsonc (there are no pi<name>
# launchers); `make setup` does this too.
pi-global:
	@"$(ROOT)/bin/pi-global-models.sh"

# Register every provider from configs.jsonc in OpenCode's global config, so a
# bare `opencode` (there are no open<name> launchers) lists them all.
opencode-global:
	@"$(ROOT)/bin/opencode-global-config.sh"

help:
	@"$(ROOT)/bin/help.sh"
