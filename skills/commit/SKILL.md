---
name: commit
description: 変更を分析して conventional commit 形式のメッセージを生成しコミットする。「コミット」「変更を保存」と言われたときに使用。
disable-model-invocation: true
---

# Auto Commit

Analyze git changes and create a commit with an auto-generated conventional commit message.

## Workflow

### Step 1: Check Repository State

Run these commands in parallel to gather context:

```bash
# Staged and unstaged changes
git diff --cached --stat
git diff --stat

# Detailed diffs for message generation
git diff --cached
git diff

# Untracked files
git status --short

# Recent commit messages for style reference
git log --oneline -10
```

### Step 2: Stage Changes (if needed)

If there are no staged changes but there are unstaged changes or untracked files:
- Ask the user which files to stage
- Do NOT blindly run `git add -A` or `git add .`
- Prefer staging specific files by name
- Never stage files that likely contain secrets (`.env`, `credentials.json`, etc.)

If there are already staged changes, proceed with those.

### Step 3: Run Lint and Tests (if available)

Before committing, check if the project has lint or test scripts configured (e.g., `package.json`, `Makefile`, etc.). If found, run them to catch issues early:

```bash
# Examples (run whichever are available)
npm run lint
npm run test
```

- If lint or tests fail, fix the issues before proceeding to commit
- If the project has no lint/test configuration, skip this step

### Step 4: Analyze Changes

Analyze all staged changes to determine:

1. **Change type** - What kind of change is this?
   - `feat`: New feature or functionality
   - `fix`: Bug fix
   - `refactor`: Code restructuring without behavior change
   - `chore`: Maintenance, dependencies, config

2. **Comment** - 変更理由の簡潔な要約
   - 「何を変えたか」ではなく「なぜ変えたか」に焦点を当てる
   - 日本語で書く
   - 40文字以内に収める

### Step 5: Generate and Execute Commit

Format the commit message following conventional commits:

```
<type>: <comment> @<branch name>
```

Get the current branch name with `git branch --show-current` and append it with `@` prefix.

Execute the commit:

```bash
BRANCH=$(git branch --show-current)
git commit -m "<type>: <comment> @${BRANCH}"
```

### Step 6: Stage and Push (if needed)

After committing, check if the current branch has an upstream remote set and if there are unpushed commits:

```bash
git status -sb
```

- If the branch has no upstream (`git rev-parse --abbrev-ref @{u}` fails), ask the user if they want to push with `git push -u origin <branch>`.
- If there are unpushed commits, ask the user if they want to push.
- Do NOT push automatically without user confirmation.

### Step 7: Verify

Run `git status` after commit to confirm success. Show the user the commit hash and message.

## Language

コミットメッセージの記述言語は、明示的な指定がない限り、そのリポジトリで主として使用されている言語に従う。

- リポジトリの既存コミット履歴（`git log`）やドキュメントから主要言語を判定する
- 日本語リポジトリなら日本語、英語リポジトリなら英語でコメントを書く
- ユーザーが言語を指定した場合はその指定に従う

## Rules

- コミット作業に時間をかけない。差分の確認・メッセージ生成・実行を素早く完了させる
- NEVER add a body to the commit message. Subject line only. No exceptions.
- NEVER commit files containing secrets (`.env`, API keys, tokens, passwords)
- NEVER use `git add -A` or `git add .` without user confirmation
- NEVER amend previous commits unless explicitly asked
- NEVER push to remote unless explicitly asked
- NEVER skip pre-commit hooks (no `--no-verify`)
- If pre-commit hook fails, fix the issue and create a NEW commit (do not amend)
- If there are no changes to commit, inform the user and stop
- Always show the generated commit message to the user before executing

## Examples

### Simple feature
```
feat: パスワードリセットメール機能を追加 @feature/auth
```

### Bug fix
```
fix: 決済プロバイダのnullレスポンスを処理 @fix/payment-webhook
```

### Refactor
```
refactor: クエリビルダーをリポジトリパターンに抽出 @main
```
