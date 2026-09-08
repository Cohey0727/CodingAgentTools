---
name: fanout
description: Split many files among N parallel agents to apply one mechanical instruction - a coding rule, a pattern replacement, an API migration, a scan grep cannot do. Use for embarrassingly parallel work across a directory tree.
origin: user
---

# /fanout — Parallel File-Sweep Skill

A lightweight fan-out runner for **monotonous, full-tree tasks**: "go through every file under X and do Y." Splits the file set across N agents, dispatches them in parallel in a single message, and aggregates results.

Not for: cross-file refactors that need shared state, anything requiring worktree isolation (use `/devfleet`), or recurring/long-running work (use `/loop` or `/autonomous-loops`).

## Invocation

```
/fanout <instruction> [--root=<path>] [--workers=<N>] [--filter=<glob>] [--mode=detect|fix] [--dry-run]
```

If the user invokes the skill without all arguments, infer reasonable defaults and **state them back before dispatching** so the user can correct.

### Arguments

| Arg | Default | Meaning |
|---|---|---|
| `instruction` | (required) | Free-text task each worker performs on its slice. Be concrete. |
| `--root` | repo root | Directory to sweep. |
| `--workers` | auto (see below) | Number of parallel agents. |
| `--filter` | `**/*` | Glob to narrow file types (`**/*.tsx`, `**/*.{ts,tsx}`, etc.). |
| `--mode` | `fix` | `detect` = read-only report, `fix` = edits allowed. |
| `--dry-run` | off | Each worker reports what it *would* change without editing. |

### Auto worker count

Pick from file count when `--workers` omitted:

| Files | Workers |
|---|---|
| ≤ 8 | 1 (no fan-out needed — just do it inline) |
| 9–25 | 2 |
| 26–80 | 4 |
| 81–200 | 5 |
| 200+ | 6 |

Hard cap at **6**. More workers strain context and parallel-tool throughput without improving wall time.

## Execution flow

### 1. Enumerate files

Use `git ls-files` (tracked files only) under `--root`, then apply `--filter`. Exclude:

- `node_modules/`, `dist/`, `build/`, `.next/`, `*.gen.ts`, `*.gen.tsx`
- Anything inside a directory listed in `.gitignore` that slipped in
- Lockfiles, binary assets

Untracked files are skipped on purpose — fan-out should not touch in-progress work from parallel sessions.

### 2. Decide worker count and slice

- Apply the auto table above unless overridden.
- Sort files by size (descending), then round-robin into N buckets so slow files are spread evenly.
- A single file is **never** assigned to two workers.

### 3. Confirm before dispatch

Print a short pre-flight:

```
fanout pre-flight
  instruction: <verbatim>
  root: <path>
  filter: <glob>
  files: <N>
  workers: <K>
  mode: detect | fix
  dry-run: yes | no
```

For `--mode=fix` with > 30 files, **ask the user to confirm** before launching. For `--mode=detect` or `--dry-run`, dispatch directly.

### 4. Dispatch in parallel

Send a **single assistant message** with K `Agent` tool calls. Use:

- `subagent_type: "Explore"` when `--mode=detect` or `--dry-run` (no edits needed)
- `subagent_type: "general-purpose"` when `--mode=fix` (needs Edit/Write)

Do **not** use `isolation: "worktree"`. Workers share the working tree; disjoint file ownership prevents conflicts.

### 5. Worker prompt template

Each worker gets a self-contained prompt:

```
You are fanout worker {i}/{K}.

# Task
{instruction}

# Your file slice ({len} files — touch ONLY these)
- path/one.ts
- path/two.tsx
...

# Hard constraints
- Edit ONLY files in your slice. Reading other files is fine; writing is not.
- Do NOT create *.bak, *.new, *.old, or _v2 sidecar files.
- Do NOT run git commands. Do NOT stage or commit.
- Do NOT run formatters or linters (the orchestrator handles `just ci` after).
- If a file is ambiguous or risky, SKIP it and report why — do not guess.
- {if dry-run}: Do not edit. For each file, describe the change you would make.
- {if detect}: Do not edit. Report findings as `path:line — <issue>`.

# Report format (return at the end, verbatim)
## Worker {i}/{K} — {len} files

### Changed ({n})
- path/one.ts — one-line summary of what changed
- ...

### Skipped ({n})
- path/two.tsx — reason

### No-op ({n})
- path/three.ts

### Notes
- Anything the orchestrator should know (cross-file concerns, common patterns, follow-ups).
```

For `detect` mode, replace the change/skip/no-op buckets with `### Findings` (file:line list) and `### Clean` (count only).

### 6. Aggregate

After all workers return, produce a single Markdown report:

```markdown
# /fanout report

- Instruction: <verbatim>
- Root: <path> · Filter: <glob>
- Files: <N> · Workers: <K> · Mode: <mode>

## Summary
- Changed: <n>
- Skipped: <n>
- No-op: <n>
- Findings (detect mode): <n>

## Per-worker
<inline each worker's report>

## Cross-cutting notes
<merged from worker "Notes" sections>
```

### 7. Post-run

- **Do not commit automatically.** Surface the report and let the user inspect.
- For `--mode=fix`: remind the user to run `just ci` (or the project's equivalent) before committing. If the project is shogi-gpt-app, this is mandatory per CLAUDE.md.
- If a worker reports many SKIPs or cross-cutting concerns, suggest a follow-up `/fanout` with a refined instruction rather than chasing edge cases inline.

## Anti-patterns

- **Don't** use this skill for tasks where files depend on each other (e.g., renaming a function and updating all callers — give that to one agent, not N).
- **Don't** raise workers above 6 to "go faster." Diminishing returns and high context cost.
- **Don't** let workers run `git`, `just ci`, formatters, or anything that mutates shared state outside their slice. The orchestrator owns those.
- **Don't** use worktree isolation. Workers in the same tree on disjoint files is the whole point — isolation defeats the cost model and conflicts with the user's "no rollback / 1-commit" discipline.
- **Don't** silently expand the slice. If a worker thinks a file outside its slice also needs changes, it reports that in Notes; the orchestrator handles it in a follow-up pass.

## Examples

### Detect-only sweep

```
/fanout "find raw Pressable / TouchableOpacity used as buttons (not tap-targets like board cells, list rows, dismiss overlays)" \
  --root=apps/mobile/src --filter="**/*.tsx" --mode=detect
```

### Mechanical fix

```
/fanout "extract inline StyleSheet.create blocks into a sibling *.style.ts file and update the import" \
  --root=apps/mobile/src/components --filter="**/*.tsx" --mode=fix --workers=4
```

### Dry-run before committing to a fix

```
/fanout "replace useState-only settings with Zustand store usage from src/stores/settings.ts" \
  --root=apps/mobile/src/screens --mode=fix --dry-run
```

## Relationship to other skills

| If you want… | Use |
|---|---|
| Disjoint file slices, one-shot, light | **/fanout** (this) |
| Same task in isolated worktrees, with progress monitoring | `/devfleet` |
| Multiple harnesses/models in tmux panes | `/dmux-workflows` |
| Recurring or self-paced loop | `/loop` or `/autonomous-loops` |
| Pick which agent personas to assemble | `/team-builder` |
