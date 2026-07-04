---
name: dev-issue-review
description: 現在のリポジトリの開発Issueが妥当かどうかをレビューする。リポジトリの目的に沿っているか、調査内容・設計に問題がないかをチェックし、WebSearch や Parallel Search MCP で裏取りして本文を追記・修正する。問題なければ issue-reviewed ラベルをつけ、あまりに見当違いな場合は理由を記述してcloseする。Issue番号・URLを引数に取るか、未レビューのIssueを自動で探す。ユーザーが「Issueレビュー」「Issueの妥当性チェック」と言ったとき、または /dev-issue-review を実行したときに使用。
---

# Dev Issue Review: 妥当性チェック → 裏取り調査 → 追記修正 → ラベル付与

Issueの内容がリポジトリの目的・現行コードベースに照らして妥当かをレビューし、調査で裏取りした上で `issue-reviewed` ラベルをつける。

## Workflow

### Step 1: 対象Issueの特定

**引数がある場合:** Issue番号 / URL をそのまま対象にする。

**引数がない場合:** 未レビューのオープンIssueを探す:

```bash
# issue-reviewed / WIP / needs-info のいずれもついていないオープンIssue（古い順）
gh issue list --state open --json number,title,labels,createdAt \
  --jq '[.[] | select((.labels | map(.name) | any(. == "issue-reviewed" or . == "WIP" or . == "needs-info")) | not)] | sort_by(.createdAt)'
```

- 対象が複数ある場合は最も古いものから1件を選ぶ（ユーザーが「全部」と言った場合は順に処理）
- 対象がない場合は「未レビューのIssueはない」と報告して終了
- `needs-info` はユーザー確認待ちの保留マーカー。自動選択からは除外するが、**引数で明示指定された場合はレビューする**（ユーザーが疑問に回答した後の再レビュー経路）。疑問が解消していれば `needs-info` を外して通常の判定に進む

### Step 2: リポジトリの目的とIssue内容の把握

```bash
gh issue view <number> --json title,body,labels,comments
```

並行して README・CLAUDE.md・docs/ からリポジトリの目的・スコープを把握する。

### Step 3: 妥当性チェック

以下の観点で評価する:

1. **目的適合性** — このリポジトリのスコープに沿っているか。別リポジトリでやるべき内容ではないか
2. **調査内容の正確性** — 本文に書かれたファイルパス・関数名・現状の挙動が実際のコードベース（最新main基準、`git fetch origin` してから確認）と一致しているか
3. **設計の妥当性** — 実装方針が現行アーキテクチャと整合しているか。より良い既存パターンを見落としていないか
4. **実現可能性** — 前提としているライブラリ・APIが実在し、意図した用途に使えるか
5. **完全性** — 受け入れ条件・テスト観点が欠けていないか

### Step 4: 外部調査（裏取り）

設計判断や技術選定に不確かな点がある場合、WebSearch や Parallel Search MCP（利用可能な場合）で裏取りする:

- ライブラリ・APIの現在の仕様・メンテナンス状況・既知の問題
- 提案されているアプローチのベストプラクティス・アンチパターン
- セキュリティ上の懸念（既知の脆弱性など）

調査結果は出典URL付きでレビュー内容に反映する。

### Step 5: 判定と対応

#### (a) 妥当（軽微な補足含む）→ 追記・修正して issue-reviewed

- 誤りや不足があれば `gh issue edit <number> --body ...` で本文を修正する。元の本文の構造は保ち、変更点はコメントで要約する
- 追加の調査結果・補足はコメントとして残す:

```bash
gh issue comment <number> --body "$(cat <<'EOF'
## レビュー結果

<妥当性の評価サマリー>

### 補足・修正点

- <追記した内容と根拠（出典URL）>
EOF
)"
```

- ラベルを付与する（なければ作成）:

```bash
gh label create issue-reviewed --color 0E8A16 --description "レビュー済みで実装可能なIssue" 2>/dev/null || true
gh issue edit <number> --add-label issue-reviewed
```

#### (b) 問題が大きい → 修正してから issue-reviewed、または needs-info で保留

- 設計の方向性は正しいが調査・設計に大きな誤りがある場合: 本文を修正・再設計してコメントで変更理由を説明し、issue-reviewed をつける
- 判断にユーザーの意思決定が必要な場合（スコープの選択・仕様の曖昧さ）: 確認事項をコメントに記載し、`needs-info` ラベルをつけてユーザーに報告する（ラベルなしで放置すると次回の自動選択で同じIssueを再レビューし続けるため）:

```bash
gh label create needs-info --color D4C5F9 --description "ユーザーの回答待ち" 2>/dev/null || true
gh issue edit <number> --add-label needs-info
```

ユーザーが回答したら `/dev-issue-review <number>` で明示的に再レビューし、解消していれば `needs-info` を外して `issue-reviewed` をつける。

#### (c) あまりに見当違い → close

以下に該当する場合は理由をコメントに記述してcloseする:

- リポジトリの目的と無関係
- 既に実装済み・解決済み
- 技術的に実現不可能で代替案もない

```bash
gh issue close <number> --comment "<closeの理由と根拠>"
```

### Step 6: 結果報告

対象Issue・判定結果（reviewed / 要確認 / closed）・追記修正の概要をユーザーに提示する。

## Rules

- 本文の修正は最小限にし、元の作成者の意図を消さない。大きく書き換える場合はコメントに変更理由を残す
- コードベースの事実確認は必ず最新main（`git fetch origin` 後の `origin/main`）を基準にする
- 外部調査の結果を反映する場合は出典URLを必ず記載する
- closeは「見当違い」が明確な場合のみ。迷う場合はcloseせず `needs-info` で保留してユーザーに確認する
- `issue-reviewed` / `needs-info` ラベルが存在しない場合は自動作成する
- 工数・所要時間の見積もりは追記しない
- レビュー中のIssueに `WIP` ラベルがついている場合は実装中なのでスキップする
