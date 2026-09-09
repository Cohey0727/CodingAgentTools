#!/usr/bin/env python3
"""Resolve a provider's models.json into the values Claude Code, OpenCode and pi need.

providers/<name>/models.json holds every model the provider serves: its id, its
limits, and the tags that say which slot it fills. providers/<name>/.env holds
only what cannot be in git — API_TOKEN, BASE_URL and HEADERS.

The file is JSON with // line comments allowed.

  models.py sh <provider dir>       shell assignments (M_-prefixed) for eval
  models.py check <provider dir>    validate only, print nothing
  models.py tags <provider dir>     "<id>\t<tag>,<tag>" per model
"""

import json
import shlex
import sys
from pathlib import Path

# Every tag a model may carry. Each names a slot in one of the three CLIs, so an
# unknown one is a typo rather than a label: a model that fills no slot carries
# no tags at all and is merely listed.
ROLE_TAGS = (
    "default",
    "small",
    "claude_model",
    "claude_opus_model",
    "claude_sonnet_model",
    "claude_haiku_model",
    "claude_fable_model",
    "claude_subagent_model",
    "opencode_model",
    "opencode_small_model",
    "pi_model",
    "pi_small_model",
)

# Slot -> the tags it follows, most specific first. A slot with no tag of its
# own falls back to the generic "default" / "small" pair, so a provider whose
# models fill every slot the obvious way needs only those two tags.
SLOTS = {
    "claude_model": ("claude_model", "default"),
    "claude_opus_model": ("claude_opus_model", "claude_model", "default"),
    "claude_sonnet_model": ("claude_sonnet_model", "claude_model", "default"),
    "claude_fable_model": ("claude_fable_model", "claude_model", "default"),
    "claude_haiku_model": ("claude_haiku_model", "small", "default"),
    "claude_subagent_model": ("claude_subagent_model", "small", "default"),
    "opencode_model": ("opencode_model", "default"),
    "opencode_small_model": ("opencode_small_model", "small", "default"),
    "pi_model": ("pi_model", "default"),
    "pi_small_model": ("pi_small_model", "small", "default"),
}

MODEL_KEYS = {"id", "claude_id", "tags", "context_window", "max_tokens", "reasoning", "input"}
TOP_KEYS = {"name", "defaults", "claude", "opencode", "models"}
CLAUDE_KEYS = {"command", "args", "env", "auto_compact_window"}
OPENCODE_KEYS = {"lean", "context_window", "max_tokens"}


class ConfigError(Exception):
    pass


