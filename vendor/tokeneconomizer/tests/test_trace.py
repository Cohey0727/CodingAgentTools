"""Trace seam: load_trajectory / tool_usage / parse_catalog over synthetic transcripts."""
import os

from tokeneconomizer import trace
from fixtures import write_claude_transcript, write_codex_transcript


def test_load_trajectory_claude(tmp_path):
    p = str(tmp_path / "t.jsonl")
    write_claude_transcript(p, [
        ("bash", {"command": "python -m pytest tests/test_x.py"}, "2 passed"),
        ("edit", {"file_path": "pkg/mod.py"}, "ok")])
    traj = trace.load_trajectory(p)
    names = [name for name, _a, _r, _ok in traj]
    assert "bash" in names and "edit" in names


def test_a_claude_request_blob_repeating_the_conversation_adds_no_call(tmp_path):
    """Claude Code 2.1.300 writes `api-request-blob` entries that repeat a request's messages,
    earlier tool calls and results included. Read as calls, each one counted twice."""
    import json
    use = {"type": "tool_use", "id": "toolu_1", "name": "Bash", "input": {"command": "pytest -q"}}
    res = {"type": "tool_result", "tool_use_id": "toolu_1",
           "content": "/bin/bash: line 1: pytest: command not found", "is_error": True}
    lines = [{"type": "assistant", "cwd": "/w/repo", "message": {"role": "assistant",
                                                                "content": [use]}},
             {"type": "user", "message": {"role": "user", "content": [res]}},
             {"type": "api-request-blob", "message": {"role": "assistant", "content": [use]}},
             {"type": "api-request-blob", "message": {"role": "user", "content": [res]}},
             {"type": "assistant", "message": {"role": "assistant", "content": [use]}}]
    p = tmp_path / "s.jsonl"
    p.write_text("\n".join(json.dumps(l) for l in lines))
    calls = trace.load_trajectory(str(p))
    assert [(c[0], c[1]["command"], c[3]) for c in calls] == [("Bash", "pytest -q", False)]
    assert trace.call_cwds(str(p)) == ["/w/repo"]
    assert trace.tool_usage(str(p)) == {"Bash": 1}
    from tokeneconomizer.microskills import distiller
    assert len(distiller.load_calls(str(p))) == 1


def test_tool_usage_counts(tmp_path):
    p = str(tmp_path / "t.jsonl")
    write_claude_transcript(p, [
        ("bash", {"command": "ls"}, ""),
        ("bash", {"command": "pwd"}, ""),
        ("edit", {"file_path": "a.py"}, "")])
    usage = trace.tool_usage(p)
    assert usage.get("bash", 0) >= 2


def test_parse_catalog_codex_default():
    cat = trace.parse_catalog("/nonexistent", "codex")
    assert "shell" in cat and "apply_patch" in cat


def test_parse_catalog_missing_returns_empty(tmp_path):
    # Claude path with no transcript file -> empty catalog, no crash.
    assert trace.parse_catalog(str(tmp_path), "claude") == {}


# ---- Copilot tool-catalog sources: one pipeline across CLI builds -------------------
#
# The CLI has moved the loaded tool catalog twice, and each move made the then-current
# reader return {} -- which untooling cannot tell apart from "no tools loaded", so it
# degraded to a silent no-op for a whole sweep (measured: CLI 1.0.82 dropped 8 of 17 tools
# on 30/31 tasks; 1.0.83, same harness and repo, dropped nothing on 31/31). These tests
# pin all three source formats and the auto-selection between them.
import json as _json

from tokeneconomizer import trace as _trace
from tokeneconomizer.trace import catalog as _catalog

_SCHEMA_LOG = (
    '{"body":"{\\"tools\\":[{\\"name\\":\\"bash\\",\\"title\\":null,'
    '\\"description\\":\\"Run a shell command\\"},'
    '{\\"name\\":\\"view\\",\\"description\\":\\"Read a file\\"}]}"}'
)
_FLAT_LOG = '{\n  "tools": [\n    "bash:66921ccc",\n    "view:0963ceac",\n    "edit:9e640c64"\n  ]\n}'


def _checkpoint_transcript(*names):
    return _json.dumps({
        "type": "session.usage_checkpoint",
        "data": {"promptCacheBreakState": [
            {"models": {"m": {"tools": [{"name": n} for n in names]}}}]},
    })


