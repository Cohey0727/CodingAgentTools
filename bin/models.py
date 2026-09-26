#!/usr/bin/env python3
"""Resolve configs.jsonc into the values every agent CLI this repo writes for needs.

configs.jsonc at the repo root holds every provider, grouped by the heading it
sits under in OpenCode's model dialog: its endpoint, the API each model is
spoken to over, the models it serves, and the tags that say which slot each
model fills. In any string, "${NAME}" is read from the environment and
"${NAME:-fallback}" falls back to the text after ":-" when NAME is unset or
empty — the shell's own syntax. The .env beside it holds those values, so the
file carries references to secrets rather than secrets, and an endpoint can ship
a default that .env overrides.

A provider whose models speak more than one API is registered once per API: a
route is a provider narrowed to the models of one API. pi alone takes the API
per model, so it gets the whole provider as one entry.

The file is JSON with // line comments allowed.

  models.py sh <provider> [<api>]  shell assignments (M_-prefixed) for eval,
                                   narrowed to one route when <api> is given
  models.py check [<provider>]  validate, print nothing on success
  models.py tags <provider>     "<id><tab><tag>,<tag>" per model
  models.py providers           one provider name per line
  models.py primary             the provider marked "primary", if any
  models.py opencode-merge      the OpenCode config on stdin, opencode.overrides merged in
  models.py pi-merge            pi's settings.json on stdin, pi.overrides merged in
  models.py vocabulary          every concrete name no file but configs.jsonc may hold
  models.py env-vars            every "${NAME}" the file references, with its provider
"""

import json
import os
import re
import shlex
import sys
from pathlib import Path

CONFIGS = Path(__file__).resolve().parent.parent / "configs.jsonc"

ROLE_TAGS = ("default", "small")

# "anthropic" is POST <BASE_URL>/v1/messages, "openai" POST <BASE_URL>/v1/chat/completions.
APIS = ("anthropic", "openai")

# pi's name for each API, and what it needs after BASE_URL: its Anthropic client
# appends /v1/messages itself, its OpenAI one only /chat/completions.
PI_APIS = {"anthropic": ("anthropic-messages", ""), "openai": ("openai-completions", "/v1")}

MODEL_KEYS = {"id", "api", "tags", "context_window", "max_tokens", "reasoning", "input"}
PROVIDER_KEYS = {"label", "API_KEY", "BASE_URL", "REQUEST_HEADERS", "api", "catalog", "primary", "picker", "defaults", "opencode", "models"}
OPENCODE_KEYS = {"lean", "context_window", "max_tokens"}
AGENT_ROOT_KEYS = {"overrides"}

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


def _api(where, value):
    if value not in APIS:
        raise ConfigError(f"{where}: api must be one of {', '.join(APIS)}, got {value!r}")
    return value


def load_root():
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
    return raw


def sections():
    """provider name -> (heading, its raw entry), in file order.

    configs.jsonc nests providers under the heading they share in OpenCode's
    model dialog; everything but that dialog only needs the name.
    """
    found = {}
    for heading, group in load_root()["providers"].items():
        where = f"{CONFIGS}: providers.{heading}"
        if not isinstance(group, dict) or not group:
            raise ConfigError(f"{where}: must be a non-empty object of providers")
        for name, raw in group.items():
            if name in found:
                raise ConfigError(f"{where}.{name}: the name is already a provider under {found[name][0]!r}")
            found[name] = (heading, raw)
    return found


def load_file():
    return {name: raw for name, (_, raw) in sections().items()}


def agent_overrides(agent):
    """The top-level <agent>.overrides, laid over that agent's generated config last."""
    where = f"{CONFIGS}: {agent}"
    raw = load_root().get(agent) or {}
    if not isinstance(raw, dict):
        raise ConfigError(f"{where}: must be an object")
    _check_keys(where, raw, AGENT_ROOT_KEYS)
    overrides = raw.get("overrides") or {}
    if not isinstance(overrides, dict):
        raise ConfigError(f"{where}: overrides must be an object")
    return overrides


