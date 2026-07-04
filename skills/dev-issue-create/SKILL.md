---
name: dev-issue-create
description: 引数や会話の文脈中のトピック（機能要望・バグ・改善案・設計課題）をもとに、gh CLI で現在のリポジトリに開発Issueを作成する。mainを最新化した上でコードベースを調査し、設計・実現可能性・必要な修正箇所・テスト観点を構造化して記述する。工数は記述しない。トピックが大きすぎる場合は適切な粒度に分割して複数Issueを作成する。ユーザーが「Issue作って」「イシュー化して」「課題登録して」と言ったとき、または /dev-issue-create を実行したときに使用。
---

# Dev Issue Create: main最新化 → 調査 → 設計記述 → Issue作成

引数または会話の文脈からトピックを特定し、現行コードベースに基づく調査・設計・実現可能性・テスト観点を記述した開発Issueを `gh` で作成する。

## Workflow

### Step 1: リポジトリ確認と main の最新化

以下を並列で実行してコンテキストを収集する:

```bash
# リポジトリの確認
gh repo view --json nameWithOwner,hasIssuesEnabled

# 利用可能なラベル
gh label list --limit 50

# Issueテンプレートの検索
ls .github/ISSUE_TEMPLATE/ 2>/dev/null

# リモートの最新を取得
git fetch origin
```

**mainの最新化:**

- 作業ツリーがクリーンで main ブランチにいる場合: `git pull --ff-only`
- main 以外のブランチにいる、または未コミット変更がある場合: ブランチは切り替えず `git fetch origin` のみ行い、調査は `origin/main` の内容（`git show origin/main:<path>` / `git diff HEAD origin/main --stat`）を基準にする。ローカルの状態は変更しない

**中断条件:**

- git リポジトリでない、または GitHub リモートがない場合は通知して終了
- Issues が無効化されている場合は通知して終了
- 引数も文脈上のトピックもない場合は、何をIssue化したいかユーザーに確認

### Step 2: トピック分析とコードベース調査

トピックからIssueの種別を判定する:

| 種別 | 判定基準 | ラベル候補 |
|------|---------|-----------|
| feature | 新機能・機能追加の要望 | `enhancement` |
| bug | 不具合・期待と異なる動作 | `bug` |
| refactor | 内部構造の改善・技術的負債 | `refactoring`, `tech-debt` |
| design | 設計判断・アーキテクチャ検討 | `design`, `discussion` |
| docs | ドキュメント整備 | `documentation` |

**コードベース調査（最新のmainに対して）:** Grep / Glob / Read で以下を必ず把握する:

1. **関連する既存実装** — ファイルパス・関数名・現在の挙動
2. **必要な修正箇所** — 現行コードベースに対してどのファイル・モジュールにどんな変更が必要か
3. **既存の類似パターン** — 実装方針の参考になる既存コード
4. **実現可能性** — 現在のアーキテクチャ・依存ライブラリで実現できるか、障害になる制約はないか
5. **テスト観点** — 既存のテスト構成（フレームワーク・配置）と、このIssueで必要になるテストの種類・ケース

憶測でファイルパスや実装方針を書かず、実際に確認した内容のみ記載する。

**重複チェック:**

```bash
gh issue list --search "<キーワード>" --state all --limit 10
```

類似Issueが見つかった場合はユーザーに提示し、新規作成するか既存に追記するか確認する。

### Step 3: 分割判定

以下のいずれかに該当する場合、複数Issueへの分割を検討する:

- 複数の独立した機能・修正が混在している
- 1つのトピックだが実装フェーズが明確に分かれる（例: 基盤 → 各チャネル対応）
- 1 Issueで完結させるとPRが巨大になることが明らか（目安: 想定変更ファイルが10を大きく超える、複数サブシステムにまたがる）

**分割の原則:**

- 各Issueは独立してクローズ可能な単位にする（1 Issue ≒ 1〜数PR）
- 依存関係は本文に `Depends on #<number>` / `Blocked by #<number>` を明記
- 3個以上に分割する場合は親Issue（トラッキングIssue）を作成し、タスクリスト形式で子Issueをリンク

