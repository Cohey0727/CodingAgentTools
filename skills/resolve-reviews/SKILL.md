---
name: resolve-reviews
description: PRのレビューコメントを取得し、修正対応またはコメント返信を行う。PR番号・URLを受け取るか、直前に作成したPRを対象とする。ユーザーが「レビュー対応」「レビュー修正」と言ったとき、または /resolve-reviews を実行したときに使用。
---

# Resolve PR Review Comments

Fetch review comments from a pull request, make code fixes for valid feedback, and reply to comments that don't warrant changes.

## Workflow

### Step 1: Identify Target PR

入力に応じてPRを特定する:

**PR番号が指定された場合:**

```bash
# PR番号で直接取得
gh pr view <number> --json number,url,headRefName,baseRefName,title,state
```

**PR URLが指定された場合:**

URLからオーナー・リポジトリ・PR番号を抽出する。
例: `https://github.com/owner/repo/pull/123` → owner=`owner`, repo=`repo`, number=`123`

```bash
gh pr view <url> --json number,url,headRefName,baseRefName,title,state
```

**何も指定されていない場合:**

直前に作成したPRを対象とする:

```bash
# 現在のブランチのPRを確認
gh pr view --json number,url,headRefName,baseRefName,title,state 2>/dev/null

# なければ最新のPRを取得
gh pr list --author "@me" --state open --limit 1 --json number,url,headRefName,baseRefName,title
```

PRが見つからない場合はユーザーに通知して終了する。
PRがクローズ済みまたはマージ済みの場合はその旨を伝えて終了する。

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

**重要:** 未コミットの変更がある場合は、チェックアウトの前にユーザーに通知してスタッシュまたはコミットを提案する。変更を失わないよう、必ずチェックアウト前に確認する。

### Step 3: Fetch Review Comments

まずリポジトリのオーナー・リポジトリ名と自分のユーザー名を取得する:

```bash
# owner/repo を取得
gh repo view --json nameWithOwner -q '.nameWithOwner'

# 自分のユーザー名を取得（フィルタリング用）
gh api /user -q '.login'
```

`gh` CLI でレビューコメントを取得する（以下2つは並列実行可能）:

```bash
# レビューコメント（diff上のコメント）を取得
gh api repos/{owner}/{repo}/pulls/{number}/comments --paginate

# PR全体のレビュー（approve/request changes等）も確認
gh api repos/{owner}/{repo}/pulls/{number}/reviews --paginate
```

レビューコメントが存在しない場合はユーザーに通知して終了する。

**フィルタリング:**

1. **PENDING状態のレビューを除外する**: `reviews` の `state` が `PENDING` のものは未提出の下書きレビューなので無視する。`COMMENTED`、`CHANGES_REQUESTED`、`APPROVED` のレビューのみ対象とする。
2. **自分自身のコメントをスキップする**: `user.login` が自分のユーザー名と一致するコメントは対象外。
3. **既に返信済みのスレッドをスキップする**: コメントスレッド（`in_reply_to_id` で連結）の最後の返信が自分のユーザー名の場合、そのスレッドは対応済みとみなしスキップする。

**レビュワーの分類:**

各コメントの投稿者がAI（ボット）か人間かを判定する:

- **AIレビュワー**: `user.type` が `"Bot"` のユーザー（例: `github-actions[bot]`, `copilot-pull-request-reviewer[bot]`, `coderabbitai[bot]` 等）
- **人間レビュワー**: `user.type` が `"User"` のユーザー

この分類は Step 9 でスレッドをresolveするかどうかの判定に使用する。

各コメントについて以下の情報を抽出する:

- `id`: コメントID（返信時に使用）
- `path`: 対象ファイルパス
- `line` / `original_line`: 対象行番号
- `body`: コメント内容
- `user.login`: コメント投稿者
- `in_reply_to_id`: 返信先コメントID（スレッドの判定に使用）
- `diff_hunk`: 該当箇所のdiff

### Step 4: Analyze Each Comment

各レビューコメントについて以下の分析を行う:

1. **対象ファイルを読む**: `path` で指定されたファイルを Read ツールで読み込む
2. **コメント周辺のコードを理解する**: `diff_hunk` と行番号からコンテキストを把握する
3. **レビュー指摘の妥当性を判定する**:

