---
name: git-workflow
description: 変更のコミットからPR作成まで一括実行する。汎用ブランチにいる場合は新規ブランチを作成。リポジトリのPRテンプレートがあれば自動適用。ユーザーが「PR作成」「プルリク」と言ったとき、または /git-workflow を実行したときに使用。
---

# Git Workflow: Branch → Commit → Push → PR

Run the full workflow from commit to PR creation in one shot.

## Workflow

### Step 1: Check Repository State

Run these commands in parallel to gather context:

```bash
# Current branch name
git branch --show-current

# Check for changes
git status --short

# Check remote
git remote -v
```

- 変更がない場合はユーザーに通知して終了する
- リモートが設定されていない場合はユーザーに通知して終了する

### Step 2: Branch Detection and Checkout

現在のブランチが以下の汎用ブランチに該当するか判定する:

- `main`
- `master`
- `develop`
- `development`
- `staging`
- `release`

**汎用ブランチにいる場合:**

1. 変更内容を `git diff` と `git diff --cached` で分析する
2. 変更内容に基づいて適切なブランチ名を自動生成する:
   - フォーマット: `<type>/<短い説明>`
   - type: `feat`, `fix`, `refactor`, `chore`, `docs`, `test`
   - 説明は英語・ケバブケース・簡潔に（例: `feat/add-user-auth`, `fix/null-response-handling`）
3. 基本的に確認不要でそのままブランチを作成する。ただし、変更が大きく複数の機能や不具合にまたがる場合のみ確認を求めてよい
4. ブランチを作成してチェックアウトする:

```bash
git checkout -b <branch-name>
```

**汎用ブランチでない場合:** そのまま続行する。

### Step 3: Commit Changes

`/commit` スキルを呼び出してコミットを実行する。

`/commit` が失敗またはユーザーがキャンセルした場合はワークフローを停止する。

### Step 4: Verify Branch and Push

プッシュ前に現在のブランチが汎用ブランチでないことを再確認する:

```bash
CURRENT=$(git branch --show-current)
```

汎用ブランチ（main, master, develop, development, staging, release）の場合はプッシュを中止し、ユーザーに報告する。

安全が確認できたらリモートにプッシュする:

```bash
git push -u origin $(git branch --show-current)
```

### Step 5: Detect PR Template

リポジトリ内のPRテンプレートを Glob で検索する:

```
**/*pull_request_template*
```

見つかった場合はその内容を読み込み、テンプレートの構造に従ってPR本文を生成する。

複数見つかった場合は、以下の優先順で選択する:

1. `.github/pull_request_template.md`
2. `.github/PULL_REQUEST_TEMPLATE.md`
3. その他の場所にあるもの

### Step 6: Check for Existing PR

現在のブランチに既存のPRがあるか確認する:

```bash
gh pr view --json url 2>/dev/null
```

PRが既に存在する場合は、ユーザーに通知する。追加コミットのプッシュでPRは自動更新されるため、PR作成をスキップして終了する。

### Step 7: Prepare PR Content

ベースブランチを検出し、PR情報を収集する:

```bash
# Detect base branch (reuse this in Step 8)
BASE_BRANCH=$(git remote show origin | grep 'HEAD branch' | awk '{print $NF}')

# Commit history against base
git log origin/${BASE_BRANCH}...HEAD --oneline

# Change summary
git diff origin/${BASE_BRANCH}...HEAD --stat
```

**テンプレートがある場合:** テンプレートの各セクションに沿って内容を埋める。

**テンプレートがない場合:** 以下のデフォルト形式を使用する:

```markdown
## Summary
<変更の要約を1〜3個の箇条書きで>

## Changes
<変更ファイルと内容の概要>

## Test Plan
- [ ] <テストの手順やチェック項目>
```

**PRタイトルのルール:**
- 70文字以内
- conventional commit形式: `<type>: <description>`
- 英語で記述

### Step 8: Create PR

基本的に確認不要で自動的にPRを作成する。ただし、変更が大きく複数の機能や不具合にまたがる場合のみ、PRタイトル・本文の確認を求めてよい。

**ドラフト判定:**
- デフォルトはドラフトPR（`--draft`）
- ユーザーがコマンド引数や会話の中で明示的に通常PRを指定した場合のみ通常PRにする
  - 例: `/git-workflow --no-draft`, 「ドラフトじゃなくていい」「レビュー依頼したい」等

```bash
gh pr create \
  --base "${BASE_BRANCH}" \
  --title "<PR title>" \
  --draft \
  --body "$(cat <<'EOF'
<PR body>
EOF
)"
```

作成後、PR URLをユーザーに表示する。

## Language

PRタイトル・本文・コミットメッセージの記述言語は、明示的な指定がない限り、そのリポジトリで主として使用されている言語に従う。

- リポジトリの既存コミット履歴（`git log`）、PR履歴、ドキュメントから主要言語を判定する
- 日本語リポジトリなら日本語、英語リポジトリなら英語で記述する
- ユーザーが言語を指定した場合はその指定に従う

## Rules

- 汎用ブランチへの直接プッシュは行わない。必ず新規ブランチを作成する
- ブランチ名・PR内容は基本的に自動決定する。変更が大きく複数の機能や不具合にまたがる場合のみ確認を求めてよい
- PRテンプレートが存在する場合は必ずそれに従う
- ドラフトPRをデフォルトとし、ユーザーが明示的に指定した場合のみ通常PRにする
- `git push --force` は絶対に使用しない
- PRのベースブランチはリモートのデフォルトブランチを自動検出する
- シークレットを含むファイルはコミットしない
- PR作成後は必ずURLを表示する
- 各ステップでエラーが発生した場合は即座に停止してユーザーに報告する

## Examples

### On main branch with new feature

```
1. Branch: main (generic branch)
2. Diff analysis → auto create branch: feat/add-password-reset
3. /commit → "feat: パスワードリセット機能を追加 @feat/add-password-reset"
4. Verify branch is not generic → push
5. PR template found → .github/pull_request_template.md
6. No existing PR → proceed
7. Collect diff and commits against base
8. gh pr create --draft --title "feat: add password reset functionality" ...
9. → https://github.com/user/repo/pull/42
```

### On feature branch with additional changes

```
1. Branch: feat/user-auth (not a generic branch)
2. Continue as-is
3. /commit → "fix: トークン検証のエッジケースを修正 @feat/user-auth"
4. Verify branch → push
5. PR already exists → notify user, skip PR creation
6. Done
```

### On feature branch, first PR

```
1. Branch: feat/user-auth (not a generic branch)
2. Continue as-is
3. /commit → "feat: ユーザー認証を実装 @feat/user-auth"
4. Verify branch → push
5. No PR template → use default format
6. No existing PR → proceed
7. Collect diff and commits
8. gh pr create --draft --title "feat: implement user authentication" ...
9. → https://github.com/user/repo/pull/43
```

### Explicit non-draft PR

```
User: /git-workflow --no-draft
1. ... (same workflow)
8. gh pr create --title "feat: ..." ...  (no --draft flag)
```
