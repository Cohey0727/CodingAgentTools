---
name: dev-hotl
description: dev 系パイプライン (PRレビュー / レビュー対応 / Issue実装 / Issueレビュー) を人間の確認なしで1タスク自律実行する。「devパイプライン回して」「自律で開発回して」と言われたときに使用。
---

# Dev HOTL: main最新化 → 優先順で対象探索 → 該当スキルを1つ実行

HOTL = Human Out of The Loop。ユーザーへの確認・保留を挟まず、dev系パイプラインのうち今やるべきタスクを1つ選んで完遂する。

## Workflow

### Step 0: main の最新化（必須・最初に実行）

他のどの作業よりも先に実行する:

```bash
git checkout main && git pull
```

- 未コミットの変更があって checkout できない場合は、変更内容を報告して終了する（勝手に stash・破棄しない）

### Step 1: 優先順に対象を探索

以下の順で対象を探し、**最初に見つかった段階で確定**して Step 2 に進む。後続の探索は行わない。

#### 優先度1: レビュー指摘対応待ちPR → dev-pr-review-resolve

```bash
# reviewed 付き・in-review なしのオープンPR（古い順）
gh pr list --state open --label reviewed --json number,title,labels,createdAt \
  --jq '[.[] | select((.labels | map(.name) | contains(["in-review"])) | not)] | sort_by(.createdAt)'
```

#### 優先度2: レビュー待ちPR → dev-pr-review

```bash
# in-review も reviewed もないオープンPR（ドラフト除く・古い順）
gh pr list --state open --json number,title,labels,isDraft,createdAt \
  --jq '[.[] | select(.isDraft | not) | select((.labels | map(.name) | any(. == "in-review" or . == "reviewed")) | not)] | sort_by(.createdAt)'
```

#### 優先度3: 実装待ちIssue → dev-issue-implement

```bash
# reviewed 付き・WIP なしのオープンIssue（古い順）
gh issue list --state open --label reviewed --json number,title,labels,body,createdAt \
  --jq '[.[] | select((.labels | map(.name) | contains(["WIP"])) | not)] | sort_by(.createdAt)'
```

#### 優先度4: 未レビューIssue → dev-issue-review

```bash
# reviewed / in-review / WIP / needs-info のいずれもついていないオープンIssue（古い順）
gh issue list --state open --json number,title,labels,createdAt \
  --jq '[.[] | select((.labels | map(.name) | any(. == "reviewed" or . == "in-review" or . == "WIP" or . == "needs-info")) | not)] | sort_by(.createdAt)'
```

- すべて空の場合は「対応可能なタスクはない」と報告して終了

### Step 2: 該当スキルの実行

確定した対象の番号を引数にして、対応するスキルを Skill ツールで起動する（例: `dev-pr-review` に `#123`）。各スキルのワークフロー（排他ラベル付与・worktree・テスト・merge/close 判断）はそのスキルの定義に従う。

### Step 3: 報告

実行したスキル・対象番号・結果（merged / resolved+merged / PR作成 / reviewed / closed など）をユーザーに報告する。

## 解決済みIssueのclose（全ステップ共通）

探索・処理のどの段階でも、**既に解決済みのIssue**（mainに同等の修正が入っている、対象機能が削除済み、重複Issueが解決済み、など）を見つけたら、根拠を添えてcloseする:

```bash
gh issue close <number> --comment "<解決済みと判断した理由。該当コミット・PR・コードへの具体的な参照を含める>"
```

- 理由なしのcloseは禁止。必ず根拠（コミットハッシュ・PR番号・ファイルパス）をコメントに書く
- 解決済みか確信が持てない場合はcloseしない

## Rules

- **`git checkout main && git pull` を必ず最初に実行する。** 探索も判断もすべて最新のmainを前提にする
- **needs-info は禁止。** ユーザーへの質問・確認待ちで保留にせず、コードベース・Issue履歴・WebSearch で裏取りして自律判断する。それでも判断できない場合は `needs-info` をつけるのではなく、判断できなかった理由を報告して終了する
- 優先順は固定: dev-pr-review-resolve → dev-pr-review → dev-issue-implement → dev-issue-review。レビュー系（1・2）が常に実装・Issue整備より優先
- 1回の実行で処理するのは原則1タスク。ユーザーが「続けて」「全部」と言った場合は Step 0 から繰り返す
- 各スキル実行中の排他ラベル運用（in-review / WIP）・中断時のラベル解除は、そのスキルの Rules に従う
- 解決済みIssueのcloseは根拠必須。迷ったらcloseしない
