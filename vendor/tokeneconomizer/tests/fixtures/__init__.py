"""Tiny synthetic fixtures for the offline test suite (no Docker, no datasets)."""
import json
import os


def write_claude_transcript(path, calls):
    """Write a minimal Claude-schema transcript.jsonl.
    `calls` is a list of (tool_name, input_dict, result_text[, cwd]); a cwd is recorded on the
    call's entry, as Claude Code records the directory its shell is in."""
    lines = []
    for i, (name, inp, res, *cwd) in enumerate(calls):
        tid = f"t{i}"
        lines.append(dict({"message": {"content": [
            {"type": "tool_use", "id": tid, "name": name, "input": inp}]}},
            **({"cwd": cwd[0]} if cwd else {})))
        lines.append({"message": {"content": [
            {"type": "tool_result", "tool_use_id": tid, "content": res}]}})
    with open(path, "w", encoding="utf-8") as fh:
        fh.write("\n".join(json.dumps(x) for x in lines))
    return path


def write_codex_transcript(path, items):
    """Write a minimal Codex-schema transcript.jsonl.
    `items` is a list of dicts merged into an `item.completed` event's `item`."""
    lines = []
    for i, item in enumerate(items):
        it = {"id": f"i{i}", "status": "completed"}
        it.update(item)
        lines.append({"type": "item.completed", "item": it})
    with open(path, "w", encoding="utf-8") as fh:
        fh.write("\n".join(json.dumps(x) for x in lines))
    return path


def run_dir_with(tmp_path, transcript_lines_writer):
    """Make a run dir containing a transcript.jsonl written by the given writer."""
    d = os.path.join(str(tmp_path), "run")
    os.makedirs(d, exist_ok=True)
    transcript_lines_writer(os.path.join(d, "transcript.jsonl"))
    return d


def write_claude_transcript_with_catalog(path, tools, calls):
    """Claude transcript that also carries the `system/init` line naming the LOADED tools.

    The tool catalog is only recoverable from that init line (trace.parse_catalog ->
    reflect.parse_tool_catalog_claude), so a fixture without it cannot exercise the
    evidence-untooling path at all: the stage would see an empty catalog forever and
    correctly drop nothing.
    """
    import json as _json
    lines = [{"type": "system", "subtype": "init", "tools": list(tools)}]
    for i, (name, inp, res) in enumerate(calls):
        tid = f"t{i}"
        lines.append({"type": "assistant", "message": {"content": [
            {"type": "tool_use", "id": tid, "name": name, "input": inp}]}})
        lines.append({"type": "user", "message": {"content": [
            {"type": "tool_result", "tool_use_id": tid, "content": res}]}})
    with open(path, "w", encoding="utf-8") as fh:
        fh.write("\n".join(_json.dumps(x) for x in lines))
    return path


def write_opencode_db(path, sessions):
    """An opencode 2.x database holding the given sessions, in the two tables the plugin reads.
    `sessions` is a list of (session_id, parent_id, directory, messages); each message is a
    (type, data) pair, stored in order after any the session already has. A tool call is an
    `assistant` message whose `content` holds `{"type": "tool", "id", "name", "state": {...}}`
    items, the result in the item."""
    import sqlite3
    con = sqlite3.connect(path)
    con.execute("CREATE TABLE IF NOT EXISTS session_v2 (id TEXT PRIMARY KEY, project_id TEXT, "
                "parent_id TEXT, slug TEXT, directory TEXT, title TEXT, version TEXT)")
    con.execute("CREATE TABLE IF NOT EXISTS session_message (id TEXT PRIMARY KEY, "
                "session_id TEXT, type TEXT, seq INTEGER, time_created INTEGER, "
                "time_updated INTEGER, data TEXT)")
    for sid, parent, directory, messages in sessions:
        con.execute("INSERT OR IGNORE INTO session_v2 VALUES (?, 'p', ?, ?, ?, 't', '2.2.0')",
                    (sid, parent, sid, directory))
        (first,) = con.execute("SELECT COUNT(*) FROM session_message WHERE session_id = ?",
                               (sid,)).fetchone()
        for seq, (kind, data) in enumerate(messages, start=first):
            con.execute("INSERT INTO session_message VALUES (?, ?, ?, ?, 0, 0, ?)",
                        (f"{sid}-{seq}", sid, kind, seq, json.dumps(data)))
    con.commit()
    con.close()
    return path


def opencode_tool(call_id, name, args, text, ok=True, exit_code=None):
    """One `tool` item of an opencode assistant message, completed or failed."""
    if not ok and exit_code is None:
        state = {"status": "error", "input": args,
                 "error": {"type": "tool.execution", "message": text}}
    else:
        state = {"status": "completed", "input": args, "content": [{"type": "text", "text": text}],
                 "metadata": {"truncated": False, **({"exit": exit_code}
                                                     if exit_code is not None else {})}}
    return {"type": "tool", "id": call_id, "name": name, "executed": False, "state": state}


def opencode_step(tools, model="claude-sonnet-5-5", tokens=None, cost=0.001):
    """One opencode `assistant` message: a model step and the tool calls it made."""
    return ("assistant", {"agent": "build", "model": {"id": model, "providerID": "anthropic"},
                          "content": tools, "finish": "tool-calls", "cost": cost,
                          "tokens": tokens or {"input": 10, "output": 40, "reasoning": 10,
                                               "cache": {"read": 1000, "write": 100}}})