def test_flat_catalog_parses_name_fingerprint_form():
    """CLI >= 1.0.82 publishes `"tools": ["bash:66921ccc", ...]` and no schemas."""
    cat = _catalog.parse_tool_catalog_flat(_FLAT_LOG)
    assert set(cat) == {"bash", "view", "edit"}
    assert all(v == "" for v in cat.values())      # names only, no descriptions
    assert _catalog.parse_tool_catalog(_FLAT_LOG) == {}   # schema reader stays schema-only


def test_schema_catalog_still_wins_and_keeps_descriptions(tmp_path):
    (tmp_path / "copilot_debug.log").write_text(_SCHEMA_LOG + "\n" + _FLAT_LOG)
    cat, src = _trace.parse_catalog_with_source(str(tmp_path), "copilot")
    assert src == "schema_debug_log"               # richest: it has descriptions
    assert cat["bash"].startswith("Run a shell command")


def test_flat_used_when_schemas_and_checkpoint_are_gone(tmp_path):
    """The 1.0.83 shape: no schemas, no usage_checkpoint -- must NOT parse empty."""
    (tmp_path / "copilot_debug.log").write_text(_FLAT_LOG)
    (tmp_path / "transcript.jsonl").write_text('{"type":"assistant.message","data":{}}')
    cat, src = _trace.parse_catalog_with_source(str(tmp_path), "copilot")
    assert src == "flat_debug_log"
    assert set(cat) == {"bash", "view", "edit"}


def test_usage_checkpoint_source_is_still_read(tmp_path):
    """The 1.0.82 shape must keep working -- supporting the new build is not a swap."""
    (tmp_path / "transcript.jsonl").write_text(_checkpoint_transcript("bash", "view"))
    cat, src = _trace.parse_catalog_with_source(str(tmp_path), "copilot")
    assert src == "usage_checkpoint"
    assert set(cat) == {"bash", "view"}


def test_no_source_reports_none_not_empty_catalog(tmp_path):
    """No source must be distinguishable from an empty catalog: {} is not 'no tools'."""
    (tmp_path / "copilot_debug.log").write_text("nothing useful here")
    cat, src = _trace.parse_catalog_with_source(str(tmp_path), "copilot")
    assert cat == {}
    assert src is None                              # defect signal, not an empty catalog


# ---- Web-Bench pass@1 vs pass@N ------------------------------------------------------
#
# Web-Bench grades each task with up to `retry` attempts, so a task has TWO defensible
# resolve metrics, and they differ materially (measured on prisma: 1-4 tasks per arm).
# Web-Bench's own headline is pass@1. The runner breaks out of the attempt loop on the
# first pass, which makes pass@1 recoverable from older rows that predate the explicit
# fields -- these pin that derivation, since getting it wrong reports pass@N under the
# pass@1 column.
def _p1p2(row):
    """The aggregator's per-row pass@1/pass@N resolution, mirrored for test."""
    p1, p2 = row.get("resolved_p1", ""), row.get("resolved_p2", "")
    att = row.get("webbench_attempts", "")
    if p1 == "" and p2 == "":
        if att != "":
            att = int(att or 0)
            if att == 0:
                return None, None
            p2 = row["resolved"] is True
            p1 = p2 and att == 1
        else:
            p1 = p2 = row["resolved"]
    return p1, p2


def test_explicit_attempt_fields_win():
    assert _p1p2({"resolved": True, "resolved_p1": False,
                  "resolved_p2": True, "webbench_attempts": 2}) == (False, True)


def test_legacy_row_second_attempt_pass_is_not_pass_at_1():
    """resolved=True after 2 attempts means attempt 1 FAILED."""
    assert _p1p2({"resolved": True, "webbench_attempts": 2}) == (False, True)


def test_legacy_row_first_attempt_pass():
    assert _p1p2({"resolved": True, "webbench_attempts": 1}) == (True, True)


def test_legacy_row_failed_every_attempt():
    assert _p1p2({"resolved": False, "webbench_attempts": 2}) == (False, False)


def test_unreached_task_counts_in_neither_metric():
    """Never attempted is not a miss -- it must not enter numerator or denominator."""
    assert _p1p2({"resolved": False, "webbench_attempts": 0}) == (None, None)


