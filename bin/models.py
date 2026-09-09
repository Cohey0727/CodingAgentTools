#!/usr/bin/env python3
"""Resolve configs.jsonc into the values each agent needs.

configs.jsonc at the repo root is the whole configuration. "agents" describes
the CLIs, "providers" the endpoints, and nothing is decided here: this file
knows the shape of the config, never a provider, a model, an endpoint, a
package or a variable name. Every one of those is read.

In any string, "${NAME}" is read from the environment and "${NAME:-fallback}"
falls back to the text after ":-" when NAME is unset or empty — the shell's own
syntax. The .env beside the file holds those values, so the file carries
references to secrets rather than secrets. Inside "agents", "{name}",
"{base_url}" and "{schema_id}" stand for the provider being written.

The file is JSON with // line comments allowed.

  models.py sh <provider> <agent>  shell assignments (M_-prefixed) for eval
  models.py settings <agent>       config-wide values (S_-prefixed) for eval
  models.py check                  validate the whole file, print nothing on success
  models.py tags <provider>        "<id><tab><tag>,<tag>" per model
  models.py providers              one provider name per line
  models.py agents                 one agent name per line
  models.py env-vars               every "${NAME}" the file references, with its provider
  models.py vocabulary             every concrete name this file owns, one per line
"""

import json
import os
import re
import shlex
import sys
from pathlib import Path

CONFIGS = Path(__file__).resolve().parent.parent / "configs.jsonc"

DOCUMENT_KEYS = {"start_provider", "agents", "providers"}
AGENT_KEYS = {
    "command",
    "stale_commands",
    "launch",
    "install_url",
    "generator",
    "slots",
    "auto_compact_window_from",
    "model_tag",
    "small_model_tag",
    "schemas",
    "model_entry",
    "lean",
    "api",
    "packages",
}
SCHEMA_ENTRY_KEYS = {"id", "npm", "base_url", "declare_models"}
MODEL_ENTRY_KEYS = {"keyed_by", "indent", "inline", "value"}
LEAN_KEYS = {"prompt", "disabled_tools"}
LAUNCH_KEYS = {
    "exec", "token_var", "base_url_var", "headers_var", "auto_compact_window_var",
    "unset_vars", "token_var_aliases", "headers_var_aliases",
}
MODEL_KEYS = {"id", "claude_id", "tags", "context_window", "max_tokens", "reasoning", "input"}
PROVIDER_FIXED_KEYS = {"API_KEY", "BASE_URL", "REQUEST_HEADERS", "schema", "defaults", "models"}
PROVIDER_SCHEMA_KEYS = {"resolve", "id"}
PROVIDER_AGENT_KEYS = {
    "command", "args", "env", "auto_compact_window", "lean", "context_window", "max_tokens",
}
INPUT_KINDS = ("text", "image")

REFERENCE = re.compile(r"\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}")
PLACEHOLDER = re.compile(r"\{([a-z_]+)\}")


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


def fill(where, template, **fields):
    """"{name}-x" -> the provider's name plus "-x". Only the fields given are known."""
    out = template
    for key, value in fields.items():
        out = out.replace("{" + key + "}", value)
    left = PLACEHOLDER.search(out)
    if left:
        known = ", ".join("{" + k + "}" for k in fields)
        raise ConfigError(f"{where}: {left.group(0)} is not one of {known}")
    return out


