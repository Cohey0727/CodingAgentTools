#!/usr/bin/env python3
"""Rewrite one provider's models in configs.jsonc from the catalog it names.

bin/models-update.sh fetches GET <BASE_URL><catalog> for every provider that
declares one and pipes the answer here with the provider's name. Only that
provider's "models" array is rewritten, in place; every other byte of the file
stands, comments included. Models keep the order the catalog lists them in and
the tags they already had — tags say where CLIs start, which a catalog cannot
know. A model gone from the catalog is dropped, unless it carries a tag: that
aborts the provider, because dropping it would silently move every CLI's start.

The catalog speaks the shape of OpenAI's GET /v1/models: a "data" array whose
members carry "id", "context_length" and "supported_endpoints". The api each
model gets: "/messages" means anthropic and "/chat/completions" means openai;
a model offering neither, say only OpenAI's /responses, is skipped with a
warning because no CLI here speaks it.

  models-update.py <provider>   the catalog JSON on stdin
"""

import json
import os
import sys

from models import CONFIGS, ConfigError, expand, load, sections, strip_comments

# The fields the rewritten line is built from, in the order they are written.
# Anything else an entry carries — an explicit max_tokens, say — follows them.
CANONICAL = ("id", "api", "context_window", "tags")


class UpdateError(Exception):
    pass


def catalog_models(payload):
    """(id, api, context_length) per catalog entry, in the catalog's order."""
    if not isinstance(payload, dict) or not isinstance(payload.get("data"), list):
        raise UpdateError('expected {"data": [...]} (OpenAI /v1/models shape)')
    found = []
    seen = set()
    for entry in payload["data"]:
        if not isinstance(entry, dict):
            raise UpdateError('every member of "data" must be an object')
        model_id = entry.get("id")
        if not isinstance(model_id, str) or not model_id:
            raise UpdateError(f"{entry!r} carries no id")
        if model_id in seen:
            print(f"catalog: {model_id} appears twice; the first stands", file=sys.stderr)
            continue
        seen.add(model_id)
        endpoints = entry.get("supported_endpoints") or []
        if "/messages" in endpoints:
            api = "anthropic"
        elif "/chat/completions" in endpoints:
            api = "openai"
        else:
            speaks = ", ".join(endpoints) or "nothing this repo speaks"
            print(f"catalog: skipping {model_id} — speaks only {speaks}", file=sys.stderr)
            continue
        context = entry.get("context_length")
        if isinstance(context, bool) or not isinstance(context, int) or context <= 0:
            raise UpdateError(f"{model_id} carries no usable context_length")
        found.append((model_id, api, context))
    if not found:
        raise UpdateError("no model this repo can speak")
    return found


def build_entry(raw, model_id, api, context, default_api):
    """The fields of one rewritten model line, in written order.

    A model already in the file keeps its tags, and "api" is written only where
    it differs from the provider's own.
    """
    raw = raw or {}
    entry = {"id": model_id}
    if api != default_api:
        entry["api"] = api
    entry["context_window"] = context
    if raw.get("tags"):
        entry["tags"] = raw["tags"]
    for key, value in raw.items():
        if key not in CANONICAL:
            entry[key] = value
    return entry


def find_array_span(text, keys):
    """The [start, end) span of the array at object-key path <keys> in raw JSONC.

    Walks the text the way models.strip_comments does — strings with escapes
    and // comments skipped — so the span found is the one written, not one a
    string literal or a comment pretends to be.
    """
    n = len(text)

    def skip_blank(i):
        while i < n:
            if text[i] in " \t\r\n":
                i += 1
            elif text[i : i + 2] == "//":
                newline = text.find("\n", i)
                i = n if newline < 0 else newline + 1
            else:
                break
        return i

    def string_end(i):
        # text[i] is the opening quote; returns just past the closing one.
        i += 1
        while i < n:
            if text[i] == "\\":
                i += 2
            elif text[i] == '"':
                return i + 1
            else:
                i += 1
        raise UpdateError("configs.jsonc: unterminated string")

    found = []

    def value(i, path):
        i = skip_blank(i)
        if i >= n:
            raise UpdateError("configs.jsonc: unexpected end of file")
        char = text[i]
        if char == "{":
            i += 1
            while True:
                i = skip_blank(i)
                if text[i] == "}":
                    return i + 1
                end = string_end(i)
                key = json.loads(text[i:end])
                i = skip_blank(end)
                if text[i] != ":":
                    raise UpdateError("configs.jsonc: expected ':' after a key")
                i = value(i + 1, [*path, key])
                i = skip_blank(i)
                if text[i] == ",":
                    i += 1
        if char == "[":
            start = i
            i += 1
            index = 0
            while True:
                i = skip_blank(i)
                if text[i] == "]":
                    if path == list(keys):
                        found.append((start, i + 1))
                    return i + 1
                i = value(i, [*path, index])
                index += 1
                i = skip_blank(i)
                if text[i] == ",":
                    i += 1
        if char == '"':
            return string_end(i)
        while i < n and text[i] not in ",}] \t\r\n":
            i += 1
        return i

    value(0, [])
    if not found:
        raise UpdateError(f"no array at {' -> '.join(map(str, keys))}")
    return found[0]