def deep_merge(base, overrides):
    """base with overrides laid over it: objects merge key by key, anything else is replaced."""
    merged = dict(base)
    for key, value in overrides.items():
        if isinstance(value, dict) and isinstance(merged.get(key), dict):
            merged[key] = deep_merge(merged[key], value)
        else:
            merged[key] = value
    return merged


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
    providers = sections()
    if name not in providers:
        known = ", ".join(providers)
        raise ConfigError(f"{CONFIGS}: no provider named {name!r} (known: {known})")
    heading, raw = providers[name]
    where = f"{CONFIGS}: providers.{heading}.{name}"
    if not isinstance(raw, dict):
        raise ConfigError(f"{where}: must be an object")
    _check_keys(where, raw, PROVIDER_KEYS)

    label = raw.get("label", "")
    if not isinstance(label, str):
        raise ConfigError(f"{where}: label must be a string")

    picker = raw.get("picker", True)
    if not isinstance(picker, bool):
        raise ConfigError(f"{where}: picker must be a boolean")

    base_url = expand(raw.get("BASE_URL") or "").rstrip("/")
    if not base_url:
        raise ConfigError(f"{where}: BASE_URL is required")

    api = _api(where, expand(raw.get("api") or ""))

    catalog = expand(raw.get("catalog") or "")
    if catalog and not catalog.startswith("/"):
        raise ConfigError(f'{where}: catalog must be a path beginning with "/"')

    headers_raw = raw.get("REQUEST_HEADERS") or {}
    if not isinstance(headers_raw, dict):
        raise ConfigError(f"{where}: REQUEST_HEADERS must be an object")
    headers = []
    for key, value in headers_raw.items():
        var, fallback = sole_reference(value)
        headers.append({"name": key, "var": var, "fallback": fallback, "value": expand(value)})

    defaults = raw.get("defaults") or {}
    _check_keys(f"{where}.defaults", defaults, MODEL_KEYS - {"id", "api", "tags"})
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
            "api": _api(at, merged.get("api", api)),
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

    api_key_var, api_key_fallback = sole_reference(raw.get("API_KEY") or "")
    return {
        "name": name,
        "section": heading,
        "label": label,
        "picker": picker,
        "api_key": expand(raw.get("API_KEY") or ""),
        "api_key_var": api_key_var,
        "api_key_fallback": api_key_fallback,
        "base_url": base_url,
        "catalog": catalog,
        "headers": headers,
        "lean": bool(opencode.get("lean", False)),
        "opencode_context_window": opencode.get("context_window"),
        "opencode_max_tokens": opencode.get("max_tokens"),
        "models": models,
        "apis": list(dict.fromkeys(model["api"] for model in models)),
        "default_model": by_tag["default"],
        "small_model": by_tag.get("small", by_tag["default"]),
    }


def route_models(config, api):
    """The provider's models, or only those spoken to over api when one is given."""
    if not api:
        return config["models"]
    if api not in config["apis"]:
        raise ConfigError(
            f"{CONFIGS}: provider {config['name']!r} has no {api!r} model"
            f" (its apis: {', '.join(config['apis'])})"
        )
    return [model for model in config["models"] if model["api"] == api]


def pi_id(config):
    """The id pi files a provider under, which /model prints beside each model.

    It is the label OpenCode's dialog puts before the provider's models, or the
    name when there is none. pi merges an entry into its built-in provider of the
    same id, so an unlabeled name must not be one of pi's.
    """
    return config["label"] or config["name"]


def pi_models_json(config, models):
    """The "models" array body of a pi models.json provider block, indented to fit."""
    return ",\n".join(
        "        {\n"
        f'          "id": "{model["id"]}",\n'
        f'          "api": "{PI_APIS[model["api"]][0]}",\n'
        f'          "baseUrl": "{config["base_url"]}{PI_APIS[model["api"]][1]}",\n'
        f'          "reasoning": {"true" if model["reasoning"] else "false"},\n'
        f'          "input": {json.dumps(model["input"])},\n'
        f'          "contextWindow": {model["context_window"]},\n'
        f'          "maxTokens": {model["max_tokens"]}\n'
        "        }"
        for model in models
    )


def opencode_models_json(config, models):
    """The "models" object body of an OpenCode provider block, indented to fit.

    A provider's heading is shared by every provider in its section, so a model's
    display name leads with the provider's label when it has one. OpenCode
    compacts a session once it fills the context, so opencode.context_window caps
    the window a conversation may grow into — not the endpoint's capacity.
    """
    context_cap = config["opencode_context_window"]
    output_cap = config["opencode_max_tokens"]
    prefix = f"{config['label']} " if config["label"] else ""
    return ",\n".join(
        f'        "{model["id"]}": {{'
        f' "name": {json.dumps(prefix + model["id"], ensure_ascii=False)},'
        f' "limit": {{ "context": {context_cap or model["context_window"]},'
        f' "output": {output_cap or model["max_tokens"]} }} }}'
        for model in models
    )