def sole_reference(value):
    """(variable, fallback) when the value is exactly one reference, else ("", "").

    A value shaped that way can be handed to an agent as a command that reads the
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


def _object(where, value):
    if not isinstance(value, dict):
        raise ConfigError(f"{where}: must be an object")
    return value


def _string(where, value):
    if not isinstance(value, str) or not value:
        raise ConfigError(f"{where}: must be a non-empty string")
    return value


def _string_list(where, value):
    if not isinstance(value, list) or not all(isinstance(v, str) and v for v in value):
        raise ConfigError(f"{where}: must be an array of non-empty strings")
    return value


def _int(where, value, key):
    if isinstance(value, bool) or not isinstance(value, int):
        raise ConfigError(f"{where}: {key} must be an integer, got {value!r}")
    if value <= 0:
        raise ConfigError(f"{where}: {key} must be positive, got {value!r}")
    return value


def document():
    """The whole file, parsed and checked down to the shape of each section."""
    try:
        raw = json.loads(strip_comments(CONFIGS.read_text()))
    except FileNotFoundError:
        raise ConfigError(f"{CONFIGS}: not found")
    except json.JSONDecodeError as exc:
        raise ConfigError(f"{CONFIGS}: invalid JSON — {exc}")
    _object(f"{CONFIGS}", raw)
    _check_keys(f"{CONFIGS}", raw, DOCUMENT_KEYS)

    agents = _object(f"{CONFIGS}: agents", raw.get("agents") or {})
    if not agents:
        raise ConfigError(f"{CONFIGS}: agents is empty")
    for name, agent in agents.items():
        where = f"{CONFIGS}: agents.{name}"
        _check_keys(where, _object(where, agent), AGENT_KEYS)
        for key in ("command", "api", "model_tag", "small_model_tag",
                    "auto_compact_window_from", "install_url", "generator"):
            if key in agent:
                _string(f"{where}.{key}", agent[key])
        if "stale_commands" in agent:
            _string_list(f"{where}.stale_commands", agent["stale_commands"])
        for slot, candidates in _object(f"{where}.slots", agent.get("slots") or {}).items():
            _string_list(f"{where}.slots.{slot}", candidates)
        for key, entry in _object(f"{where}.schemas", agent.get("schemas") or {}).items():
            if entry is None:
                continue
            at = f"{where}.schemas.{key}"
            _check_keys(at, _object(at, entry), SCHEMA_ENTRY_KEYS)
            _string(f"{at}.id", entry.get("id"))
        if "launch" in agent:
            at = f"{where}.launch"
            _check_keys(at, _object(at, agent["launch"]), LAUNCH_KEYS)
            _string(f"{at}.exec", agent["launch"].get("exec"))
            _string_list(f"{at}.unset_vars", agent["launch"].get("unset_vars") or [])
            _string_list(f"{at}.token_var_aliases", agent["launch"].get("token_var_aliases") or [])
            _string_list(f"{at}.headers_var_aliases", agent["launch"].get("headers_var_aliases") or [])
        if "model_entry" in agent:
            at = f"{where}.model_entry"
            _check_keys(at, _object(at, agent["model_entry"]), MODEL_ENTRY_KEYS)
            if agent["model_entry"].get("value") is None:
                raise ConfigError(f"{at}.value: is required")
        if "lean" in agent:
            at = f"{where}.lean"
            _check_keys(at, _object(at, agent["lean"]), LEAN_KEYS)
            _string(f"{at}.prompt", agent["lean"].get("prompt"))
            _string_list(f"{at}.disabled_tools", agent["lean"].get("disabled_tools") or [])
        if "packages" in agent:
            _object(f"{where}.packages", agent["packages"])

    providers = _object(f"{CONFIGS}: providers", raw.get("providers") or {})
    if not providers:
        raise ConfigError(f"{CONFIGS}: providers is empty")

    start = raw.get("start_provider")
    if start is not None and start not in providers:
        raise ConfigError(
            f"{CONFIGS}: start_provider {start!r} is not a provider (known: {', '.join(providers)})"
        )
    return {
        "start_provider": start or next(iter(providers)),
        "agents": agents,
        "providers": providers,
    }


def agent_of(doc, name):
    if name not in doc["agents"]:
        raise ConfigError(f"{CONFIGS}: no agent named {name!r} (known: {', '.join(doc['agents'])})")
    return doc["agents"][name]


def known_tags(doc):
    """Every tag any agent can ask for — the roles plus the slots that break away."""
    tags = set()
    for agent in doc["agents"].values():
        for candidates in (agent.get("slots") or {}).values():
            tags.update(candidates)
        for key in ("model_tag", "small_model_tag"):
            if agent.get(key):
                tags.add(agent[key])
    return tags


def _schema(where, raw, agent):
    """(resolve, id, entry) for the provider, against the agent's "schemas"."""
    declared = _object(f"{where}.schema", raw.get("schema") or {})
    _check_keys(f"{where}.schema", declared, PROVIDER_SCHEMA_KEYS)
    schemas = agent.get("schemas")
    if not schemas:
        return "", "", None
    resolve = declared.get("resolve")
    if not resolve:
        raise ConfigError(f"{where}.schema: resolve is required (one of: {', '.join(schemas)})")
    if resolve not in schemas:
        raise ConfigError(f"{where}.schema: unknown resolve {resolve!r} (known: {', '.join(schemas)})")
    entry = schemas[resolve]
    schema_id = declared.get("id") or ""
    if entry is None:
        return resolve, "", None
    # An id is one provider's value across every agent, so an agent that does not
    # consume it simply ignores it; only a missing one is an error here.
    if "{schema_id}" in entry["id"] and not schema_id:
        raise ConfigError(f"{where}.schema: resolve {resolve!r} needs an id")
    return resolve, schema_id, entry


