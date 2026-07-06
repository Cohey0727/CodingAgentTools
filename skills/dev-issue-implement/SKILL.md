---
name: dev-issue-implement
description: reviewed ラベルがついたIssueを見つけて実装する。対象Issueに WIP ラベルをつけ、git worktree で main を汚さずに開発し、テストがPASSすることを確認した上でIssueに紐づくPR（Closes #N）を作成する。Issue番号・URLを引数に取るか、実装待ちのIssueを自動で探す。ユーザーが「Issue実装して」「reviewedのIssueを開発して」と言ったとき、または /dev-issue-implement を実行したときに使用。
---

# Dev Issue Implement: Issue選択 → WIP → worktree開発 → テスト → PR作成

`reviewed` ラベルのついたIssueを worktree 上で実装し、テストPASSを確認してIssue紐づけPRを作成する。

## Workflow

### Step 1: 対象Issueの特定

**引数がある場合:** Issue番号 / URL を対象にする。ただし既に `WIP` がついている場合は別プロセスが実装中のため着手せず、その旨を報告して終了する。`reviewed` がついていない場合はその旨を伝え、続行するかユーザーに確認する。

**引数がない場合:**

```bash
# reviewed 付き・WIP なしのオープンIssue（古い順）
gh issue list --state open --label reviewed --json number,title,labels,body,createdAt \
  --jq '[.[] | select((.labels | map(.name) | contains(["WIP"])) | not)] | sort_by(.createdAt)'
```

- 最も古い1件を選ぶ。ただし本文に `Depends on #N` / `Blocked by #N` があり、その依存Issueが未クローズの場合はスキップして次を選ぶ
- 対象がない場合は「実装待ちのIssueはない」と報告して終了

### Step 2: WIPラベル付与

他のセッション・エージェントとの二重着手を防ぐため、着手前に必ずつける:

```bash
gh label create WIP --color FBCA04 --description "実装作業中" 2>/dev/null || true
gh issue edit <number> --add-label WIP
```

### Step 3: worktree のセットアップ

main ブランチを汚さないため、必ず worktree で作業する:

```bash
git fetch origin

# ブランチ名は git-workflow と同じ規約: feat/ fix/ refactor/ chore/ docs/ test/
git worktree add ../<repo>-issue-<number> -b <type>/<short-description> origin/main
```

- worktree のパスはリポジトリの外（隣接ディレクトリ）に作る
- 以降の実装・テストはすべて worktree 内で行う。元の作業ディレクトリのファイルは変更しない
- 依存インストールが必要な場合（node_modules 等）は worktree 内で実行する

### Step 4: 実装

Issueの「設計・実装方針」「必要な修正箇所」に従って実装する:

1. Issue本文を精読し、受け入れ条件・テスト観点を実装のチェックリストにする
2. Issue記載の設計が現行コードと食い違う場合（レビュー後にコードが変わった等）は、現行コードに合わせて調整し、判断内容をPR本文に記録する
3. **テストファースト:** Issueのテスト観点に対応するテストを先に書き、実装してPASSさせる
4. コミットは意味のある単位で分割し、conventional commit 形式（`<type>: <description>`）で書く

**実装中に設計の根本的な問題が判明した場合:** 実装を中断し、Issueにコメントで問題点を記載して WIP ラベルを外し、ユーザーに報告する。

### Step 5: テスト実行

リポジトリのテストコマンドを検出して実行する（package.json の scripts、Makefile、CI設定 `.github/workflows/` から判定）:

```bash
# 例: プロジェクトに応じて
npm test / pnpm test / cargo test / pytest / go test ./...
```

- **全テストがPASSするまでPRを作成しない**
- lint / typecheck / format のCIチェックがある場合はそれも実行して通す
- 既存テストが実装前から失敗している場合は、その失敗が自分の変更と無関係であることを確認し、PR本文に明記する

### Step 6: Push と PR作成

```bash
git push -u origin <branch-name>

gh pr create \
  --base main \
  --title "<type>: <description>" \
  --body "$(cat <<'EOF'
## Summary

<変更の要約>

Closes #<issue-number>

## Changes

<変更ファイルと内容の概要>

## Test Plan

- [x] <実行したテストと結果>
EOF
)"
```

- 本文に必ず `Closes #<issue-number>` を入れてIssueと紐づける（マージ時に自動クローズされる）
- PRテンプレート（`.github/pull_request_template.md` 等）があればそれに従い、`Closes #N` を追加する

### Step 7: 後片付けと報告

```bash
git worktree remove ../<repo>-issue-<number>
```

- push済みなら worktree は削除してよい（ブランチはリモートに残る）
- PR URL・実行したテスト結果・Issueとの対応をユーザーに報告する
- Issueの WIP ラベルはつけたままにする（PRマージでIssueが自動クローズされる）

## Rules

- 必ず worktree で作業し、元の作業ディレクトリ・mainブランチを一切変更しない
- 着手時に必ず WIP ラベルをつける。既に `WIP` がついているIssueには着手しない（引数で明示指定された場合も同様）。中断・失敗時は WIP ラベルを外してからユーザーに報告する
- テストが全てPASSするまでPRを作成しない。テストを削除・スキップして通すことは絶対にしない
- PR本文に必ず `Closes #<issue-number>` を含める
- `git push --force` は使用しない
- 依存Issue（Depends on）が未クローズのIssueには着手しない
- シークレットを含むファイルはコミットしない
- Issueに書かれていないスコープ外の変更を混ぜない
