#!/usr/bin/env python3
"""Resolve configs.jsonc into the values every agent CLI this repo writes for needs.

configs.jsonc at the repo root holds every provider: its endpoint, the models it
serves, and the tags that say which slot each model fills. In any string,
"${NAME}" is read from the environment and "${NAME:-fallback}" falls back to the
text after ":-" when NAME is unset or empty — the shell's own syntax. The .env
beside it holds those values, so the file carries references to secrets rather
than secrets, and an endpoint can ship a default that .env overrides.

The file is JSON with // line comments allowed.

  models.py sh <provider>       shell assignments (M_-prefixed) for eval
  models.py check [<provider>]  validate, print nothing on success
  models.py tags <provider>     "<id><tab><tag>,<tag>" per model
  models.py providers           one provider name per line
  models.py primary             the provider marked "primary", if any
  models.py env-vars            every "${NAME}" the file references, with its provider
"""

import json
import os
import re
import shlex
import sys
from pathlib import Path

CONFIGS = Path(__file__).resolve().parent.parent / "configs.jsonc"

# "default" and "small" are the two roles, and every slot follows one of them.
# The rest are the Claude Code variables that can break away from that pair,
# spelled exactly as Claude Code reads them; there is no tag for a variable
# whose only meaning would be "the default one" or "the small one".
ROLE_TAGS = (
    "default",
    "small",
    "ANTHROPIC_DEFAULT_OPUS_MODEL",
    "ANTHROPIC_DEFAULT_SONNET_MODEL",
    "ANTHROPIC_DEFAULT_FABLE_MODEL",
    "CLAUDE_CODE_SUBAGENT_MODEL",
)

# Claude Code variable -> the tags it follows, most specific first.
CLAUDE_SLOTS = {
    "ANTHROPIC_MODEL": ("default",),
    "ANTHROPIC_DEFAULT_OPUS_MODEL": ("ANTHROPIC_DEFAULT_OPUS_MODEL", "default"),
    "ANTHROPIC_DEFAULT_SONNET_MODEL": ("ANTHROPIC_DEFAULT_SONNET_MODEL", "default"),
    "ANTHROPIC_DEFAULT_FABLE_MODEL": ("ANTHROPIC_DEFAULT_FABLE_MODEL", "default"),
    "ANTHROPIC_DEFAULT_HAIKU_MODEL": ("small", "default"),
    "CLAUDE_CODE_SUBAGENT_MODEL": ("CLAUDE_CODE_SUBAGENT_MODEL", "small", "default"),
}

MODEL_KEYS = {"id", "claude_id", "tags", "context_window", "max_tokens", "reasoning", "input"}
PROVIDER_KEYS = {"API_KEY", "BASE_URL", "REQUEST_HEADERS", "primary", "schema", "schema_id", "defaults", "claude", "opencode", "models"}

# How OpenCode is told about a provider. "local" declares the package, the
# endpoint and every model below; "models.dev" writes only the key and lets
# that registry supply the rest — against whichever endpoint it lists.
SCHEMAS = ("local", "models.dev")
CLAUDE_KEYS = {"command", "args", "env", "auto_compact_window"}
OPENCODE_KEYS = {"lean", "context_window", "max_tokens"}

REFERENCE = re.compile(r"\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}")


class ConfigError(Exception):
    pass


def strip_comments(text):
    """Drop // line comments outside of strings, so configs.jsonc can be annotated.

    Newlines are kept, so a JSON error still points at the right line.
    """
    out = []
    index = 0
    in_string = False
    escaped = False
    while index < len(text):
        char = text[index]
        if in_string:
            out.append(char)
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                in_string = False
            index += 1
        elif char == '"':
            in_string = True
            out.append(char)
            index += 1
        elif char == "/" and text[index + 1 : index + 2] == "/":
            while index < len(text) and text[index] != "\n":
                index += 1
        else:
            out.append(char)
            index += 1
    return "".join(out)


def expand(value):
    """"${NAME}" -> the environment's value, "${NAME:-x}" -> x when it is unset or empty."""
    return REFERENCE.sub(lambda m: os.environ.get(m.group(1)) or (m.group(2) or ""), value)