**妥当と判定するケース:**

- バグ修正の指摘
- セキュリティ上の懸念
- パフォーマンス改善
- コーディング規約違反
- ロジックの誤り
- エラーハンドリングの不足
- テストの不足
- suggested changes（提案されたコード変更）

**妥当でないと判定するケース:**

- 好みの問題で合理的根拠がない
- プロジェクトの方針に反する指摘
- 既に別の方法で対処されている
- コンテキストを誤解している指摘
- スコープ外の大規模リファクタリング要求
- 指摘内容が不明瞭で判断できない

### Step 5: Present Analysis to User

全コメントの分析結果をユーザーに提示する:

```
PR #<number>: <title>
レビューコメント: <total>件

--- 修正対応するコメント (<count>件) ---

[1] @<reviewer> [Bot] - <file>:<line>
  コメント: <comment body (abbreviated)>
  対応方針: <what will be changed>
  → resolve: Yes（AIレビュワー）

[2] @<reviewer> - <file>:<line>
  コメント: <comment body (abbreviated)>
  対応方針: <what will be changed>
  → resolve: No（人間レビュワー）

--- 返信のみ行うコメント (<count>件) ---

[3] @<reviewer> [Bot] - <file>:<line>
  コメント: <comment body (abbreviated)>
  返信内容: <draft reply>
  → resolve: Yes（AIレビュワー）

[4] @<reviewer> - <file>:<line>
  コメント: <comment body (abbreviated)>
  返信内容: <draft reply>
  → resolve: No（人間レビュワー）
```

**ユーザーの確認を得てから次のステップに進む。**
ユーザーが個別のコメントについて対応方針を変更したい場合はそれに従う。

### Step 6: Apply Code Fixes

妥当と判定されたコメントに対して、コード修正を適用する:

1. 対象ファイルを Read で読む
2. Edit ツールで修正を適用する
3. 修正後のコードが正しいことを確認する

修正時の注意点:

- レビューコメントが `suggestion` ブロック（``suggestion` ... ``）を含む場合は、そのコードを正確に適用する
- 最小限の変更に留める（関連しないリファクタリングはしない）
- ファイルの既存スタイルに従う

### Step 7: Verify Changes

修正が正しく適用されたことを確認する:

```bash
# 変更内容を確認
git diff

# プロジェクトにリンター・型チェックがあれば実行を提案
# 例: npm run lint, npx tsc --noEmit, etc.
```

問題がある場合はユーザーに報告して修正する。

### Step 8: Commit and Push

変更をコミットしてプッシュする:

```bash
# 修正ファイルを個別にステージング
git add <file1> <file2> ...

# コミット
git commit -m "<type>: レビュー指摘に対応 @<branch-name>"

# プッシュ
git push origin <branch-name>
```

コミットメッセージの `<type>` はレビュー修正の内容に応じて選択する:

- バグ修正 → `fix`
- リファクタリング → `refactor`
- 複合的 → `chore`

### Step 9: Post Reply Comments and Resolve Threads

各レビューコメントに対して返信を投稿する:

**修正対応したコメントへの返信:**

```bash
gh api repos/{owner}/{repo}/pulls/comments/{comment_id}/replies \
  -X POST \
  -f body="修正しました。"
```

返信は簡潔に。修正内容が複雑な場合のみ補足を追加する。

**妥当でないと判定したコメントへの返信:**

```bash
gh api repos/{owner}/{repo}/pulls/comments/{comment_id}/replies \
  -X POST \
  -f body="<丁寧な理由の説明>"
```

返信は丁寧で建設的な表現を使う。決して攻撃的にしない。

**AIレビュワーのスレッドをresolveする:**

レビュワーがAI（`user.type == "Bot"`）の場合、返信後にスレッドをresolveする。
人間レビュワーのスレッドはresolveしない（人間自身が確認してresolveすべきため）。

resolveにはGraphQL APIを使用する。まず対象スレッドの `threadId` を取得し、`resolveReviewThread` ミューテーションを実行する:

```bash
# PR のレビュースレッド一覧を取得（threadId とコメントの対応を得る）
gh api graphql -f query='
  query($owner: String!, $repo: String!, $number: Int!) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $number) {
        reviewThreads(first: 100) {
          nodes {
            id
            isResolved
            comments(first: 1) {
              nodes {
                databaseId
              }
            }
          }
        }
      }
    }
  }
