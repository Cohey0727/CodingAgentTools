SHELL   := /bin/bash

ROOT          := $(abspath $(dir $(lastword $(MAKEFILE_LIST))))
COMMON        := $(ROOT)/bin/common.sh

.PHONY: setup setup-providers setup-skills list uninstall help update pi-global opencode-global \
	crush-global reasonix-global codewhale-global dsh-global check hooks

# Both halves of the repo: the provider wizard first (it prompts), then the
# skill symlinks. SKIP_BANNER keeps it to a single banner.
setup: setup-providers
	@SKIP_BANNER=1 "$(ROOT)/bin/skills-setup.sh"

# Interactive wizard: checkbox provider picker, per-provider API token
# prompts (Enter keeps the current token), pi package install, one global
# config per agent CLI, PATH checks.
setup-providers:
	@"$(ROOT)/bin/setup.sh"

# Symlink every skill under skills/ and every subagent under agents/ into
# ~/.claude (Claude Code) and ~/.agents (Codex and other agent CLIs), and
# AGENTS.md into whatever name each CLI reads it under.
setup-skills:
	@"$(ROOT)/bin/skills-setup.sh"

# Validate configs.jsonc, then refuse any provider name outside it.
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

# Fetch the live model catalog of every provider that names one ("catalog")
# and rewrite that provider's models in configs.jsonc from the answer, then
# regenerate every global config from configs.jsonc — one command brings
# everything up to date. A generator failing stops the run: half-refreshed
# configs would not say so themselves.
update:
	@"$(ROOT)/bin/models-update.sh"
	@. "$(COMMON)"; for generator in $$GLOBAL_GENERATORS; do \
		"$(ROOT)/bin/$$generator.sh" || exit 1; \
	done

# Show what this repo manages, with install status.
list:
	@"$(ROOT)/bin/list.sh"

uninstall:
	@. "$(COMMON)"; for out in $$(generated_config_paths); do \
		if generated_here "$$out"; then \
			rm -f "$$out" && echo "  Removed $$out"; \
		fi; \
	done
	@. "$(COMMON)"; rm -rf "$$(opencode_tokens_dir)" \
		&& echo "  Removed $$(opencode_tokens_dir)"
	@. "$(COMMON)"; pi_link_opencode_auth | sed 's/^/  pi auth: /'
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

# One target per agent CLI: each writes that CLI's own global config from
# configs.jsonc, so a bare `pi`, `opencode`, `crush`,
# `reasonix` or `codewhale`, and every `dsh --profile`, lists every provider.
# `make setup` runs them all.
pi-global:
	@"$(ROOT)/bin/pi-global-models.sh"

opencode-global:
	@"$(ROOT)/bin/opencode-global-config.sh"

crush-global:
	@"$(ROOT)/bin/crush-global-config.sh"

reasonix-global:
	@"$(ROOT)/bin/reasonix-global-config.sh"

codewhale-global:
	@"$(ROOT)/bin/codewhale-global-config.sh"

dsh-global:
	@"$(ROOT)/bin/dsh-global-config.sh"

help:
	@"$(ROOT)/bin/help.sh"
