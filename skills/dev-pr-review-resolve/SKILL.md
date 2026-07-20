---
name: dev-pr-review-resolve
description: reviewed ラベルがついたPRを見つけて、レビュー指摘事項を検討・修正する。着手時に in-review ラベルで排他する。妥当な指摘は worktree 上で修正し、反論がある場合は根拠をコメントに記述して、各レビュースレッドをresolveしていく。すべてのレビューをresolveしたら必ずmergeする。PR番号・URLを引数に取るか、対応待ちのPRを自動で探す。ユーザーが「レビュー指摘を解消して」「reviewedのPRを片付けて」と言ったとき、または /dev-pr-review-resolve を実行したときに使用。
---

# Dev PR Review Resolve: PR選択 → 指摘検討 → 修正 or 反論 → 全resolve → merge

`reviewed` ラベルのPRの指摘事項を1件ずつ検討し、修正または根拠付き反論でresolveした上で、必ずmergeまで完了させる。

## Workflow

### Step 1: 対象PRの特定

**引数がある場合:** PR番号 / URL を対象にする。ただし既に `in-review` がついている場合は別プロセスが対応中のため、着手せずその旨を報告して終了する。

**引数がない場合:**

```bash
# reviewed 付き・in-review なしのオープンPR（古い順）
gh pr list --state open --label reviewed --json number,title,labels,createdAt \
  --jq '[.[] | select((.labels | map(.name) | contains(["in-review"])) | not)] | sort_by(.createdAt)'
```

最も古い1件を選ぶ。対象がない場合は「対応待ちのPRはない」と報告して終了。

**対象が決まったら、他のどの作業よりも先に `in-review` ラベルをつける**（二重対応防止）:

```bash
gh label create in-review --color 1D76DB --description "レビュー作業中" 2>/dev/null || true
gh pr edit <number> --add-label in-review
```

### Step 2: 指摘事項の収集

レビューコメント（PR全体レビュー + インラインコメント）をすべて取得する:

```bash
# レビュー本文
gh pr view <number> --json reviews,body,closingIssuesReferences

# インラインのレビュースレッド（未resolveのもの）
gh api graphql -f query='
query($owner: String!, $repo: String!, $pr: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $pr) {
      reviewThreads(first: 100) {
        nodes {
          id
          isResolved
          path
          line
          comments(first: 10) { nodes { body author { login } } }
        }
      }
    }
  }
}' -f owner=<owner> -f repo=<repo> -F pr=<number>
```

指摘を一覧化し、それぞれを「修正する / 反論する」に分類する準備をする。

**CIが実行済みの場合は必ず結果を確認する:**

```bash
gh pr checks <number>
```

失敗しているチェックがあれば `gh run view <run-id> --log-failed` でログを確認し、レビュー指摘と合わせて対応対象に含める。

### Step 3: worktree でコードを取得

```bash
git fetch origin
git worktree add ../<repo>-pr-<number>
cd ../<repo>-pr-<number> && gh pr checkout <number>
```

以降の修正・テストはすべて worktree 内で行う。

### Step 4: 指摘事項の検討と対応

各指摘について現行コードを確認した上で判断する:

#### (a) 指摘が妥当 → 修正

1. worktree 内で修正し、conventional commit 形式でコミット（指摘単位か関連する指摘のまとまり単位）
2. 該当スレッドに対応内容を返信する（どのコミットで直したかを明記）

#### (b) 指摘に反論がある → 根拠を記述

修正しない判断をする場合は、必ず根拠をコメントに記述する:

- なぜ現状の実装が正しい/望ましいのか（仕様・既存パターン・トレードオフ）
- 参照すべきコード・ドキュメント・Issueの記載

感覚的な反論はしない。根拠を示せない指摘は (a) として修正する。

#### スレッドのresolve

対応（修正コミット or 反論コメント）を書き込んだスレッドから順にresolveする:

```bash
# 返信
gh api graphql -f query='
mutation($threadId: ID!, $body: String!) {
  addPullRequestReviewThreadReply(input: {pullRequestReviewThreadId: $threadId, body: $body}) {
    comment { id }
  }
}' -f threadId=<thread-id> -f body="<対応内容 or 反論>"

# resolve
gh api graphql -f query='
mutation($threadId: ID!) {
  resolveReviewThread(input: {threadId: $threadId}) {
    thread { isResolved }
  }
}' -f threadId=<thread-id>
```

インラインでないレビュー本文の指摘には、PRコメントで指摘番号ごとの対応表（修正コミット / 反論理由）を返信する。

### Step 5: テストとPush

```bash
# テスト実行（リポジトリのテストコマンドを検出）
npm test 等

git push
```

- 全テストPASSとCIのグリーンを確認する
- 修正によって新たに必要になったテストがあれば追加する

### Step 6: merge（必須）

すべてのスレッドがresolve済みであることを確認してからmergeする:

```bash
# 未resolveスレッドが0件であることを確認（Step 2のクエリを再実行）

gh pr merge <number> --squash --delete-branch

# merge成功後にのみラベルを外す（tidiness）
gh pr edit <number> --remove-label reviewed --remove-label in-review 2>/dev/null || true
```

- マージ方式はリポジトリの許可設定・慣例に従う（判断できなければ squash）
- **このスキルの終了条件はmerge完了。** resolveだけして放置しない
- **`reviewed` を外すのは必ずmerge成功後。** merge前に外すと、mergeがブロックされた場合にこのPRが dev-pr-review（reviewed付きは対象外）にも dev-pr-review-resolve（reviewed が入口条件）にも拾われなくなり、キューから消失する
- mergeがブロックされた場合（branch protection・CI失敗・必須approve不足）は、`reviewed` を**つけたまま** `in-review` だけ外し、状況と必要なアクションをユーザーに報告して終了する（次回実行時に再度拾える状態を維持する）

### Step 7: 後片付けと報告

```bash
git worktree remove ../<repo>-pr-<number> --force

# mergeした場合: worktree用に作られたローカルブランチが残っていれば削除する
# <headRefName> はPRのブランチ名（gh pr view <number> --json headRefName で取得できる）
git branch -D <headRefName> 2>/dev/null || true
```

対応した指摘の一覧（修正 / 反論の内訳）・merge結果をユーザーに報告する。

## Rules

- 対象PRが決まったら一番最初に `in-review` ラベルをつける（二重対応防止）。既に `in-review` がついているPRには着手しない（引数で明示指定された場合も同様）
- **対応を完了できずに中断・失敗する場合は、`reviewed` は維持したまま `in-review` だけ外してから報告する**（`in-review` が残ると誰にも拾われないPRになる）
- すべての指摘に対応（修正 or 根拠付き反論）してからresolveする。無言resolve・一括resolveはしない
- 反論には必ず具体的な根拠（コード・仕様・既存パターン）を示す。示せなければ修正する
- CIが実行済みの場合は必ず `gh pr checks` で結果を確認する。失敗があればログまで確認して対応対象に含める
- 修正後は必ずテストを実行し、PASSとCIグリーンを確認してからmergeする
- すべてのスレッドをresolveしたら必ずmergeする。branch protection等でmerge不能な場合のみユーザーに報告して終了
- `reviewed` ラベルを外すのはmerge成功後のみ。merge失敗時は `reviewed` を維持して再実行可能な状態を保つ
- `git push --force` は使用しない
- 指摘対応の範囲を超えるスコープ外の変更を混ぜない
- mergeしたPRのローカルブランチ（`gh pr checkout` で作成されたもの）は後片付けで必ず削除する。リモートは `--delete-branch` で消えるがローカルには残るため