def sole_reference(value):
    """(variable, fallback) when the value is exactly one reference, else ("", "").

    A value shaped that way can be handed to pi as a command that reads the
    variable at request time, so nothing resolved from the environment is copied
    into a generated config. A fallback written here is already in git, so it
    travels with the reference.
    """
    match = REFERENCE.fullmatch(value or "")
    return (match.group(1), match.group(2) or "") if match else ("", "")


def _check_keys(where, obj, allowed):
    for key in obj:
        if key not in allowed:
            raise ConfigError(f"{where}: unknown key {key!r} (allowed: {', '.join(sorted(allowed))})")


def _int(where, value, key):
    if isinstance(value, bool) or not isinstance(value, int):
        raise ConfigError(f"{where}: {key} must be an integer, got {value!r}")
    if value <= 0:
        raise ConfigError(f"{where}: {key} must be positive, got {value!r}")
    return value


def load_file():
    try:
        raw = json.loads(strip_comments(CONFIGS.read_text()))
    except FileNotFoundError:
        raise ConfigError(f"{CONFIGS}: not found")
    except json.JSONDecodeError as exc:
        raise ConfigError(f"{CONFIGS}: invalid JSON — {exc}")
    if not isinstance(raw, dict) or not isinstance(raw.get("providers"), dict):
        raise ConfigError(f"{CONFIGS}: top level must be an object with a \"providers\" object")
    if not raw["providers"]:
        raise ConfigError(f"{CONFIGS}: providers is empty")
    return raw["providers"]


def primary_provider():
    """The provider marked "primary" — the one every generated config starts on."""
    marked = [name for name, raw in load_file().items() if raw.get("primary")]
    if len(marked) > 1:
        raise ConfigError(
            f"{CONFIGS}: more than one provider is primary ({', '.join(marked)})"
        )
    return marked[0] if marked else ""