def test_single_attempt_domain_collapses_to_resolved():
    """SWE-bench rows carry no attempt fields; pass@1 and pass@N are the same number."""
    assert _p1p2({"resolved": True}) == (True, True)
    assert _p1p2({"resolved": False}) == (False, False)


def _jsonl(path, records):
    import json
    with open(path, "w") as fh:
        fh.write("\n".join(json.dumps(r) for r in records) + "\n")
    return str(path)


def test_a_claude_session_counts_the_prompts_the_person_gave(tmp_path):
    """Typed prompts and slash commands; not tool results, a local command's output, an
    interrupt marker, a compaction summary, meta text, or a subagent's prompts."""
    def user(content, **flags):
        return dict({"type": "user", "message": {"role": "user", "content": content}}, **flags)
    p = _jsonl(tmp_path / "c.jsonl", [
        user("fix the test"),
        user([{"type": "tool_result", "tool_use_id": "t1", "content": "ok"}]),
        user([{"type": "text", "text": "and the docs"}, {"type": "image", "source": {}}]),
        user("<command-name>/tokeneconomizer:status</command-name>"),
        user("<local-command-stdout>done</local-command-stdout>"),
        user("[Request interrupted by user]"),
        user("Caveat: the messages below were generated by the user", isMeta=True),
        user("This session is being continued...", isCompactSummary=True),
        user("subagent task", isSidechain=True),
        {"type": "assistant", "message": {"role": "assistant", "content": "done"}}])
    assert trace.claude_prompt_count(p) == 3


def test_a_codex_session_counts_one_prompt_per_turn(tmp_path):
    turn = [{"type": "turn_context", "payload": {"turn_id": "t"}},
            {"type": "event_msg", "payload": {"type": "task_started"}},
            {"type": "response_item", "payload": {"type": "message", "role": "user"}}]
    assert trace.codex_prompt_count(_jsonl(tmp_path / "r.jsonl", turn * 3)) == 3
    # a rollout without task_started events counts its turn contexts
    older = [r for r in turn if r["type"] != "event_msg"]
    assert trace.codex_prompt_count(_jsonl(tmp_path / "o.jsonl", older * 2)) == 2


def test_a_copilot_session_counts_its_user_messages(tmp_path):
    p = _jsonl(tmp_path / "events.jsonl", [
        {"type": "session.start", "data": {}}, {"type": "user.message", "data": {}},
        {"type": "tool.execution_start", "data": {}}, {"type": "user.message", "data": {}}])
    assert trace.copilot_prompt_count(p) == 2



def test_a_pi_session_counts_the_prompts_on_its_active_branch(tmp_path):
    """Pi keeps a conversation as a tree; a prompt on a branch the person left is not counted."""
    def msg(eid, parent, role):
        return {"type": "message", "id": eid, "parentId": parent, "message": {"role": role}}
    p = _jsonl(tmp_path / "pi.jsonl", [
        {"type": "session", "id": "s"}, msg("a", None, "user"), msg("b", "a", "assistant"),
        msg("x", "b", "user"), msg("y", "x", "assistant"),        # abandoned
        msg("c", "b", "user"), msg("d", "c", "toolResult"), msg("e", "d", "assistant")])
    assert trace.pi_prompt_count(p) == 2


def _opencode_copy(tmp_path):
    """A session with a subagent under it and an unrelated session, copied out of opencode's
    database the way the plugin does at a turn's end."""
    from fixtures import opencode_step, opencode_tool, write_opencode_db
    db = write_opencode_db(str(tmp_path / "opencode.db"), [
        ("ses_main", None, "/w/repo", [
            ("system", {"text": "instructions"}),
            ("user", {"text": "fix the test"}),
            opencode_step([opencode_tool("c1", "shell", {"command": "pytest -q"},
                                         "bash: pytest: command not found", exit_code=127)]),
            opencode_step([opencode_tool("c2", "read", {"path": "/w/repo/missing.py"},
                                         "File not found", ok=False),
                           opencode_tool("c3", "patch", {"patchText": "*** Begin Patch\n"
                                                         "*** Update File: pkg/a.py\n@@\n-a\n+b\n"
                                                         "*** End Patch"}, "Success")]),
            ("synthetic", {"text": "a reminder"}),
            ("user", {"text": "and run it"}),
            opencode_step([opencode_tool("c4", "shell", {"command": "python -m pytest -q"},
                                         "1 passed", exit_code=0)]),
            ("compaction", {"status": "completed", "cost": 0.0, "tokens": {
                "input": 5, "output": 5, "reasoning": 0, "cache": {"read": 0, "write": 0}}})]),
        ("ses_sub", "ses_main", "/w/repo", [
            ("user", {"text": "look around"}),
            opencode_step([opencode_tool("s1", "glob", {"pattern": "*.py"}, "a.py")],
                          model="claude-haiku-5-5")]),
        ("ses_other", None, "/w/other", [("user", {"text": "unrelated"})]),
    ])
    out = str(tmp_path / "copy.jsonl")
    assert trace.opencode_dump_session("ses_main", out, db_path=db) == 10
    return out