def _models(where, raw, defaults, tags_allowed):
    entries = raw.get("models")
    if not isinstance(entries, list) or not entries:
        raise ConfigError(f"{where}: models must be a non-empty array")
    models = []
    by_tag = {}
    for index, entry in enumerate(entries):
        at = f"{where}.models[{index}]"
        _check_keys(at, _object(at, entry), MODEL_KEYS)
        model_id = _string(f"{at}.id", entry.get("id"))
        merged = dict(defaults)
        merged.update(entry)
        tags = merged.get("tags") or []
        if not isinstance(tags, list):
            raise ConfigError(f"{at}: tags must be an array")
        input_kinds = merged.get("input", [INPUT_KINDS[0]])
        if not isinstance(input_kinds, list) or not all(k in INPUT_KINDS for k in input_kinds):
            raise ConfigError(f"{at}: input must be an array of {' / '.join(INPUT_KINDS)}")
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
            if tag not in tags_allowed:
                raise ConfigError(
                    f"{at}: unknown tag {tag!r} — no agent asks for it "
                    f"(known: {', '.join(sorted(tags_allowed))})"
                )
            if tag in by_tag:
                raise ConfigError(f"{at}: tag {tag!r} is already on {by_tag[tag]['id']!r}")
            by_tag[tag] = model
        models.append(model)
    return models, by_tag


def load(name, agent_name, doc=None):
    """One provider, validated, resolved the way `agent_name` needs it."""
    doc = doc or document()
    providers = doc["providers"]
    if name not in providers:
        raise ConfigError(f"{CONFIGS}: no provider named {name!r} (known: {', '.join(providers)})")
    agent = agent_of(doc, agent_name)
    where = f"{CONFIGS}: providers.{name}"
    raw = _object(where, providers[name])
    _check_keys(where, raw, PROVIDER_FIXED_KEYS | set(doc["agents"]))

    base_url = expand(raw.get("BASE_URL") or "").rstrip("/")
    if not base_url:
        raise ConfigError(f"{where}: BASE_URL is required")

    headers = []
    for key, value in _object(f"{where}.REQUEST_HEADERS", raw.get("REQUEST_HEADERS") or {}).items():
        var, fallback = sole_reference(value)
        headers.append({"name": key, "var": var, "fallback": fallback, "value": expand(value)})

    defaults = raw.get("defaults") or {}
    _check_keys(f"{where}.defaults", defaults, MODEL_KEYS - {"id", "claude_id", "tags"})

    # The provider's overrides for this agent, filed under the agent's own name.
    settings_at = f"{where}.{agent_name}"
    settings = _object(settings_at, raw.get(agent_name) or {})
    _check_keys(settings_at, settings, PROVIDER_AGENT_KEYS)

    schema, schema_id, entry = _schema(where, raw, agent)
    models, by_tag = _models(where, raw, defaults, known_tags(doc))

    slots = {}
    for slot, candidates in (agent.get("slots") or {}).items():
        chosen = next((by_tag[tag] for tag in candidates if tag in by_tag), None)
        if chosen is None:
            wanted = " or ".join(repr(c) for c in candidates)
            raise ConfigError(
                f"{where}: nothing is tagged {wanted}, which agents.{agent_name}.slots.{slot} needs"
            )
        slots[slot] = chosen

    model_tag = agent.get("model_tag")
    main_model = by_tag.get(model_tag) if model_tag else None
    if model_tag and main_model is None:
        raise ConfigError(
            f"{where}: no model is tagged {model_tag!r}, which agents.{agent_name}.model_tag needs"
        )
    small_tag = agent.get("small_model_tag")
    small_model = (by_tag.get(small_tag) if small_tag else None) or main_model

    window_slot = agent.get("auto_compact_window_from")
    auto_compact = settings.get("auto_compact_window")
    if not auto_compact and window_slot:
        if window_slot not in slots:
            raise ConfigError(
                f"{CONFIGS}: agents.{agent_name}.auto_compact_window_from names "
                f"{window_slot!r}, which is not one of its slots"
            )
        auto_compact = slots[window_slot]["context_window"]

    env = _object(f"{settings_at}.env", settings.get("env") or {})
    api_key_var, api_key_fallback = sole_reference(raw.get("API_KEY") or "")
    command = settings.get("command") or (
        fill(f"{CONFIGS}: agents.{agent_name}.command", agent["command"], name=name)
        if agent.get("command") else ""
    )
    stale = [
        fill(f"{CONFIGS}: agents.{agent_name}.stale_commands", template, name=name)
        for template in agent.get("stale_commands") or []
    ]
    return {
        "name": name,
        "api_key": expand(raw.get("API_KEY") or ""),
        "api_key_var": api_key_var,
        "api_key_fallback": api_key_fallback,
        "base_url": base_url,
        "headers": headers,
        "command": command,
        "stale_commands": stale,
        "args": settings.get("args", ""),
        "env": {k: str(v) for k, v in env.items()},
        "auto_compact_window": auto_compact,
        "api": agent.get("api", ""),
        "schema": schema,
        "schema_id": schema_id,
        "schema_entry": entry,
        "lean": bool(settings.get("lean", False)),
        "context_window_cap": settings.get("context_window"),
        "max_tokens_cap": settings.get("max_tokens"),
        "models": models,
        "slots": slots,
        "main_model": main_model,
        "small_model": small_model,
    }