def load(name):
    """One provider, validated, with its tags resolved to slots."""
    providers = load_file()
    if name not in providers:
        known = ", ".join(providers)
        raise ConfigError(f"{CONFIGS}: no provider named {name!r} (known: {known})")
    where = f"{CONFIGS}: providers.{name}"
    raw = providers[name]
    if not isinstance(raw, dict):
        raise ConfigError(f"{where}: must be an object")
    _check_keys(where, raw, PROVIDER_KEYS)

    schema = raw.get("schema") or "local"
    if schema not in SCHEMAS:
        raise ConfigError(f"{where}: unknown schema {schema!r} (known: {', '.join(SCHEMAS)})")
    # The name that registry files the provider under, which is often not this
    # one: it defaults to the provider's name and is overridden when it differs.
    schema_id = raw.get("schema_id") or name

    base_url = expand(raw.get("BASE_URL") or "").rstrip("/")
    if not base_url:
        raise ConfigError(f"{where}: BASE_URL is required")

    headers_raw = raw.get("REQUEST_HEADERS") or {}
    if not isinstance(headers_raw, dict):
        raise ConfigError(f"{where}: REQUEST_HEADERS must be an object")
    headers = []
    for key, value in headers_raw.items():
        var, fallback = sole_reference(value)
        headers.append({"name": key, "var": var, "fallback": fallback, "value": expand(value)})

    defaults = raw.get("defaults") or {}
    _check_keys(f"{where}.defaults", defaults, MODEL_KEYS - {"id", "claude_id", "tags"})
    claude = raw.get("claude") or {}
    _check_keys(f"{where}.claude", claude, CLAUDE_KEYS)
    opencode = raw.get("opencode") or {}
    _check_keys(f"{where}.opencode", opencode, OPENCODE_KEYS)

    entries = raw.get("models")
    if not isinstance(entries, list) or not entries:
        raise ConfigError(f"{where}: models must be a non-empty array")

    models = []
    by_tag = {}
    for index, entry in enumerate(entries):
        at = f"{where}.models[{index}]"
        if not isinstance(entry, dict):
            raise ConfigError(f"{at}: must be an object")
        _check_keys(at, entry, MODEL_KEYS)
        model_id = entry.get("id")
        if not isinstance(model_id, str) or not model_id:
            raise ConfigError(f"{at}: id is required")
        merged = dict(defaults)
        merged.update(entry)
        tags = merged.get("tags") or []
        if not isinstance(tags, list):
            raise ConfigError(f"{at}: tags must be an array")
        input_kinds = merged.get("input", ["text"])
        if not isinstance(input_kinds, list) or not all(k in ("text", "image") for k in input_kinds):
            raise ConfigError(f"{at}: input must be an array of \"text\" / \"image\"")
        model = {
            "id": model_id,
            "claude_id": merged.get("claude_id", model_id),
            "tags": tags,
            "context_window": _int(at, merged.get("context_window"), "context_window"),
            "max_tokens": _int(at, merged.get("max_tokens"), "max_tokens"),
            "reasoning": bool(merged.get("reasoning", True)),
            "input": input_kinds,
        }
        for tag in tags:
            if tag not in ROLE_TAGS:
                raise ConfigError(f"{at}: unknown tag {tag!r} (known: {', '.join(ROLE_TAGS)})")
            if tag in by_tag:
                raise ConfigError(f"{at}: tag {tag!r} is already on {by_tag[tag]['id']!r}")
            by_tag[tag] = model
        models.append(model)

    if "default" not in by_tag:
        raise ConfigError(f"{where}: no model is tagged 'default'")

    slots = {
        slot: next(by_tag[tag] for tag in candidates if tag in by_tag)
        for slot, candidates in CLAUDE_SLOTS.items()
    }

    env = claude.get("env") or {}
    if not isinstance(env, dict):
        raise ConfigError(f"{where}.claude: env must be an object")

    api_key_var, api_key_fallback = sole_reference(raw.get("API_KEY") or "")
    return {
        "name": name,
        "api_key": expand(raw.get("API_KEY") or ""),
        "api_key_var": api_key_var,
        "api_key_fallback": api_key_fallback,
        "base_url": base_url,
        "schema": schema,
        "schema_id": schema_id,
        "headers": headers,
        "command": claude.get("command") or f"claude{name}",
        "args": claude.get("args", ""),
        "env": {k: str(v) for k, v in env.items()},
        "auto_compact_window": claude.get("auto_compact_window") or slots["ANTHROPIC_MODEL"]["context_window"],
        "lean": bool(opencode.get("lean", False)),
        "opencode_context_window": opencode.get("context_window"),
        "opencode_max_tokens": opencode.get("max_tokens"),
        "models": models,
        "slots": slots,
        "default_model": by_tag["default"],
        "small_model": by_tag.get("small", by_tag["default"]),
    }


def pi_models_json(config):
    """The "models" array body of a pi models.json provider block, indented to fit."""
    return ",\n".join(
        "        {\n"
        f'          "id": "{model["id"]}",\n'
        f'          "reasoning": {"true" if model["reasoning"] else "false"},\n'
        f'          "input": {json.dumps(model["input"])},\n'
        f'          "contextWindow": {model["context_window"]},\n'
        f'          "maxTokens": {model["max_tokens"]}\n'
        "        }"
        for model in config["models"]
    )


def opencode_models_json(config):
    """The "models" object body of an OpenCode provider block, indented to fit.

    OpenCode compacts a session once it fills the context, so opencode.context_window
    caps the window a conversation may grow into — not the endpoint's capacity.
    """
    context_cap = config["opencode_context_window"]
    output_cap = config["opencode_max_tokens"]
    return ",\n".join(
        f'        "{model["id"]}": {{ "limit": {{ "context": {context_cap or model["context_window"]},'
        f' "output": {output_cap or model["max_tokens"]} }} }}'
        for model in config["models"]
    )


def model_rows(config):
    """One line per model: id, context window, max tokens, reasoning, input kinds.

    The fields are separated by US (\x1f) so a generator can read them back with
    `read` without an empty one shifting the rest. Every agent CLI spells a model
    differently; this is the material each of their generators formats.
    """
    return "\n".join(
        "\x1f".join(
            (
                model["id"],
                str(model["context_window"]),
                str(model["max_tokens"]),
                "true" if model["reasoning"] else "false",
                ",".join(model["input"]),
            )
        )
        for model in config["models"]
    )


