# Git Workflow

## Push Policy (CRITICAL — ALL sessions, ALL repos)

Commit and push are ONE operation. NEVER stop after `git commit`:

- After EVERY commit, push immediately in the same task — `git push`, or `git push -u origin <branch>` for a new branch — before reporting done
- "commit しろ" / "commit it" ALWAYS means "commit AND push"
- Leaving a commit unpushed without telling the user is a rule violation (flagged 2026-08-11)
- If push is impossible (no remote, auth failure, protected branch, force needed), do not leave it silently local — report why immediately and ask

## Commit Message Format

```
<type>: <description>

<optional body>
```

Types: feat, fix, refactor, docs, test, chore, perf, ci

Note: Attribution disabled globally via ~/.claude/settings.json.

## Pull Request Workflow

When creating PRs:
1. Analyze full commit history (not just latest commit)
2. Use `git diff [base-branch]...HEAD` to see all changes
3. Draft comprehensive PR summary
4. Include test plan with TODOs
5. Push with `-u` flag if new branch

## Feature Implementation Workflow

1. **Plan First**
   - Use **planner** agent to create implementation plan
   - Identify dependencies and risks
   - Break down into phases

2. **TDD Approach**
   - Use **tdd-guide** agent
   - Write tests first (RED)
   - Implement to pass tests (GREEN)
   - Refactor (IMPROVE)
   - Verify 80%+ coverage

3. **Code Review**
   - Use **code-reviewer** agent immediately after writing code
   - Address CRITICAL and HIGH issues
   - Fix MEDIUM issues when possible

4. **Commit & Push**
   - Detailed commit messages
   - Follow conventional commits format