def provider_id(config, agent_name):
    """The id the agent files this provider under, or "" when it gets no block."""
    entry = config["schema_entry"]
    if not entry:
        return ""
    return fill(
        f"{CONFIGS}: agents.{agent_name}.schemas.{config['schema']}.id",
        entry["id"], name=config["name"], schema_id=config["schema_id"],
    )


def _render(where, template, fields):
    """The template with its placeholders filled. One whole placeholder keeps its type."""
    if isinstance(template, str):
        whole = PLACEHOLDER.fullmatch(template)
        if whole:
            if whole.group(1) not in fields:
                known = ", ".join("{" + k + "}" for k in fields)
                raise ConfigError(f"{where}: {template} is not one of {known}")
            return fields[whole.group(1)]
        return fill(where, template, **{k: str(v) for k, v in fields.items()})
    if isinstance(template, dict):
        return {_render(where, k, fields): _render(where, v, fields) for k, v in template.items()}
    if isinstance(template, list):
        return [_render(where, v, fields) for v in template]
    return template


def models_json(config, agent, agent_name):
    """Every model as the agent's "model_entry" describes it, indented to fit.

    An agent compacts a session once it fills the context, so a provider's cap is
    the window a conversation may grow into — not the endpoint's capacity.
    """
    entry = agent.get("model_entry")
    if not entry:
        return ""
    where = f"{CONFIGS}: agents.{agent_name}.model_entry"
    pad = " " * int(entry.get("indent", 0))
    inline = bool(entry.get("inline"))
    keyed_by = entry.get("keyed_by")
    rendered = []
    for model in config["models"]:
        fields = dict(model)
        fields["context_window"] = config["context_window_cap"] or model["context_window"]
        fields["max_tokens"] = config["max_tokens_cap"] or model["max_tokens"]
        value = _render(f"{where}.value", entry["value"], fields)
        text = json.dumps(value, indent=None if inline else 2, ensure_ascii=False)
        text = "\n".join(pad + line for line in text.splitlines())
        if keyed_by:
            key = json.dumps(_render(f"{where}.keyed_by", keyed_by, fields), ensure_ascii=False)
            text = f"{pad}{key}: {text.lstrip()}" if inline else f"{pad}{key}: {text.lstrip()}"
        rendered.append(text)
    return ",\n".join(rendered)


