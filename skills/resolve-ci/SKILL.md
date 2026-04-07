---
name: resolve-ci
description: PRのCIが失敗している原因を調査し、報告・修正する。PR番号・URLを受け取るか、現在のブランチのPRを対象とする。ユーザーが「CI修正」「CI直して」「ビルド失敗」と言ったとき、または /resolve-ci を実行したときに使用。
---

# Resolve Failed CI

PRの失敗しているCIジョブを調査し、原因を特定して修正する。

## Workflow

### Step 1: Identify Target PR

入力に応じてPRを特定する:

**PR番号が指定された場合:**

```bash
gh pr view <number> --json number,url,headRefName,baseRefName,title,state,statusCheckRollup
```

**PR URLが指定された場合:**

URLからオーナー・リポジトリ・PR番号を抽出する。
例: `https://github.com/owner/repo/pull/123` → owner=`owner`, repo=`repo`, number=`123`

```bash
gh pr view <url> --json number,url,headRefName,baseRefName,title,state,statusCheckRollup
```

**何も指定されていない場合:**

現在のブランチのPRを対象とする:

```bash
# 現在のブランチのPRを確認
gh pr view --json number,url,headRefName,baseRefName,title,state,statusCheckRollup 2>/dev/null

# なければ最新のPRを取得
gh pr list --author "@me" --state open --limit 1 --json number,url,headRefName,baseRefName,title
```

PRが見つからない場合はユーザーに通知して終了する。

### Step 2: Checkout PR Branch

PRのブランチに切り替える（まだの場合）:

```bash
CURRENT=$(git branch --show-current)
PR_BRANCH=<headRefName from Step 1>

if [ "$CURRENT" != "$PR_BRANCH" ]; then
  # 未コミットの変更を先に確認する
  git status --porcelain

  # 変更がなければチェックアウト
  git checkout "$PR_BRANCH"
  git pull origin "$PR_BRANCH"
fi
```

**重要:** 未コミットの変更がある場合は、チェックアウトの前にユーザーに通知してスタッシュまたはコミットを提案する。

### Step 3: Identify Failed CI Jobs

`statusCheckRollup` から失敗しているジョブを特定する:

```bash
# CIステータスの詳細を取得
gh pr checks <number> --json name,state,description,detailsUrl
```

各チェックの `state` を確認する:

- `FAILURE` / `ERROR` → 調査対象
- `SUCCESS` → スキップ
- `PENDING` / `QUEUED` → 実行中として報告

失敗しているジョブがない場合は「全てのCIが成功しています」と通知して終了する。

### Step 4: Fetch CI Logs

失敗している各ジョブのログを取得する:

```bash
# GitHub Actions の場合: ワークフローランの一覧を取得
gh run list --branch <headRefName> --limit 5 --json databaseId,name,status,conclusion,headSha

# 失敗しているランのログを取得
gh run view <run-id> --log-failed
```

**注意:** `--log-failed` は失敗したステップのログのみを出力するため効率的。ログが長すぎる場合はBashで末尾を取得する:

```bash
gh run view <run-id> --log-failed 2>&1 | tail -200
```

複数のワークフローが失敗している場合は、それぞれのログを取得する。

外部CI（CircleCI, Jenkins等）で `gh run` が使えない場合は、`detailsUrl` をユーザーに提示して手動確認を依頼する。

### Step 5: Analyze Failure Causes

各失敗ジョブのログを分析し、根本原因を特定する:

**よくある失敗パターン:**

| カテゴリ | 例 |
|---------|-----|
| ビルドエラー | TypeScript型エラー、コンパイルエラー、依存関係の問題 |
| テスト失敗 | ユニットテスト、E2Eテスト、スナップショットの不一致 |
| リント/フォーマット | ESLint違反、Prettier不一致、スタイルチェック |
| セキュリティ | 脆弱性スキャン、シークレット検出 |
| デプロイ | 環境変数の不足、権限エラー |
| インフラ | Flaky test、タイムアウト、リソース不足 |

各失敗について以下を判定する:

1. **修正可能（fixable）**: コード変更で解決できる
2. **環境依存（environment）**: CI設定・シークレット・権限の問題でコード変更では解決不可
3. **一時的（flaky）**: 再実行で解決する可能性がある

### Step 6: Present Analysis to User

全失敗ジョブの分析結果をユーザーに提示する:

```
PR #<number>: <title>
CI Status: <passed>/<total> checks passed

--- 失敗しているジョブ (<count>件) ---

[1] <job-name> (FAILURE)
  原因: <root cause description>
  カテゴリ: <ビルドエラー|テスト失敗|リント|...>
  修正可能性: <fixable|environment|flaky>
  対応方針: <what will be changed>
  該当ファイル: <file:line if applicable>

[2] ...

--- 実行中のジョブ (<count>件) ---
- <job-name> (PENDING)

--- 成功しているジョブ (<count>件) ---
- <job-name> (SUCCESS)
```

**ユーザーの確認を得てから次のステップに進む。**

ただし、以下の「軽微な修正」に該当する場合は確認不要で即座に修正・コミットに進む:
- フォーマット（Prettier、コードスタイル）
- リント自動修正（`--fix` で解決するもの）
- コメントの修正（typo、不要なコメント削除）
- インポート順序の修正
- 末尾の空白・改行の修正

### Step 7: Apply Fixes

修正可能（fixable）と判定された失敗に対して、コード修正を適用する:

1. 対象ファイルを Read で読む
2. Edit ツールで修正を適用する
3. 修正後のコードが正しいことを確認する

**修正パターン別の対応:**

**ビルドエラー（TypeScript）:**
- 型エラーを修正する
- 不足しているインポートを追加する
- 型定義を修正する

**テスト失敗:**
- テストの期待値が正しいか確認する
- テスト対象のコードにバグがある場合はコードを修正する（テストではなく）
- スナップショットの更新が必要な場合はその旨を報告する

**リント/フォーマット:**
- プロジェクトのリンター・フォーマッターをローカルで実行する:

```bash
# 例: プロジェクトに応じて適切なコマンドを選択
npm run lint -- --fix
npm run format
npx prettier --write <files>
```

**環境依存・flaky の場合:**
- 修正は行わない
- 環境依存: 必要な設定変更をユーザーに報告する
- flaky: 再実行を提案する:

```bash
gh run rerun <run-id> --failed
```

### Step 8: Verify Fixes Locally

修正が正しいことをローカルで確認する:

```bash
# 変更内容を確認
git diff

# プロジェクトのビルド・テスト・リントを実行（該当するもの）
# package.json の scripts を確認して適切なコマンドを選択する
```

ローカルで同じエラーが再現・解消されることを確認する。問題がある場合は追加修正する。

### Step 9: Commit and Push

変更をコミットしてプッシュする:

```bash
# 修正ファイルを個別にステージング
git add <file1> <file2> ...

# コミット
git commit -m "<type>: CI失敗を修正 @<branch-name>"

# プッシュ
git push origin <branch-name>
```

コミットメッセージの `<type>` は修正内容に応じて選択する:

- 型エラー・ビルド修正 → `fix`
- テスト修正 → `test`
- リント・フォーマット → `style`
- 複合的 → `fix`

### Step 10: Monitor Re-run

プッシュ後、CIの再実行状況を約2分おきに監視する。全ジョブが完了するまで繰り返す:

```bash
# 約2分おきにCIステータスを確認（全ジョブ完了まで繰り返す）
gh pr checks <number>
```

**監視ループ:**

1. `gh pr checks <number>` でステータスを確認する
2. まだ `PENDING` / `QUEUED` / `IN_PROGRESS` のジョブがある場合:
   - 現在の状況をユーザーに簡潔に報告する（例: `3/5 passed, 2 in progress...`）
   - 約2分待機してから再度確認する
3. 全ジョブが完了したら最終結果を報告する
4. 新たに失敗したジョブがあれば、Step 4 に戻って再分析・修正を行う

**再失敗時の対応:**