def shell(config):
    slots = config["slots"]
    values = {
        "M_NAME": config["name"],
        "M_COMMAND": config["command"],
        "M_API_KEY": config["api_key"],
        "M_API_KEY_VAR": config["api_key_var"],
        "M_API_KEY_FALLBACK": config["api_key_fallback"],
        "M_BASE_URL": config["base_url"],
        "M_SCHEMA": config["schema"],
        "M_SCHEMA_ID": config["schema_id"],
        # One header per line: name, the variable it came from (empty when the
        # value is a literal), that variable's fallback, then the value. The
        # fields are separated by US (\x1f), not a tab: bash collapses runs of
        # IFS whitespace into one delimiter, so an empty field between two tabs
        # would shift every field after it.
        "M_HEADERS": "\n".join(
            "\x1f".join((h["name"], h["var"], h["fallback"], h["value"])) for h in config["headers"]
        ),
        "M_CLAUDE_ARGS": config["args"],
        "M_CLAUDE_ENV_SH": "\n".join(
            f"export {key}={shlex.quote(value)}" for key, value in sorted(config["env"].items())
        ),
        "M_CLAUDE_CODE_AUTO_COMPACT_WINDOW": str(config["auto_compact_window"]),
        "M_DEFAULT_MODEL": config["default_model"]["id"],
        "M_SMALL_MODEL": config["small_model"]["id"],
        "M_OPENCODE_LEAN": "true" if config["lean"] else "false",
        "M_OPENCODE_MODELS_JSON": opencode_models_json(config),
        "M_PI_MODELS_JSON": pi_models_json(config),
        "M_MODEL_ROWS": model_rows(config),
        "M_MODEL_IDS": " ".join(model["id"] for model in config["models"]),
    }
    for slot in CLAUDE_SLOTS:
        values[f"M_{slot}"] = slots[slot]["claude_id"]
    return "\n".join(f"{key}={shlex.quote(value)}" for key, value in values.items())


def vocabulary():
    """Every concrete provider name this file owns — what no other file may hold.

    Built from the file itself, so adding a provider changes what the style check
    refuses without touching the check.
    """
    words = set()
    for name in load_file():
        config = load(name)
        words.update(model["id"] for model in config["models"])
        words.update(model["claude_id"] for model in config["models"])
        words.add(config["base_url"])
        words.add(f"{name}-anthropic")
    # A name shorter than this cannot be searched for without matching prose.
    return "\n".join(sorted(w for w in words if len(w) >= 4 and w != "default"))


def env_vars():
    """Every reference in the file, as "<provider><tab><var><tab><what><tab><fallback>".

    A reference with a fallback is optional: the file already works without it.
    """
    lines = []
    for name, raw in load_file().items():
        fields = [("API_KEY", raw.get("API_KEY") or ""), ("BASE_URL", raw.get("BASE_URL") or "")]
        fields += [
            (f"REQUEST_HEADERS {header}", value or "")
            for header, value in (raw.get("REQUEST_HEADERS") or {}).items()
        ]
        for what, value in fields:
            for var, fallback in REFERENCE.findall(value):
                lines.append(f"{name}\t{var}\t{what}\t{fallback}")
    return "\n".join(lines)


def main(argv):
    action = argv[1] if len(argv) > 1 else ""
    argument = argv[2] if len(argv) > 2 else ""
    if action not in ("sh", "check", "tags", "providers", "env-vars", "primary", "vocabulary"):
        print(__doc__.strip(), file=sys.stderr)
        return 2
    try:
        if action == "providers":
            print("\n".join(load_file()))
        elif action == "primary":
            print(primary_provider())
        elif action == "vocabulary":
            print(vocabulary())
        elif action == "env-vars":
            print(env_vars())
        elif action == "check" and not argument:
            for name in load_file():
                load(name)
            primary_provider()
        elif not argument:
            print(f"models.py {action}: a provider name is required", file=sys.stderr)
            return 2
        else:
            config = load(argument)
            if action == "sh":
                print(shell(config))
            elif action == "tags":
                print("\n".join(f"{m['id']}\t{','.join(m['tags'])}" for m in config["models"]))
    except ConfigError as exc:
        print(f"configs.jsonc: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
