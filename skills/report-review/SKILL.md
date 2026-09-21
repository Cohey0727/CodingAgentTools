---
name: report-review
description: Spec-driven review that reports in six fixed sections (仕様チェック / docsチェック / コード品質 / パフォーマンス / セキュリティ / 技術選定) to a temp file, a specified folder, or inline PR comments at the exact lines. Use when asked with 「report-review」「レビューレポート」「レビューしてレポートにまとめて」.
---

# report-review — spec-driven multi-section review

Spec-driven code review that always reports in **six fixed sections** — 仕様チェック (spec compliance), docsチェック (docs & conventions), コード品質 (code quality), パフォーマンス (performance), セキュリティ (security), 技術選定 (selection of newly adopted libraries / technologies) — and delivers the result as a temp file, a file in a user-specified folder, or inline comments posted directly on the PR lines.

Unlike `/deep-review` (5 parallel subagents for adversarial depth), this runs a single review context focused on judging the diff **against the spec**. Lighter and faster; use it when you have a spec and want a structured verdict, not an exhaustive sweep.

## Workflow

### Step 1: Fix the spec, the target, and the output mode

**Spec** — the baseline every finding is judged against. Accept it from any of:

| Source | How to get it |
|---|---|
| Arguments | Text, file path, or ticket number the user passes as the spec |
| PR body | `gh pr view --json title,body,closingIssuesReferences`, plus linked issues via `gh issue view` |
| Chat | Requirements agreed earlier in this session (design decisions, accepted proposals) |

If multiple sources apply, merge them. If they contradict each other, ask the user before reviewing. **If no spec is available at all, ask for one — do not invent one.** The 仕様チェック section cannot be filled without a spec, and an invented spec turns every check into a tautology.

**Review target**:

| Input | Target |
|---|---|
| PR number / URL | `gh pr diff <N>` |
| None | Uncommitted changes (`git diff HEAD` + untracked). If empty, `git diff main...HEAD` |

**Output mode**:

| Signal | Mode | Deliverable |
|---|---|---|
| PR target + 「PRに」「インラインで」「コメントで」 | **PR inline** | Inline comments at the exact lines + summary in the review body |
| Folder path / 「<XX>に出して」 | **Folder** | `<folder>/report-review-<slug>.md` |
| 「tmpに」「ファイルに出して」 / unspecified | **Temp file** | `<tmp>/report-review-<slug>.md` |

`<tmp>` is the session scratchpad (`/tmp` if none). `<slug>` identifies the target (PR number or branch name). Never post to the PR based on a guess — ambiguous signals mean ask first.

### Step 2: Prepare the code and the review baseline

The diff alone is not enough: regression risk and convention checks need the surrounding code and sibling implementations.

- **Local diff**: review against the current working tree as-is.
- **PR**: if the current checkout is the PR head, use it. Otherwise create a detached worktree:

```bash
git fetch origin pull/<N>/head
git worktree add --detach <tmp>/report-review-wt FETCH_HEAD
```

Then collect the review baseline from the repository: `CLAUDE.md`, `CONTRIBUTING.md`, `docs/` style guides and ADRs, lint/formatter configs. If none exist, judge conventions against the existing code itself and say so in the report.

### Step 3: Review the six sections

Fixed sections, fixed sub-checks. Every sub-check ends with either findings or an explicit "no issues" plus **what was checked** — a silent section is indistinguishable from a skipped one. Every finding carries `file:line` and verifiable evidence; drop anything you cannot back with code.

#### 仕様チェック

**仕様と修正の一致** — does the change match the spec?

- Break the spec into itemized requirements, and map each item to the diff location that fulfills it.
- A requirement with no mapping = missing implementation. Diff content with no requirement = scope creep / over-implementation.
- Where the spec is ambiguous and the implementation picked one reading, report the interpretation taken — not just "differs".
- Check that acceptance criteria are actually verifiable in the change (tests, observable behavior).

**デグレードリスク** — regression risk?

- Grep all callers of every changed/deleted symbol across the codebase; list the ones whose behavior changes with the same input as before.
- Public API / response shape / DB schema / config-key breaking changes.
- Deleted code that still had a live path — assumed-dead code that was not dead.
- Tests weakened to fit the new behavior (loosened assertions, deleted cases) are a red flag, not a green one.

#### docsチェック

**docs・スタイルガイド準拠 / 更新忘れ** — compliance and stale docs?

- Check the diff against the collected guidelines and lint/formatter configs.
- Sweep for docs this change makes stale: README usage, API reference, CHANGELOG, config examples. A new option / endpoint / env var added but left undocumented is a finding.

**暗黙の慣習との整合** — undocumented conventions?

- Docs do not state everything. Find sibling implementations of the same kind (same directory, same pattern: other commands, handlers, modules) and compare structure, naming, error handling, logging, and test style.
- If the new code invents its own style where parallel implementations share one, that is a finding even though no doc forbids it — propose aligning with the established pattern.
- If the siblings themselves are the outliers, report that instead (align all of them, not the new code).

#### コード品質

**DRY** — is it built on existing code?

- For each function / constant / type newly defined in the diff, grep for an existing equivalent in the codebase before accepting it.
- Also check duplication within the diff itself (copy-pasted logic between files).

**冗長性** — is it redundant?

- Unused flexibility: option parameters, abstraction layers, config entries with a single caller.
- Thin wrappers used once. Unreachable branches and defensive code against impossible states. Excessive logging.

**修正量の乖離** — expected vs actual change size?

- List the changes the spec requires, then compare with the actual diff size (`git diff --stat` / PR files changed).
- Much larger than expected → scope creep (unrelated refactoring mixed in). Much smaller → under-implementation; part of the spec is likely missing. State the direction with the actual numbers.