def shell(config, agent, agent_name):
    entry = config["schema_entry"] or {}
    base_url_template = entry.get("base_url") if entry else ""
    values = {
        "M_NAME": config["name"],
        "M_AGENT": agent_name,
        "M_COMMAND": config["command"],
        "M_STALE_COMMANDS": " ".join(config["stale_commands"]),
        "M_API_KEY": config["api_key"],
        "M_API_KEY_VAR": config["api_key_var"],
        "M_API_KEY_FALLBACK": config["api_key_fallback"],
        "M_BASE_URL": config["base_url"],
        "M_API": config["api"],
        # One header per line: name, the variable it came from (empty when the
        # value is a literal), that variable's fallback, then the value. The
        # fields are separated by US (\x1f), not a tab: bash collapses runs of
        # IFS whitespace into one delimiter, so an empty field between two tabs
        # would shift every field after it.
        "M_HEADERS": "\n".join(
            "\x1f".join((h["name"], h["var"], h["fallback"], h["value"])) for h in config["headers"]
        ),
        "M_ARGS": config["args"],
        "M_ENV_SH": "\n".join(
            f"export {key}={shlex.quote(value)}" for key, value in sorted(config["env"].items())
        ),
        "M_AUTO_COMPACT_WINDOW": str(config["auto_compact_window"] or ""),
        "M_SCHEMA_RESOLVE": config["schema"],
        "M_PROVIDER_ID": provider_id(config, agent_name),
        "M_NPM": entry.get("npm", ""),
        "M_SDK_BASE_URL": fill(
            f"{CONFIGS}: agents.{agent_name}.schemas.{config['schema']}.base_url",
            base_url_template, name=config["name"], base_url=config["base_url"],
        ) if base_url_template else "",
        "M_DECLARE_MODELS": "true" if entry.get("declare_models") else "false",
        "M_LEAN": "true" if config["lean"] else "false",
        "M_MAIN_MODEL": config["main_model"]["id"] if config["main_model"] else "",
        "M_SMALL_MODEL": config["small_model"]["id"] if config["small_model"] else "",
        "M_MODELS_JSON": models_json(config, agent, agent_name),
        "M_MODEL_IDS": " ".join(model["id"] for model in config["models"]),
        "M_SLOT_NAMES": " ".join(config["slots"]),
    }
    for slot, model in config["slots"].items():
        values[f"M_SLOT_{slot}"] = model["claude_id"]
    return "\n".join(f"{key}={shlex.quote(value)}" for key, value in values.items())


def settings(doc, agent_name):
    """The config-wide values a generator needs before it looks at any provider."""
    agent = agent_of(doc, agent_name)
    lean = agent.get("lean") or {}
    launch = agent.get("launch") or {}
    packages = agent.get("packages") or {}
    values = {
        "S_START_PROVIDER": doc["start_provider"],
        "S_EXEC": launch.get("exec") or agent_name,
        "S_COMMAND_TEMPLATE": agent.get("command", ""),
        "S_INSTALL_URL": agent.get("install_url", ""),
        "S_GENERATOR": agent.get("generator", ""),
        "S_TOKEN_VAR": launch.get("token_var", ""),
        "S_BASE_URL_VAR": launch.get("base_url_var", ""),
        "S_HEADERS_VAR": launch.get("headers_var", ""),
        "S_AUTO_COMPACT_WINDOW_VAR": launch.get("auto_compact_window_var", ""),
        "S_UNSET_VARS": " ".join(launch.get("unset_vars") or []),
        "S_TOKEN_VARS": " ".join(
            ([launch["token_var"]] if launch.get("token_var") else [])
            + list(launch.get("token_var_aliases") or [])
        ),
        "S_HEADERS_VARS": " ".join(
            ([launch["headers_var"]] if launch.get("headers_var") else [])
            + list(launch.get("headers_var_aliases") or [])
        ),
        "S_MODEL_TAG": agent.get("model_tag", ""),
        "S_SMALL_MODEL_TAG": agent.get("small_model_tag", ""),
        "S_API": agent.get("api", ""),
        "S_LEAN_PROMPT": lean.get("prompt", ""),
        "S_LEAN_DISABLED_TOOLS": " ".join(lean.get("disabled_tools") or []),
        "S_PACKAGES": " ".join(f"{source}={command}" for source, command in packages.items()),
        "S_SCHEMAS": " ".join(agent.get("schemas") or {}),
    }
    return "\n".join(f"{key}={shlex.quote(value)}" for key, value in values.items())


