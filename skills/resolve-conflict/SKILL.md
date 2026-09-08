---
name: resolve-conflict
description: Git のマージコンフリクトを分析し、安全に解決する。「コンフリクト解決」「マージ競合」と言われたときに使用。
---

# Resolve Git Merge Conflicts

Detect, analyze, and safely resolve git merge conflicts.

## Workflow

### Step 1: Detect Conflicts

Run these commands to identify the current conflict state:

```bash
# Check if we're in a merge/rebase/cherry-pick state
git status

# List all conflicted files
git diff --name-only --diff-filter=U
```

If there are no conflicts, inform the user and stop.

### Step 2: Analyze Each Conflicted File

For each conflicted file:

1. **Read the full file** to understand the conflict markers (`<<<<<<<`, `=======`, `>>>>>>>`)
2. **Identify the branches** involved (ours vs theirs)
3. **Understand the intent** of both sides:
   - What did "ours" (current branch) change and why?
   - What did "theirs" (incoming branch) change and why?

Use these commands for additional context:

```bash
# Show what each side changed
git log --oneline --merge -- <file>

# Show the common ancestor version
git show :1:<file>

# Show our version
git show :2:<file>

# Show their version
git show :3:<file>
```

### Step 3: Present Resolution Strategy

For each conflict, present the user with a clear summary:

```
File: <path>
Conflict #N:
  OURS (current branch): <description of our change>
  THEIRS (incoming branch): <description of their change>
  Recommendation: <keep ours / keep theirs / merge both / manual review needed>
  Reason: <why this resolution is recommended>
```

**Wait for user confirmation** before applying any resolution.

### Step 4: Resolve Conflicts

Apply the approved resolution using the Edit tool:

- Remove all conflict markers (`<<<<<<<`, `=======`, `>>>>>>>`)
- Ensure the resolved code is syntactically correct
- Preserve proper formatting and indentation
- Do NOT introduce new functionality or refactor during resolution

After editing each file, verify it is valid:

```bash
# Check no conflict markers remain
grep -rn '<<<<<<<\|=======\|>>>>>>>' <file> || echo "No conflict markers remaining"
```

### Step 5: Verify Resolution

Run validation checks on all resolved files:

```bash
# Confirm no conflict markers remain in any file
git diff --check

# Show the resolved changes for review
git diff --staged
git diff
```

If the project has a build or type-check command, suggest running it to verify correctness.

### Step 6: Stage Resolved Files

Stage the resolved files individually:

```bash
git add <resolved-file-1> <resolved-file-2> ...
```

Do NOT use `git add -A` or `git add .`.

### Step 7: Complete the Merge/Rebase

Depending on the operation in progress:

- **Merge**: Run `git status` to confirm all conflicts are resolved, then inform the user they can commit
- **Rebase**: Suggest `git rebase --continue`
- **Cherry-pick**: Suggest `git cherry-pick --continue`

Do NOT automatically commit or continue without user confirmation.

## Rules

- NEVER auto-resolve conflicts without showing the user what will change
- NEVER delete code from either side without explicit user approval
- NEVER use `git checkout --ours` or `git checkout --theirs` on entire files without confirmation
- NEVER run `git merge --abort` or `git rebase --abort` unless the user explicitly requests it
- NEVER introduce new changes, refactors, or improvements during conflict resolution
- If a conflict is too complex to resolve safely, recommend manual review
- Preserve both sides' intent whenever possible (prefer merging both changes over discarding one)
- Pay special attention to:
  - Import statements (merge both sets of imports, remove duplicates)
  - Package lock files (`package-lock.json`, `yarn.lock`) - recommend regenerating instead of manual merge
  - Configuration files - verify no contradictory settings
  - Database migrations - warn about ordering issues

## Examples

### Simple: Both sides added different lines

```
<<<<<<< HEAD
import { UserService } from './user.service'
=======
import { AuthService } from './auth.service'
>>>>>>> feature/auth
```

Resolution: Keep both imports.

```
import { UserService } from './user.service'
import { AuthService } from './auth.service'
```

### Complex: Both sides modified the same function

```
<<<<<<< HEAD
function getUser(id: string): User {
  return cache.get(id) ?? db.findUser(id)
}
=======
function getUser(id: string): Promise<User> {
  const user = await db.findUser(id)
  if (!user) throw new NotFoundError('User not found')
  return user
}
>>>>>>> feature/error-handling
```

Resolution: Merge both changes (caching + error handling). Requires careful analysis.

```
async function getUser(id: string): Promise<User> {
  const cached = cache.get(id)
  if (cached) return cached
  const user = await db.findUser(id)
  if (!user) throw new NotFoundError('User not found')
  return user
}
```

### Lock files

```
Conflict in package-lock.json
```

Resolution: Do not manually resolve. Recommend:

```bash
git checkout --theirs package-lock.json
npm install
```
