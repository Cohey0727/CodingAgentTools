---
name: resolve-pr
description: PRの残タスク（CI失敗とレビューコメント）をまとめて解決する。内部的に resolve-ci と resolve-reviews を順に呼び出す。PR番号・URLを受け取るか、現在のブランチのPRを対象とする。ユーザーが「PR対応」「PR残タスク」「PR解決」と言ったとき、または /resolve-pr を実行したときに使用。
---

# Resolve PR Remaining Tasks

PRの残タスクを一括で解決する。CI失敗とレビューコメントの両方をまとめて対応するためのオーケストレーションスキル。

## Workflow

### Step 1: Identify Target PR

入力に応じてPRを特定する。引数（PR番号 / URL / なし）はそのまま下流のスキルに引き継ぐ。

```bash
# PR番号 or URL が指定されていればそれを使う
# 何も指定されていなければ現在のブランチのPRを対象とする
gh pr view [<number-or-url>] --json number,url,headRefName,title,state
```

PRが見つからない場合はユーザーに通知して終了する。

### Step 2: Resolve CI Failures

`resolve-ci` スキルを起動する。同じPRを対象として実行する。

- CI失敗があれば、resolve-ci のワークフローに従って調査・修正・コミット・プッシュ・再監視まで完了させる
- 全てのCIが成功状態になるまで待つ（または環境依存・flaky で人間の対応が必要な状態に到達するまで）
- 全てSUCCESSなら次のステップへ進む

**重要:** resolve-ci がコミット＆プッシュを行った場合、後続の resolve-reviews 実行前にローカルブランチが最新であることを確認する。

### Step 3: Resolve Review Comments

`resolve-reviews` スキルを起動する。Step 1 で特定した同じPRを対象として実行する。

- レビューコメントを取得し、resolve-reviews のワークフローに従って修正対応または返信を行う
- レビューコメント対応で新たなコミットがプッシュされた場合、CIが再実行される可能性がある

### Step 4: Re-check CI After Review Fixes

Step 3 でコード修正がコミットされた場合のみ、再度 `resolve-ci` を起動して新たに失敗したCIがないか確認する。

- 新規失敗がなければ完了
- 失敗があれば resolve-ci のワークフローで解決する
- このループは「CI全成功 かつ 未対応レビューなし」になるまで続ける（ただし環境依存・人手介入が必要な状態に到達したら停止して報告する）

### Step 5: Final Report

最終結果をユーザーに報告する:

```
--- PR残タスク解決完了 ---
PR: #<number> <title>
CI最終ステータス: <all passed / N failed (env/flaky)>
レビュー対応: <fixed count> 件修正 / <replied count> 件返信
未対応事項: <list if any>
PR URL: <url>
```

## Rules

- このスキルは薄いオーケストレーション層であり、独自のロジックは持たない。実際の修正・コミット・プッシュ・監視は resolve-ci / resolve-reviews のワークフローに従う
- 各下流スキルのルール（コミット必須、`git push --force` 禁止、`git add .` 禁止 等）はそのまま適用される
- CI → レビューの順で実行する。理由: CI失敗のままレビュー対応するとコンフリクトや無駄な再実行が発生しやすいため
- 下流スキルが「ユーザー確認待ち」の状態で停止した場合は、その時点で全体を停止し、ユーザーに状況を伝える
- 下流スキルが軽微な修正と判定したものは確認なしで進めてよい（resolve-ci / resolve-reviews のルールに準ずる）

## Language

ユーザーへの報告は、ユーザーの言語に合わせる（日本語依頼なら日本語、英語依頼なら英語）。

## Examples

### PR番号を指定して実行

```
ユーザー: /resolve-pr 42

1. gh pr view 42 → PR #42 を特定
2. resolve-ci 42 を実行
   → 2件の失敗を修正・コミット・プッシュ・CI再実行監視 → 全成功
3. resolve-reviews 42 を実行
   → レビューコメント3件、2件は修正、1件は返信
4. 修正コミットがあったので resolve-ci 42 を再実行
   → 新規失敗なし
5. 最終レポートを提示
```

### 現在のブランチのPRを対象に実行

```
ユーザー: /resolve-pr

1. gh pr view → 現在のブランチのPR #58 を特定
2. resolve-ci → CIは全て成功 → スキップ
3. resolve-reviews → 1件修正、0件返信
4. resolve-ci 再実行 → 全成功
5. 最終レポート
```

### CIが環境依存で停止

```
ユーザー: /resolve-pr 70

1. resolve-ci 70 → DATABASE_URL 未設定で停止（environment）
2. ユーザーに状況を報告して停止
   （resolve-reviews は実行しない or ユーザーの判断に委ねる）
```