修正後のCIで再び失敗が発生した場合:
1. 新たな失敗ログを取得・分析する（Step 4-5）
2. 分析結果をユーザーに提示する（Step 6）
3. ユーザーの確認を得て修正を適用する（Step 7-8）
4. コミット＆プッシュする（Step 9）
5. 再度監視を開始する（Step 10）

このサイクルを全CIが成功するまで繰り返す。

最終結果をユーザーに報告する:

```
--- CI修正完了 ---
PR: #<number> <title>
修正コミット: <commit hash>
修正した失敗: <count>件
環境依存（未修正）: <count>件
最終CIステータス: <all passed / N failed>
PR URL: <url>
```

## Language

ユーザーへの報告は、ユーザーの言語に合わせる:

- 日本語で依頼されたら日本語で報告する
- 英語で依頼されたら英語で報告する

コミットメッセージの記述言語は、リポジトリの既存コミット履歴に従う。

## Rules

- **コード修正後は必ず commit → push まで完了すること。修正だけして commit/push を忘れるのは厳禁。Step 7（修正）→ Step 8（ローカル確認）→ Step 9（commit & push）→ Step 10（CI監視）を必ず一連で実行する。**
- ユーザーの確認なしにコード修正を適用しない（ただし軽微な修正 — フォーマット、リント自動修正、コメント、インポート順序、空白修正 — は確認不要で即座にコミットする）
- 修正はCI失敗の解決に必要な最小限の変更に留める
- テスト失敗の場合、まずコード側のバグを疑う（テストを安易に変更しない）
- `git add -A` や `git add .` は使用しない
- `git push --force` は絶対に使用しない
- flaky testの場合は再実行を優先し、テストの無効化やスキップは提案しない
- セキュリティスキャンの失敗は最優先で対応する
- CI設定ファイル（`.github/workflows/*.yml`等）の変更は慎重に行い、必ずユーザーに確認する
- 環境変数・シークレットの不足が原因の場合は、値を推測せずユーザーに確認する
- ログにシークレットが含まれている可能性がある場合は、その内容を出力に含めない

## Examples

### PR番号を指定して実行

```
ユーザー: /resolve-ci 42

1. gh pr view 42 → PR #42: feat: add user authentication
2. ブランチ feat/add-user-auth にチェックアウト
3. gh pr checks 42 → 2件失敗
   - "Build" (FAILURE)
   - "Lint" (FAILURE)
4. gh run view <id> --log-failed → ログ取得
5. 分析結果を提示:
   [1] Build - TypeScript型エラー src/auth.ts:15
   [2] Lint - ESLint unused-vars src/utils.ts:30
6. ユーザー確認 → 承認
7. src/auth.ts と src/utils.ts を修正
8. ローカルでビルド・リント確認
9. git add src/auth.ts src/utils.ts && git commit && git push
10. CI再実行中 → PR URL表示
```

### Flaky testの場合

```
ユーザー: /resolve-ci 55

1. gh pr view 55 → PR #55
2. gh pr checks 55 → 1件失敗
   - "E2E Tests" (FAILURE)
3. ログ分析 → タイムアウトエラー、コード起因ではない
4. 分析結果を提示:
   [1] E2E Tests - flaky (タイムアウト)
   → 再実行を提案
5. ユーザー確認 → 再実行
6. gh run rerun <id> --failed
7. 再実行中 → URL表示
```

### 環境依存の失敗

```
ユーザー: /resolve-ci 70

1. gh pr view 70 → PR #70
2. gh pr checks 70 → 1件失敗
   - "Deploy Preview" (FAILURE)
3. ログ分析 → 環境変数 DATABASE_URL が未設定
4. 分析結果を提示:
   [1] Deploy Preview - environment (DATABASE_URL missing)
   → コード修正では解決不可。CI/CDの環境変数設定が必要
5. ユーザーに設定変更を案内して終了
```

### CIが全て成功している場合

```
ユーザー: /resolve-ci 42

1. gh pr view 42 → PR #42
2. gh pr checks 42 → 全てSUCCESS
3. 「全てのCIが成功しています。」と通知して終了
```