def strip_comments(text):
    """Drop // line comments outside of strings, so models.json can be annotated.

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


def load(directory):
    """providers/<name>/models.json -> the validated config, tags resolved to slots."""
    path = Path(directory) / "models.json"
    try:
        raw = json.loads(strip_comments(path.read_text()))
    except FileNotFoundError:
        raise ConfigError(f"{path}: not found")
    except json.JSONDecodeError as exc:
        raise ConfigError(f"{path}: invalid JSON — {exc}")
    if not isinstance(raw, dict):
        raise ConfigError(f"{path}: top level must be an object")
    _check_keys(path, raw, TOP_KEYS)

    name = raw.get("name") or Path(directory).name
    defaults = raw.get("defaults") or {}
    _check_keys(f"{path}: defaults", defaults, MODEL_KEYS - {"id", "claude_id", "tags"})
    claude = raw.get("claude") or {}
    _check_keys(f"{path}: claude", claude, CLAUDE_KEYS)
    opencode = raw.get("opencode") or {}
    _check_keys(f"{path}: opencode", opencode, OPENCODE_KEYS)

    entries = raw.get("models")
    if not isinstance(entries, list) or not entries:
        raise ConfigError(f"{path}: models must be a non-empty array")

    models = []
    by_tag = {}
    for index, entry in enumerate(entries):
        where = f"{path}: models[{index}]"
        if not isinstance(entry, dict):
            raise ConfigError(f"{where}: must be an object")
        _check_keys(where, entry, MODEL_KEYS)
        model_id = entry.get("id")
        if not isinstance(model_id, str) or not model_id:
            raise ConfigError(f"{where}: id is required")
        merged = dict(defaults)
        merged.update(entry)
        tags = merged.get("tags") or []
        if not isinstance(tags, list):
            raise ConfigError(f"{where}: tags must be an array")
        input_kinds = merged.get("input", ["text"])
        if not isinstance(input_kinds, list) or not all(k in ("text", "image") for k in input_kinds):
            raise ConfigError(f"{where}: input must be an array of \"text\" / \"image\"")
        model = {
            "id": model_id,
            "claude_id": merged.get("claude_id", model_id),
            "tags": tags,
            "context_window": _int(where, merged.get("context_window"), "context_window"),
            "max_tokens": _int(where, merged.get("max_tokens"), "max_tokens"),
            "reasoning": bool(merged.get("reasoning", True)),
            "input": input_kinds,
        }
        for tag in tags:
            if tag not in ROLE_TAGS:
                raise ConfigError(f"{where}: unknown tag {tag!r} (known: {', '.join(ROLE_TAGS)})")
            if tag in by_tag:
                raise ConfigError(f"{where}: tag {tag!r} is already on {by_tag[tag]['id']!r}")
            by_tag[tag] = model
        models.append(model)

    slots = {}
    for slot, candidates in SLOTS.items():
        for tag in candidates:
            if tag in by_tag:
                slots[slot] = by_tag[tag]
                break
        else:
            raise ConfigError(
                f"{path}: no model fills the {slot} slot — tag one with "
                f"{' or '.join(repr(t) for t in candidates)}"
            )

    env = claude.get("env") or {}
    if not isinstance(env, dict):
        raise ConfigError(f"{path}: claude.env must be an object")

    return {
        "name": name,
        "command": claude.get("command") or f"claude{name}",
        "args": claude.get("args", ""),
        "env": {k: str(v) for k, v in env.items()},
        "auto_compact_window": claude.get("auto_compact_window") or slots["claude_model"]["context_window"],
        "lean": bool(opencode.get("lean", False)),
        "opencode_context_window": opencode.get("context_window"),
        "opencode_max_tokens": opencode.get("max_tokens"),
        "models": models,
        "slots": slots,
    }


def pi_models_json(config):
    """The "models" array body of a pi models.json provider block, indented to fit."""
    blocks = []
    for model in config["models"]:
        blocks.append(
            "        {\n"
            f'          "id": "{model["id"]}",\n'
            f'          "reasoning": {"true" if model["reasoning"] else "false"},\n'
            f'          "input": {json.dumps(model["input"])},\n'
            f'          "contextWindow": {model["context_window"]},\n'
            f'          "maxTokens": {model["max_tokens"]}\n'
            "        }"
        )
    return ",\n".join(blocks)


def opencode_models_json(config):
    """The "models" object body of an OpenCode provider block, indented to fit.

    OpenCode compacts a session once it fills the context, so opencode.context_window
    caps the window a conversation may grow into — not the endpoint's capacity.
    """
    context_cap = config["opencode_context_window"]
    output_cap = config["opencode_max_tokens"]
    lines = []
    for model in config["models"]:
        context = context_cap or model["context_window"]
        output = output_cap or model["max_tokens"]
        lines.append(f'        "{model["id"]}": {{ "limit": {{ "context": {context}, "output": {output} }} }}')
    return ",\n".join(lines)


def shell(config):
    slots = config["slots"]
    values = {
        "M_NAME": config["name"],
        "M_COMMAND": config["command"],
        "M_CLAUDE_ARGS": config["args"],
        "M_CLAUDE_ENV_SH": "\n".join(
            f"export {key}={shlex.quote(value)}" for key, value in sorted(config["env"].items())
        ),
        "M_CLAUDE_MODEL": slots["claude_model"]["claude_id"],
        "M_CLAUDE_OPUS_MODEL": slots["claude_opus_model"]["claude_id"],
        "M_CLAUDE_SONNET_MODEL": slots["claude_sonnet_model"]["claude_id"],
        "M_CLAUDE_HAIKU_MODEL": slots["claude_haiku_model"]["claude_id"],
        "M_CLAUDE_FABLE_MODEL": slots["claude_fable_model"]["claude_id"],
        "M_CLAUDE_SUBAGENT_MODEL": slots["claude_subagent_model"]["claude_id"],
        "M_CLAUDE_AUTO_COMPACT_WINDOW": str(config["auto_compact_window"]),
        "M_OPENCODE_MODEL": slots["opencode_model"]["id"],
        "M_OPENCODE_SMALL_MODEL": slots["opencode_small_model"]["id"],
        "M_OPENCODE_LEAN": "true" if config["lean"] else "false",
        "M_OPENCODE_MODELS_JSON": opencode_models_json(config),
        "M_PI_MODEL": slots["pi_model"]["id"],
        "M_PI_SMALL_MODEL": slots["pi_small_model"]["id"],
        "M_PI_MODELS_JSON": pi_models_json(config),
        "M_MODEL_IDS": " ".join(model["id"] for model in config["models"]),
    }
    return "\n".join(f"{key}={shlex.quote(value)}" for key, value in values.items())


def tags(config):
    return "\n".join(f"{model['id']}\t{','.join(model['tags'])}" for model in config["models"])


def main(argv):
    if len(argv) != 3 or argv[1] not in ("sh", "check", "tags"):
        print(__doc__.strip(), file=sys.stderr)
        return 2
    action, directory = argv[1], argv[2]
    try:
        config = load(directory)
    except ConfigError as exc:
        print(f"models.json: {exc}", file=sys.stderr)
        return 1
    if action == "sh":
        print(shell(config))
    elif action == "tags":
        print(tags(config))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