**テスト品質** — tests prohibited by test-generation?

Diff-added tests are checked against `/test-generation`'s prohibited patterns:

1. **Declarative constant tests**: `expect(MAX_RETRIES).toBe(3)` — asserting a copy of the implementation instead of behavior.
2. **Tests against mocks**: asserting what the mock returns when the SUT just passes it through — that tests the mock, not the SUT.
3. **Combinatorial explosion**: mechanically generated cartesian products; case counts disproportionate to the aspect being tested.

#### パフォーマンス

- Hot paths: N+1 queries, I/O inside loops, unnecessary recomputation, accidental O(n²).
- Behavior when data volume grows 10x / 100x: unbounded lists, missing pagination / limits.
- Frontend: unnecessary re-renders, missing memoization, synchronous heavy work, bundle size.
- Backend resources: connection / cache behavior, missing DB indexes, full scans.

#### セキュリティ

- Authentication / authorization: IDOR, tenant / user boundary crossings, missing checks.
- Input validation, injection (SQL / command / path / template), XSS / CSRF.
- Hardcoded secrets and tokens; PII or credentials leaking into logs / error messages.
- Known CVEs in dependencies touched by the diff.

#### 技術選定

Applies when the diff adopts a new library or technology (new packages, frameworks, infra components). If nothing new is adopted, write "No new libraries or technologies introduced — not applicable" — the section is never dropped silently.

- Is the adopted version the current stable / LTS? Pinning an EOL or non-LTS major is a finding.
- Are the alternatives workable? Compare 2–3 realistic candidates — including what the repository already depends on — on fit, maintenance, and cost. The first search hit is not a justification.
- Maintenance status: last release, release cadence, open CVEs, license. Overlap with a dependency already in the tree is a finding.

### Step 4: Assemble the report

Fixed structure. Section headers stay in Japanese as designated:

```markdown
# Review Report: <target identifier>

## 仕様チェック

### 仕様と修正の一致
<findings, or "No issues — <what was checked>">

### デグレードリスク
<same format>

## docsチェック

### docs・スタイルガイド準拠 / 更新忘れ
<same format>

### 暗黙の慣習との整合
<same format>

## コード品質

### DRY
### 冗長性
### 修正量の乖離
### テスト品質

## パフォーマンス
<findings, or "No issues — <what was checked>">

## セキュリティ
<same format>

## 技術選定
<findings, or "No new libraries or technologies introduced — not applicable">

## Summary
<merge-ready or fix-first, and which findings block — about the code only>
```

Finding format, used in every section:

```markdown
- [HIGH] path/to/file.ts:42 — <one-line title>
  - Evidence: <fact in the code — line numbers, function names, actual values>
  - Fix: <concrete suggestion>
```

Severity is `CRITICAL` / `HIGH` / `MEDIUM` / `LOW`. Do not inflate counts; zero findings in a section is fine.

Never describe the review process itself ("this skill", "checked with subagents", ...) in the report — the report speaks about the code only.

### Step 5: Deliver in the chosen mode

#### Temp file

Write to `<tmp>/report-review-<slug>.md` and report the path.

#### Folder

Write to `<folder>/report-review-<slug>.md` (create the directory if needed). Do not commit it.

#### PR inline

Findings whose line is inside the PR diff become inline comments at that exact line. Everything else (cross-cutting findings such as 修正量の乖離, docs updates, and 技術選定 verdicts, plus the summary) goes into the review body:

```bash
gh api repos/{owner}/{repo}/pulls/{number}/reviews --input review.json
```

```json
{
  "commit_id": "<head SHA of the PR>",
  "event": "COMMENT",
  "body": "<Summary + findings that could not be pinned to a diff line>",
  "comments": [
    { "path": "src/foo.ts", "line": 42, "side": "RIGHT", "body": "[HIGH] 仕様チェック / 仕様と修正の一致: <title>\n\nEvidence: ...\n\nFix: ..." }
  ]
}
```

- `line` is a line number within the PR diff (new-file side). Lines outside the diff cannot take inline comments — put those findings in the body.
- `event` is always `COMMENT`. Approve / request changes stays a human decision.
- If Step 2 created a worktree, remove it: `git worktree remove --force <tmp>/report-review-wt`.

### Step 6: Report back in chat

- Findings count with severity breakdown per section
- The deliverable (report path or review URL)
- Anything deliberately left unchecked (e.g., spec items that needed user input)

## Rules

- **Six sections, fixed.** Never drop a section because the diff is small or "not relevant" — write "no issues" (or "not applicable" for 技術選定) with what was checked instead.
- **No spec, no review.** Ask instead of inferring the spec.
- **Every finding has `file:line` + evidence.** Unverifiable findings are dropped, not softened.
- **Section headers stay in Japanese** (仕様チェック / docsチェック / コード品質 and their sub-checks). The rest of the report follows the repository's documentation language.
- **Read the code, not just the diff.** Regression and convention checks are impossible without the surrounding code and sibling implementations.
- **Never guess an output mode that writes.** PR comments and repo files need an explicit signal; when ambiguous, ask.
- **Review only — no fixes.** This skill reports; it does not edit code, commit, or push. Fixing is a separate instruction.
- Work on the current branch; never switch branches to obtain the review target.

## Related skills

| Goal | Use |
|---|---|
| Deep, adversarial 5-perspective sweep | `/deep-review` |
| Cross-model consensus on the same review request | `/fusion-review` |
| Address review comments received on a PR | `/resolve-reviews` |
| Write tests (source of the prohibited-test patterns) | `/test-generation` |