' -f owner="{owner}" -f repo="{repo}" -F number={number}
```

取得した `reviewThreads` から、AIレビュワーのコメントID（`databaseId`）に一致するスレッドの `id`（GraphQLのノードID）を特定する。

```bash
# スレッドをresolveする
gh api graphql -f query='
  mutation($threadId: ID!) {
    resolveReviewThread(input: {threadId: $threadId}) {
      thread {
        isResolved
      }
    }
  }
' -f threadId="{thread_node_id}"
```

**注意:**
- 人間レビュワーのスレッドは絶対にresolveしない
- 既にresolve済み（`isResolved: true`）のスレッドはスキップする
- レビューコメントが多数ある場合（10件以上）、GitHub APIのレート制限に注意する。必要に応じてリクエスト間に間隔を空ける。

### Step 10: Summary

完了後、対応結果のサマリーを表示する:

```
--- レビュー対応完了 ---
PR: #<number> <title>
修正コミット: <commit hash>
対応済み: <count>件
返信のみ: <count>件
Resolved: <count>件（AIレビュワーのスレッド）
未Resolve: <count>件（人間レビュワーのスレッド）
PR URL: <url>
```

## Language

返信コメントの言語は、レビューコメントの言語に合わせる:

- 英語でレビューされたら英語で返信する
- 日本語でレビューされたら日本語で返信する
- 混在している場合は英語をデフォルトとする

## Rules

- **コード修正後は必ず commit → push まで完了すること。修正だけして commit/push を忘れるのは厳禁。Step 6（修正）→ Step 7（確認）→ Step 8（commit & push）→ Step 9（返信）を必ず一連で実行する。**
- ユーザーの確認なしにコード修正を適用しない
- ユーザーの確認なしにコメントを投稿しない
- `suggestion` ブロックのコードは正確にそのまま適用する（改変しない）
- 修正はレビュー指摘の範囲に限定する（関連しない変更を入れない）
- `git add -A` や `git add .` は使用しない
- `git push --force` は絶対に使用しない
- 返信コメントは丁寧で建設的な表現を使う
- 自分自身のコメントには返信しない
- 既に返信済みのコメントスレッドはスキップする
- PRがマージ済み・クローズ済みの場合は操作を行わない
- セキュリティに関する指摘は常に妥当として扱い、優先的に対応する
- コミット前にローカルで変更を確認できるようにする
- AIレビュワー（`user.type == "Bot"`）のスレッドは返信後にresolveする
- 人間レビュワーのスレッドは絶対にresolveしない（人間自身が確認してresolveする）

## Examples

### PR番号を指定して実行

```
ユーザー: /resolve-reviews 42

1. gh pr view 42 → PR #42: feat: add user authentication
2. ブランチ feat/add-user-auth にチェックアウト
3. レビューコメント3件を取得
4. 分析結果を提示:
   [1] @reviewer - src/auth.ts:15 → 修正対応（バリデーション不足）
   [2] @reviewer - src/auth.ts:30 → 修正対応（エラーハンドリング）
   [3] @reviewer - src/utils.ts:5 → 返信のみ（好みの問題）
5. ユーザー確認 → 承認
6. src/auth.ts を修正
7. git add src/auth.ts && git commit && git push
8. 3件のコメントに返信を投稿
9. サマリー表示
```

### PR URLを指定して実行

```
ユーザー: /resolve-reviews https://github.com/user/repo/pull/42

→ 上記と同じフロー
```

### 指定なしで実行

```
ユーザー: /resolve-reviews

1. 現在のブランチのPRを検索 → PR #42 を発見
2. 以降同じフロー
```

### レビューコメントがない場合

```
ユーザー: /resolve-reviews 42

1. gh pr view 42 → PR #42
2. レビューコメントを取得 → 0件
3. 「レビューコメントはありません。」と通知して終了
```

### suggestion ブロックの対応

レビューコメントに以下のような suggestion ブロックが含まれる場合:

    ```suggestion
    const result = items.filter(item => item.active)
    ```

→ 該当行を suggestion のコードで正確に置換する。コードを改変せずそのまま適用する。