def check(doc):
    """Every provider against every agent, and the ids each agent would file them under."""
    for name, raw in doc["providers"].items():
        declared = (raw.get("schema") or {}).get("id")
        if not declared:
            continue
        resolve = raw["schema"].get("resolve")
        wanted = any(
            "{schema_id}" in ((agent.get("schemas") or {}).get(resolve) or {}).get("id", "")
            for agent in doc["agents"].values()
        )
        if not wanted:
            raise ConfigError(
                f"providers.{name}.schema: id is set, but no agent's "
                f"schemas.{resolve} uses it"
            )
    for agent_name in doc["agents"]:
        taken = {}
        for name in doc["providers"]:
            config = load(name, agent_name, doc)
            filed = provider_id(config, agent_name)
            if not filed:
                continue
            if filed in taken:
                raise ConfigError(
                    f"providers.{name}: {agent_name} id {filed!r} is already "
                    f"taken by providers.{taken[filed]}"
                )
            taken[filed] = name


# Words a provider may be named that cannot be searched for: they are ordinary
# shell or English, and every file says them for unrelated reasons.
UNSEARCHABLE = {"local", "default", "small", "main", "command", "name", "exec"}


def vocabulary(doc):
    """Every concrete name configs.jsonc owns — what no other file may contain.

    Built from the file itself, so adding a provider or renaming a variable
    changes what the style check forbids without touching the check.
    """
    words = set(doc["providers"])
    for agent_name, agent in doc["agents"].items():
        launch = agent.get("launch") or {}
        words.update(
            v for k, v in launch.items() if isinstance(v, str) and k != "exec"
        )
        for key in ("unset_vars", "token_var_aliases"):
            words.update(launch.get(key) or [])
        words.update(agent.get("slots") or {})
        words.update(agent.get("packages") or {})
        if agent.get("api"):
            words.add(agent["api"])
        for entry in (agent.get("schemas") or {}).values():
            if entry and entry.get("npm"):
                words.add(entry["npm"])
        for name in doc["providers"]:
            config = load(name, agent_name, doc)
            words.update(m["id"] for m in config["models"])
            words.update(m["claude_id"] for m in config["models"])
            filed = provider_id(config, agent_name)
            if filed and filed != name:
                words.add(filed)
    # Role tags and agent names are deliberately generic ("default", "small"):
    # they name a slot, not a vendor, and every file may say them.
    generic = known_tags(doc) | set(doc["agents"]) | UNSEARCHABLE
    # A name shorter than this cannot be searched for without matching prose.
    return "\n".join(sorted(w for w in words - generic if len(w) >= 4))


def env_vars(doc):
    """Every reference in the file, as "<provider><tab><var><tab><what><tab><fallback>".

    A reference with a fallback is optional: the file already works without it.
    """
    lines = []
    for name, raw in doc["providers"].items():
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
    first = argv[2] if len(argv) > 2 else ""
    second = argv[3] if len(argv) > 3 else ""
    if action not in (
        "sh", "settings", "check", "tags", "providers", "agents", "env-vars", "vocabulary",
    ):
        print(__doc__.strip(), file=sys.stderr)
        return 2
    try:
        doc = document()
        if action == "providers":
            print("\n".join(doc["providers"]))
        elif action == "agents":
            print("\n".join(doc["agents"]))
        elif action == "env-vars":
            print(env_vars(doc))
        elif action == "vocabulary":
            print(vocabulary(doc))
        elif action == "check":
            check(doc)
        elif action == "settings":
            if not first:
                print("models.py settings: an agent name is required", file=sys.stderr)
                return 2
            print(settings(doc, first))
        elif action == "tags":
            if not first:
                print("models.py tags: a provider name is required", file=sys.stderr)
                return 2
            config = load(first, second or next(iter(doc["agents"])), doc)
            print("\n".join(f"{m['id']}\t{','.join(m['tags'])}" for m in config["models"]))
        elif action == "sh":
            if not first or not second:
                print("models.py sh: a provider and an agent name are required", file=sys.stderr)
                return 2
            print(shell(load(first, second, doc), agent_of(doc, second), second))
    except ConfigError as exc:
        print(f"configs.jsonc: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