分割する場合はIssue作成前に分割案をユーザーに提示して確認する。分割不要なら確認せず進む。

### Step 4: Issue本文の作成

Issueテンプレートがあればその構造に従う。なければ種別に応じたデフォルト形式を使用する。

**共通ルール: 工数・所要時間・難易度の見積もりは一切記述しない。**

#### feature / refactor / design

```markdown
## 概要

<何を実現したいか、なぜ必要かを1〜3段落で>

## 背景・課題

<現状の問題点、このIssueが生まれた文脈>

## 調査結果

<現行コードベース（main最新）の関連実装の状況。`path/to/file.ts` の `functionName()` 形式で具体的に>

## 設計・実装方針

<調査に基づく実装アプローチ>

## 必要な修正箇所

- `path/to/file.ts` — <どんな変更が必要か>
- <新規作成が必要なファイルがあればそれも>

## 実現可能性

<現アーキテクチャで実現可能か。制約・リスク・技術的な懸念点。代替案があれば記載>

## テスト観点

- [ ] <ユニットテスト: 対象関数と主要ケース>
- [ ] <統合/E2Eテスト: 必要な場合>
- [ ] <エッジケース・エラーパス>

## 受け入れ条件

- [ ] <完了と判断できる具体的な条件>
```

#### bug

```markdown
## 概要

<どんな不具合か1〜2文で>

## 再現手順

1. <手順>

## 期待する動作 / 実際の動作

- 期待: <期待する動作>
- 実際: <実際の動作>

## 原因調査

<コード調査でわかった原因・怪しい箇所。`path/to/file.ts:123` 形式で記載>

## 修正方針と必要な修正箇所

- `path/to/file.ts` — <修正内容>

## テスト観点

- [ ] 再現ケースの再発防止テスト
- [ ] <周辺のエッジケース>

## 受け入れ条件

- [ ] <修正確認の条件>
```

**タイトルのルール:** conventional commit 形式 `<type>: <description>`、70文字以内。

### Step 5: Issue作成

ラベルが未作成の場合は先に作成する（Step 1 の `gh label list` の結果で判定）:

```bash
# 例: 種別ラベルが存在しない場合は作成してから付与する
gh label create enhancement --color A2EEEF --description "新機能・機能追加" 2>/dev/null || true
gh label create bug --color D73A4A --description "不具合" 2>/dev/null || true
gh label create refactoring --color E4E669 --description "内部構造の改善" 2>/dev/null || true
gh label create design --color C5DEF5 --description "設計判断・アーキテクチャ検討" 2>/dev/null || true
gh label create documentation --color 0075CA --description "ドキュメント整備" 2>/dev/null || true
```

作成するのは実際に付与するラベルのみでよい（全種を毎回作る必要はない）。

```bash
gh issue create \
  --title "<title>" \
  --label "<label>" \
  --body "$(cat <<'EOF'
<body>
EOF
)"
```

- 付与するラベルが未作成なら必ず `gh label create` してから `--label` に指定する
- 複数Issueは依存される側（基盤）から順に作成し、後続の本文に実番号で `Depends on #N` を記載
- 親Issueは子Issueを先に作成してからタスクリスト（`- [ ] #N`）に反映

### Step 6: 結果報告

作成した全IssueのURLと、分割した場合は依存関係の概要を提示する。

## Language

Issueのタイトル・本文は、明示的な指定がない限りリポジトリの主要言語（既存Issue・コミット履歴・READMEから判定）に従う。

## Rules

- 必ず main を最新化（またはorigin/main基準で調査）してからコードベースを調査する
- 本文には確認済みの事実のみ記載する。憶測のファイルパスや実装方針を断定調で書かない
- **工数・所要時間・難易度の見積もりは記述しない**
- 分割する場合は作成前に分割案をユーザーに提示して確認する。単一Issueなら確認不要で作成してよい
- 既存の類似Issueが見つかった場合は必ずユーザーに提示してから進む
- ラベルが未作成の場合は `gh label create` で作成してから付与する（存在しないラベルを `--label` に指定するとエラーになる）
- ローカルに未コミット変更がある場合、ブランチ切り替えや変更破棄は絶対に行わない
- 作成後は必ずIssue URLを表示する
