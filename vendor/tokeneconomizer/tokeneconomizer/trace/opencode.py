"""opencode (anomalyco/opencode) 2.x: sessions stored as rows of one SQLite database.

opencode keeps every session in `<data dir>/opencode.db`: a `session_v2` row per session
(`parent_id` set on a subagent's), and a `session_message` row per message, ordered by `seq`,
whose `type` names it (`user`, `assistant`, `synthetic`, `system`, `compaction`, ...) and whose
`data` is its JSON. An `assistant` row is one model step: `content` holds `text`, `reasoning`
and `tool` items -- a tool item is `{id, name, state: {status, input, content, metadata,
error}}`, the result in the same item as the call -- and the step carries its own `tokens` and
`cost`. A shell call's exit code is `state.metadata.exit`. Read on 2.1.4 and 2.2.0.

The database is opencode's, written while it runs, and its shape is not a published format, so
the plugin copies a session out (`opencode_dump_session`) -- at its start, at each turn's end,
and again when it is folded (`opencode_refresh`) -- and every other reader works on that copy: a
JSONL file of `session` lines (the session's row and its subagents') and `message` lines
(`{session_id, kind, seq, data}`). `opencode_session_to_claude` writes the main session's calls
as the Claude Code envelope the other readers already handle.

Usage: `tokens.input` excludes the cache, and `output` excludes `reasoning` (opencode's total is
the sum of all five), so the ledger's output is `output + reasoning`.
"""
import json
import os
import re
import sqlite3

from .jsonl import records

_PATCH_FILE_RE = re.compile(r"^\*\*\* (?:Update|Add|Delete) File:\s*(.+?)\s*$", re.M)
_SESSION_COLUMNS = ("id", "parent_id", "directory", "title", "version")


def opencode_db_path(env=None):
    """opencode's database: `OPENCODE_DB` (a path, or a name in the data directory), else
    `<XDG_DATA_HOME or ~/.local/share>/opencode/opencode.db`; None for an in-memory one."""
    env = os.environ if env is None else env
    data = os.path.join(env.get("XDG_DATA_HOME") or os.path.join(
        os.path.expanduser("~"), ".local", "share"), "opencode")
    name = (env.get("OPENCODE_DB") or "").strip()
    if name == ":memory:":
        return None
    if name:
        return name if os.path.isabs(name) else os.path.join(data, name)
    return os.path.join(data, "opencode.db")


def opencode_dump_session(session_id, out_path, db_path=None):
    """Copy a session, and the subagent sessions under it, out of opencode's database into
    `out_path`. Returns the number of message rows written; None when the database or the
    session is not there (the previous copy, if any, is left as it was)."""
    db_path = db_path or opencode_db_path()
    if not db_path or not os.path.exists(db_path) or not session_id:
        return None
    con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True, timeout=5)
    try:
        sessions = con.execute(
            "WITH RECURSIVE tree(id) AS (SELECT id FROM session_v2 WHERE id = ? "
            "UNION SELECT s.id FROM session_v2 s JOIN tree t ON s.parent_id = t.id) "
            f"SELECT {', '.join('s.' + c for c in _SESSION_COLUMNS)} "
            "FROM session_v2 s JOIN tree t ON s.id = t.id", (session_id,)).fetchall()
        if not sessions:
            return None
        ids = [row[0] for row in sessions]
        rows = con.execute(
            f"SELECT session_id, type, seq, data FROM session_message WHERE session_id IN "
            f"({', '.join('?' * len(ids))}) ORDER BY session_id = ? DESC, session_id, seq",
            (*ids, session_id)).fetchall()
    finally:
        con.close()
    os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
    tmp = f"{out_path}.tmp"
    with open(tmp, "w", encoding="utf-8") as out:
        # The session asked for first: its line is the header the readers take the cwd from.
        for row in sorted(sessions, key=lambda r: r[0] != session_id):
            out.write(json.dumps(dict(zip(_SESSION_COLUMNS, row), type="session")) + "\n")
        for sid, kind, seq, data in rows:
            try:
                data = json.loads(data)
            except ValueError:
                continue
            out.write(json.dumps({"type": "message", "session_id": sid, "kind": kind,
                                  "seq": seq, "data": data}) + "\n")
    os.replace(tmp, out_path)
    return len(rows)


def opencode_refresh(path, db_path=None):
    """Copy again the session a copy holds (its header names it); None when it cannot be."""
    head = next(records(path), {}) if path and os.path.exists(path) else {}
    if head.get("type") != "session" or not head.get("id"):
        return None
    return opencode_dump_session(head["id"], path, db_path=db_path)


def _entries(path):
    """(main session row, [message rows of the main session], [message rows of all])."""
    head, mine, every = {}, [], []
    for ev in records(path):
        if ev.get("type") == "session" and not head:
            head = ev
        elif ev.get("type") == "message" and isinstance(ev.get("data"), dict):
            every.append(ev)
            if ev.get("session_id") == head.get("id"):
                mine.append(ev)
    return head, mine, every


def _text(content):
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "\n".join(c.get("text", "") for c in content
                         if isinstance(c, dict) and c.get("type") == "text")
    return ""


