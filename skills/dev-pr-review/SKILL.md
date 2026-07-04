---
name: dev-pr-review
description: in-review ラベルがついていないオープンPRを見つけてレビューする。git worktree でPRのコードをローカルに取得し、変更箇所以外との整合性・紐づくIssue通りの実装かを確認する。問題なければmerge、軽微な指摘なら修正してmerge、問題が多い場合はレビューを記述して pr-reviewed ラベルをつけ、見当違い・修正済みのPRは理由を記述してcloseする。PR番号・URLを引数に取るか、レビュー待ちのPRを自動で探す。ユーザーが「PRレビューして回して」「レビュー待ちPRを処理して」と言ったとき、または /dev-pr-review を実行したときに使用。
---

# Dev PR Review: PR選択 → worktree取得 → レビュー → merge / 修正merge / pr-reviewed / close

`in-review` ラベルのないPRを worktree 上でレビューし、状態に応じて merge・修正merge・レビュー記述・close のいずれかを行う。

## Workflow

### Step 1: 対象PRの特定と in-review 付与

**引数がある場合:** PR番号 / URL を対象にする。

**引数がない場合:**

```bash
# in-review も pr-reviewed もないオープンPR（ドラフト除く・古い順）
gh pr list --state open --json number,title,labels,isDraft,createdAt \
  --jq '[.[] | select(.isDraft | not) | select((.labels | map(.name) | any(. == "in-review" or . == "pr-reviewed")) | not)] | sort_by(.createdAt)'
```

- 最も古い1件を選ぶ。対象がない場合は「レビュー待ちのPRはない」と報告して終了
- 二重レビューを防ぐため、着手時に必ず `in-review` ラベルをつける:

```bash
gh label create in-review --color 1D76DB --description "レビュー作業中" 2>/dev/null || true
gh pr edit <number> --add-label in-review
```

### Step 2: PR情報と紐づくIssueの取得

```bash
gh pr view <number> --json title,body,commits,files,baseRefName,headRefName,statusCheckRollup,closingIssuesReferences
```

- `Closes #N` で紐づくIssueがあれば `gh issue view` で本文（設計・受け入れ条件・テスト観点）を取得する
- CI（statusCheckRollup）が失敗している場合はレビュー観点に含める

### Step 3: worktree でコードを取得

```bash
git fetch origin

# PRのブランチを worktree に取得
git worktree add ../<repo>-pr-<number>
cd ../<repo>-pr-<number> && gh pr checkout <number>
```

以降のコード確認・テスト実行はすべて worktree 内で行い、元の作業ディレクトリは変更しない。

### Step 4: レビュー

以下の観点で確認する:

1. **Issue適合性** — 紐づくIssueの設計・受け入れ条件・テスト観点通りに実装されているか。スコープ外の変更が混ざっていないか
2. **変更箇所自体の品質** — バグ・エッジケース漏れ・エラーハンドリング・セキュリティ（入力検証・シークレット混入）
3. **変更箇所以外との整合性** — 変更された関数・型・APIの呼び出し元をGrepで洗い出し、影響が波及していないか。既存の規約・パターンと一貫しているか
4. **テスト** — テストが追加されているか、テスト観点を網羅しているか。worktree内で実際にテストを実行してPASSを確認する

```bash
# 変更されたシンボルの利用箇所を必ず確認する
git diff origin/main...HEAD --stat
```

### Step 5: 判定と対応

#### (a) 問題なし → merge

```bash
gh pr merge <number> --squash --delete-branch
```

- マージ方式はリポジトリの許可設定（`gh repo view --json squashMergeAllowed,mergeCommitAllowed,rebaseMergeAllowed`）と既存PRの慣例に従う。判断できなければ squash
- CIが未完了の場合は完了を待ってからmergeする（`--auto` は使わず結果を確認する）

#### (b) 指摘が軽微 → サクッと修正して merge

typo・命名・小さなエッジケース・テスト不足など、設計に影響しない指摘のみの場合:

1. worktree 内で修正し、conventional commit 形式でコミット
2. テストを再実行してPASSを確認
3. `git push` してCIを確認
4. 修正内容をPRコメントに記載してから merge（(a)と同じ手順）

#### (c) 問題が多い → レビュー記述 + pr-reviewed

設計上の問題・複数のバグ・Issueとの乖離など、修正判断が必要な場合:

```bash
gh pr review <number> --request-changes --body "$(cat <<'EOF'
## レビュー結果

<全体評価>

### 指摘事項

1. `path/to/file.ts:123` — <問題点と修正案>
2. ...
EOF
)"

gh label create pr-reviewed --color D93F0B --description "レビュー指摘あり・対応待ち" 2>/dev/null || true
gh pr edit <number> --add-label pr-reviewed
```

指摘は必ずファイルパス・行番号つきで具体的に書き、修正案を添える。

#### (d) あまりに見当違い・既に修正済み → close + 紐づくIssueの状態リセット

- 紐づくIssueと無関係な内容、mainに既に同等の修正が入っている、などの場合:

```bash
gh pr close <number> --comment "<closeの理由と根拠（該当コミット・PRへの参照）>"
```

**紐づくIssueの後処理（必須）:** PRをcloseするとIssueは自動クローズされないため、`closingIssuesReferences` のIssueを放置しない:

- **Issueの内容が既にmainで解決済みの場合:** Issueにも根拠をコメントして `gh issue close` する
- **Issueは有効だが実装が見当違いだった場合:** Issueの `WIP` ラベルを外して実装待ちキューに戻す（`WIP` を残すと dev-issue-implement が永久にスキップし、Issueが宙に浮く）:

```bash
gh issue edit <issue-number> --remove-label WIP
gh issue comment <issue-number> --body "PR #<number> は<理由>のためcloseした。実装待ちに戻す。"
```

### Step 6: 後片付けと報告

```bash
git worktree remove ../<repo>-pr-<number> --force
```

対象PR・判定（merged / fixed+merged / pr-reviewed / closed）・指摘概要をユーザーに報告する。

## Rules

- 着手時に必ず `in-review` ラベルをつける（二重レビュー防止）
- **レビューを完了できずに中断・失敗する場合は、必ず `in-review` ラベルを外してから報告する。** `in-review` が残ると次回以降誰にも拾われないPRになる（判定(c)で `pr-reviewed` をつけた場合は正常終了なので外さなくてよい — dev-pr-review-resolve が拾う）
- PRをcloseする場合は紐づくIssueを必ず後処理する（`WIP` 解除 or Issueもclose）。処理しないとIssueが実装待ちキューから永久に外れる
- レビューは必ず worktree で実コードを取得して行う。diffだけで判断しない
- 変更箇所の呼び出し元・依存箇所を必ずGrepで確認する（変更箇所以外との整合性チェック）
- merge前に必ずテスト実行とCIのPASSを確認する。テストが失敗しているPRはmergeしない
- (b)の「軽微な修正」で設計変更・大きなリファクタリングを行わない。迷ったら(c)にする
- closeは見当違い・修正済みが明確な場合のみ。迷う場合はcloseせず(c)でレビューを残す
- `git push --force` は使用しない
- 自分（このセッション）で作成した直後のPRをレビューする場合も、必ず worktree で取得し直して客観的に確認する