def model_rows(models):
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
        for model in models
    )


def shell(config, api=""):
    models = route_models(config, api)
    values = {
        "M_NAME": config["name"],
        "M_SECTION": config["section"],
        "M_LABEL": config["label"],
        "M_API_KEY": config["api_key"],
        "M_API_KEY_VAR": config["api_key_var"],
        "M_API_KEY_FALLBACK": config["api_key_fallback"],
        "M_BASE_URL": config["base_url"],
        "M_CATALOG": config["catalog"],
        # One header per line: name, the variable it came from (empty when the
        # value is a literal), that variable's fallback, then the value. The
        # fields are separated by US (\x1f), not a tab: bash collapses runs of
        # IFS whitespace into one delimiter, so an empty field between two tabs
        # would shift every field after it.
        "M_HEADERS": "\n".join(
            "\x1f".join((h["name"], h["var"], h["fallback"], h["value"])) for h in config["headers"]
        ),
        "M_APIS": " ".join(config["apis"]),
        "M_API": api,
        "M_DEFAULT_MODEL": config["default_model"]["id"],
        "M_DEFAULT_API": config["default_model"]["api"],
        "M_SMALL_MODEL": config["small_model"]["id"],
        "M_SMALL_API": config["small_model"]["api"],
        "M_OPENCODE_LEAN": "true" if config["lean"] else "false",
        "M_PICKER": "true" if config["picker"] else "false",
        "M_OPENCODE_MODELS_JSON": opencode_models_json(config, models),
        "M_PI_ID": pi_id(config),
        "M_PI_MODELS_JSON": pi_models_json(config, models),
        "M_MODEL_ROWS": model_rows(models),
    }
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
        words.add(config["base_url"])
        words.update(f"{name}-{api}" for api in config["apis"])
    # A name shorter than this cannot be searched for without matching prose.
    return "\n".join(sorted(w for w in words if len(w) >= 4 and w != "default"))


def env_vars():
    """Every reference in the file, as "<provider><tab><var><tab><what><tab><fallback>".

    A reference with a fallback is optional: the file already works without it.
    """
    lines = []
    for name, raw in load_file().items():
        fields = [
            ("API_KEY", raw.get("API_KEY") or ""),
            ("BASE_URL", raw.get("BASE_URL") or ""),
            ("api", raw.get("api") or ""),
        ]
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
    api = argv[3] if len(argv) > 3 else ""
    if action not in ("sh", "check", "tags", "providers", "env-vars", "primary", "opencode-merge", "pi-merge", "vocabulary"):
        print(__doc__.strip(), file=sys.stderr)
        return 2
    try:
        if action == "providers":
            print("\n".join(load_file()))
        elif action == "primary":
            print(primary_provider())
        elif action in ("opencode-merge", "pi-merge"):
            config = json.loads(strip_comments(sys.stdin.read()) or "{}")
            merged = deep_merge(config, agent_overrides(action.removesuffix("-merge")))
            print(json.dumps(merged, indent=2, ensure_ascii=False))
        elif action == "vocabulary":
            print(vocabulary())
        elif action == "env-vars":
            print(env_vars())
        elif action == "check" and not argument:
            pi_ids = {}
            for name in load_file():
                config = load(name)
                taken = pi_ids.setdefault(pi_id(config), name)
                if taken != name:
                    raise ConfigError(
                        f"{CONFIGS}: {taken!r} and {name!r} would both be {pi_id(config)!r} in pi"
                        " — give one a label of its own"
                    )
            primary_provider()
            agent_overrides("opencode")
            agent_overrides("pi")
        elif not argument:
            print(f"models.py {action}: a provider name is required", file=sys.stderr)
            return 2
        else:
            config = load(argument)
            if action == "sh":
                print(shell(config, api))
            elif action == "tags":
                print("\n".join(f"{m['id']}\t{','.join(m['tags'])}" for m in config["models"]))
    except ConfigError as exc:
        print(f"configs.jsonc: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