def opencode_tool(name, args):
    """An opencode call in the names the mechanisms read: `shell` is `bash` with its
    `command`, and a `patch` is `apply_patch` with the files it touches (as on Codex)."""
    args = args if isinstance(args, dict) else {}
    if name == "shell":
        return "bash", dict(args, command=str(args.get("command") or ""))
    if name == "patch":
        paths = _PATCH_FILE_RE.findall(str(args.get("patchText") or ""))
        return "apply_patch", {"path": paths[0] if paths else "", "paths": paths}
    return name, args


def _result(state):
    """(text, ok) of a tool item's state: an error, or a non-zero exit, is a failure."""
    if state.get("status") == "error":
        err = state.get("error") or {}
        return str(err.get("message") if isinstance(err, dict) else err or ""), False
    meta = state.get("metadata") if isinstance(state.get("metadata"), dict) else {}
    code = meta.get("exit")
    text = _text(state.get("content"))
    if isinstance(code, int) and not isinstance(code, bool) and code != 0:
        return f"{text}\nExit code {code}".strip(), False
    return text, True


def opencode_session_to_claude(path, out_path):
    """Write the main session of a copy as Claude Code transcript lines, every call in the
    session's directory. Returns the number of tool calls written, or None when the copy is
    missing."""
    if not path or not os.path.exists(path):
        return None
    head, mine, _ = _entries(path)
    cwd = head.get("directory") if isinstance(head.get("directory"), str) else None
    n = 0
    with open(out_path, "w", encoding="utf-8") as out:
        for ev in mine:
            kind, data = ev.get("kind"), ev["data"]
            if kind == "user":
                out.write(json.dumps({"type": "user", "message": {
                    "role": "user", "content": str(data.get("text") or "")}}) + "\n")
            elif kind == "assistant":
                blocks, results = [], []
                for item in data.get("content") or []:
                    if not isinstance(item, dict):
                        continue
                    if item.get("type") == "text":
                        blocks.append({"type": "text", "text": item.get("text", "")})
                    elif item.get("type") == "tool":
                        state = item.get("state") if isinstance(item.get("state"), dict) else {}
                        name, args = opencode_tool(item.get("name"), state.get("input"))
                        blocks.append({"type": "tool_use", "id": item.get("id"), "name": name,
                                       "input": args})
                        text, ok = _result(state)
                        results.append({"type": "tool_result", "tool_use_id": item.get("id"),
                                        "content": text, "is_error": not ok})
                        n += 1
                msg = {"id": f"{ev.get('session_id')}:{ev.get('seq')}", "role": "assistant",
                       "content": blocks, "model": (data.get("model") or {}).get("id")}
                usage = _usage(data.get("tokens"))
                if usage:
                    msg["usage"] = usage
                out.write(json.dumps(dict({"type": "assistant", "message": msg},
                                          **({"cwd": cwd} if cwd else {}))) + "\n")
                if results:
                    out.write(json.dumps({"type": "user", "message": {
                        "role": "user", "content": results}}) + "\n")
    return n


def opencode_prompt_count(path):
    """How many prompts the person gave the main session: its `user` messages."""
    return sum(1 for ev in _entries(path)[1] if ev.get("kind") == "user")


def _usage(tokens):
    if not isinstance(tokens, dict):
        return None
    cache = tokens.get("cache") if isinstance(tokens.get("cache"), dict) else {}
    return {"input_tokens": int(tokens.get("input") or 0),
            "cache_read_input_tokens": int(cache.get("read") or 0),
            "cache_creation_input_tokens": int(cache.get("write") or 0),
            "output_tokens": int(tokens.get("output") or 0) + int(tokens.get("reasoning") or 0)}


def opencode_session_usage(path):
    """Token breakdown of a session and its subagents -- every model step and compaction --
    plus opencode's own cost estimate."""
    totals = {"input_tokens": 0, "cache_read_input_tokens": 0,
              "cache_creation_input_tokens": 0, "output_tokens": 0}
    cost, requests, models = 0.0, 0, {}
    for ev in _entries(path)[2]:
        if ev.get("kind") not in ("assistant", "compaction"):
            continue
        u = _usage(ev["data"].get("tokens"))
        if not u:
            continue
        requests += 1
        cost += float(ev["data"].get("cost") or 0)
        for k in totals:
            totals[k] += u[k]
        model = (ev["data"].get("model") or {}).get("id")
        if model:
            models[model] = models.get(model, 0) + 1
    totals.update(requests=requests, cost_usd_vendor=round(cost, 6),
                  model=max(models, key=models.get) if models else None)
    return totals


def opencode_run_reply(stdout):
    """(text, usage) of an `opencode run --format json` run: the text parts joined, and the
    usage of its `step_finish` parts in ledger fields with opencode's cost (`cost_usd`). `usage`
    is None when no step was reported -- a reply that finishes fast is printed from the stored
    messages, without its steps."""
    texts, usage = [], None
    for line in (stdout or "").splitlines():
        try:
            ev = json.loads(line)
        except ValueError:
            continue
        part = ev.get("part") if isinstance(ev, dict) and isinstance(ev.get("part"), dict) else {}
        if ev.get("type") == "text" and isinstance(part.get("text"), str):
            texts.append(part["text"])
        elif ev.get("type") == "step_finish":
            u = _usage(part.get("tokens"))
            if u:
                usage = usage or dict.fromkeys(u, 0)
                for k, v in u.items():
                    usage[k] += v
                usage["cost_usd"] = usage.get("cost_usd", 0.0) + float(part.get("cost") or 0)
    return "".join(texts).strip(), usage