def rewritten_text(text, span, entries):
    """The file with the models array at <span> replaced by <entries>."""
    start, end = span
    line_start = text.rfind("\n", 0, start) + 1
    prefix = text[line_start:start]
    indent = prefix[: len(prefix) - len(prefix.lstrip())]
    lines = ",\n".join(
        indent + "  { " + ", ".join(
            f"{json.dumps(key, ensure_ascii=False)}: {json.dumps(value, ensure_ascii=False)}"
            for key, value in entry.items()
        ) + " }"
        for entry in entries
    )
    return text[:start] + "[\n" + lines + "\n" + indent + "]" + text[end:]


def main(argv):
    if len(argv) != 2:
        print(__doc__.strip(), file=sys.stderr)
        return 2
    name = argv[1]
    try:
        payload = json.loads(sys.stdin.read())
    except json.JSONDecodeError as exc:
        print(f"catalog: invalid JSON — {exc}", file=sys.stderr)
        return 1
    try:
        providers = sections()
        if name not in providers:
            raise UpdateError(f"no provider named {name!r}")
        heading, raw = providers[name]
        default_api = expand(raw.get("api") or "")
        resolved = {model["id"]: model for model in load(name)["models"]}
        raw_entries = {entry.get("id"): entry for entry in raw["models"]}

        entries = []
        added, updated = [], []
        catalog = catalog_models(payload)
        for model_id, api, context in catalog:
            old = resolved.get(model_id)
            if old is None:
                added.append(model_id)
            elif old["context_window"] != context or old["api"] != api:
                changes = []
                if old["context_window"] != context:
                    changes.append(f"context_window {old['context_window']} -> {context}")
                if old["api"] != api:
                    changes.append(f"api {old['api']} -> {api}")
                updated.append(f"{model_id}: {', '.join(changes)}")
            entries.append(build_entry(raw_entries.get(model_id), model_id, api, context, default_api))

        in_catalog = {model_id for model_id, _, _ in catalog}
        dropped = [model_id for model_id in resolved if model_id not in in_catalog]
        tagged = [(tag, model_id) for model_id in dropped for tag in resolved[model_id]["tags"]]
        if tagged:
            print(f"update: {name} keeps no tag — these are gone from the catalog:", file=sys.stderr)
            for tag, model_id in tagged:
                print(f"  {tag}: {model_id}", file=sys.stderr)
            print("Re-tag another model in configs.jsonc, then re-run make update.", file=sys.stderr)
            return 1

        if not (added or dropped or updated):
            print(f"{name}: up to date ({len(entries)} models)")
            return 0

        text = CONFIGS.read_text()
        span = find_array_span(text, ["providers", heading, name, "models"])
        written = rewritten_text(text, span, entries)
        # The surgery is only trusted once the file it produces parses back to
        # the same model list that was meant to be written.
        parsed = json.loads(strip_comments(written))["providers"][heading][name]["models"]
        if parsed != entries:
            raise UpdateError("the rewritten file would not parse back to the new models; nothing written")
        tmp = str(CONFIGS) + ".tmp"
        with open(tmp, "w") as f:
            f.write(written)
        os.replace(tmp, CONFIGS)

        print(f"{name}: {len(added)} added, {len(dropped)} dropped, {len(updated)} updated")
        for model_id in added:
            print(f"  + {model_id}")
        for model_id in dropped:
            print(f"  - {model_id}")
        for line in updated:
            print(f"  ~ {line}")
        print("  now re-run the config generators: make pi-global opencode-global"
              " crush-global reasonix-global codewhale-global dsh-global")
        return 0
    except (UpdateError, ConfigError) as exc:
        print(f"update: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