def test_an_opencode_session_is_read_through_the_plugins_copy(tmp_path):
    """The copy holds the session and its subagent's; the calls are the main session's, in the
    names the mechanisms read: `shell` is `bash`, a patch names its files, an error or a
    non-zero exit is a failure."""
    copy = _opencode_copy(tmp_path)
    out = str(tmp_path / "claude.jsonl")
    assert trace.opencode_session_to_claude(copy, out) == 4
    assert trace.load_trajectory(out) == [
        ("bash", {"command": "pytest -q"}, "bash: pytest: command not found\nExit code 127", False),
        ("read", {"path": "/w/repo/missing.py"}, "File not found", False),
        ("apply_patch", {"path": "pkg/a.py", "paths": ["pkg/a.py"]}, "Success", True),
        ("bash", {"command": "python -m pytest -q"}, "1 passed", True)]
    assert set(trace.call_cwds(out)) == {"/w/repo"}
    assert trace.opencode_prompt_count(copy) == 2      # not the synthetic, nor the subagent's


def test_an_opencode_sessions_usage_counts_its_subagents_and_compactions(tmp_path):
    usage = trace.opencode_session_usage(_opencode_copy(tmp_path))
    assert usage == {"input_tokens": 4 * 10 + 5, "cache_read_input_tokens": 4 * 1000,
                     "cache_creation_input_tokens": 4 * 100, "output_tokens": 4 * 50 + 5,
                     "requests": 5, "cost_usd_vendor": 0.004, "model": "claude-sonnet-5-5"}


def test_an_opencode_session_that_is_gone_leaves_the_last_copy(tmp_path):
    copy = _opencode_copy(tmp_path)
    before = open(copy).read()
    assert trace.opencode_dump_session("ses_gone", copy, db_path=str(tmp_path / "opencode.db")) is None
    assert trace.opencode_dump_session("ses_main", copy, db_path=str(tmp_path / "none.db")) is None
    assert open(copy).read() == before


def test_the_opencode_database_follows_its_environment():
    home = os.path.expanduser("~")
    assert trace.opencode_db_path({}) == os.path.join(home, ".local", "share", "opencode",
                                                      "opencode.db")
    assert trace.opencode_db_path({"XDG_DATA_HOME": "/x"}) == "/x/opencode/opencode.db"
    assert trace.opencode_db_path({"OPENCODE_DB": "dev.db"}).endswith("/opencode/dev.db")
    assert trace.opencode_db_path({"OPENCODE_DB": "/abs/o.db"}) == "/abs/o.db"
    assert trace.opencode_db_path({"OPENCODE_DB": ":memory:"}) is None


def test_an_opencode_run_reply_is_its_text_and_reported_steps():
    lines = [{"type": "step_start", "part": {}},
             {"type": "text", "part": {"text": "- use python -m pytest"}},
             {"type": "step_finish", "part": {"cost": 0.002, "tokens": {
                 "input": 700, "output": 290, "reasoning": 8, "cache": {"read": 0, "write": 45}}}}]
    import json
    text, usage = trace.opencode_run_reply("\n".join(json.dumps(x) for x in lines))
    assert text == "- use python -m pytest"
    assert usage == {"input_tokens": 700, "cache_read_input_tokens": 0,
                     "cache_creation_input_tokens": 45, "output_tokens": 298, "cost_usd": 0.002}
    # A reply that finished fast is printed from the stored messages, without its steps.
    assert trace.opencode_run_reply(json.dumps(lines[1])) == ("- use python -m pytest", None)
