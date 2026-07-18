---
name: funsion-review
description: 複数のLLM (このセッションの Claude 自身 + mmxcode/deepseek などの外部CLI) に同じレビュー依頼を並列で投げ、回答を統合 (fusion) して1つのレビュー結果にまとめる。有効なLLMはスキルディレクトリの llms.json で schema 指定付きで管理する。ユーザーが「フュージョンレビュー」「複数LLMでレビュー」「全モデルの意見を聞いて」と言ったとき、または /funsion-review を実行したときに使用。
---

# funsion-review — 複数LLM統合レビュー

同じレビュー依頼を複数のLLM (このセッションの Claude 自身を含む) に**並列**で投げ、回答を突き合わせて1つのレビュー結果に統合する。単一モデルのバイアス・見落としを、モデル間の合意/相違で補正するのが目的。

## 設定ファイル (有効LLMの管理)

有効なLLMの一覧は**このスキルディレクトリの `llms.json`** で管理する:

- 原本: `<repo>/skills/funsion-review/llms.json` (claude-code-settings レポ、Git管理)
- 実行時パス: `~/.claude/skills/funsion-review/llms.json` (setup.sh のシンボリックリンク経由で同一実体)

各エントリのフィールド:

| フィールド | 意味 |
|-----------|------|
| `name` | 短い識別子。出力ファイル名やレポートの見出しに使う |
| `provider` | プロバイダ/モデルの説明 (人間向け) |
| `enabled` | `true` のものだけ実行する。無効化はここを `false` にするだけ |
| `schema` | 実行方式 (下表)。これを見て起動方法を決める |
| `command` | 起動コマンド。`schema: self` では不要 |
| `timeout_ms` | Bash 実行時の timeout に使う値 |
| `notes` | モデルの特性・注意点 |

### schema の種類

| schema | 実行方法 |
|--------|---------|
| `self` | **このセッションの Claude 自身**がレビュアーの1人として直接レビューを書く。外部プロセスは起動しない |
| `claude-code` | Claude Code 互換 CLI (mmxcode / deepseek など)。`cat prompt.md \| <command> -p` で非対話実行し、stdout に回答が出る |
| `stdin` | 任意コマンド。`command` をそのまま実行し、stdin にプロンプト・stdout に回答 |

LLM の追加は llms.json にエントリを1つ足すだけ (Claude Code 互換 CLI なら `schema: "claude-code"` + コマンド名のみ)。編集はレポ側のファイルに対して行い、コミットする (シンボリックリンクなのでどちらのパスを編集しても実体は同じ)。

## 実行手順

### 1. 設定を読む

`~/.claude/skills/funsion-review/llms.json` を Read し、`enabled: true` のLLMだけを対象にする。有効なLLMが0個ならその旨を伝えて終了する。

### 2. レビュー対象と出力先を決める

引数から対象と出力モードを決定する:

| 引数 | 対象 | 出力モード |
|------|------|-----------|
| ローカル差分の指定 (「ローカル」「diff」「未コミット」など) | 未コミット変更 (`git diff HEAD` + untracked)。空なら `git diff main...HEAD` | **ローカルモード**: 統合レビューを tmp に `review.md` として生成 |
| PR番号 (`123` / `#123`) or PR URL | `gh pr view` でメタ情報、`gh pr diff` で差分を取得 | **PRモード**: PR の該当行へインラインコメントとして書き込み |
| なし | 会話の文脈から対象を読み取る (直前に書いたコード、議論中の設計など) | 文脈に応じて判断 (差分ならローカルモード相当) |
| なし & 文脈にも対象がない | ローカル差分にフォールバック | ローカルモード |

### 3. worktree を作る (レビュー環境の準備)

差分テキストだけ渡すと「既存コードの慣習に沿っているか」「既存ユーティリティの再実装ではないか」を判定できない。レビュー対象のコードが**全体として存在する worktree** を用意し、各レビュアーにそこを探索させる:

```bash
# PRモード: PR head を worktree に取り出す
git fetch origin pull/<N>/head
git worktree add --detach <tmp>/funsion-wt FETCH_HEAD

# ローカルモード: HEAD の worktree に未コミット差分を適用する
git worktree add --detach <tmp>/funsion-wt HEAD
git diff HEAD | git -C <tmp>/funsion-wt apply
git ls-files --others --exclude-standard | while read -r f; do
  mkdir -p "<tmp>/funsion-wt/$(dirname "$f")" && cp "$f" "<tmp>/funsion-wt/$f"
done
```

対象がコード差分でない場合 (設計方針の議論など) は worktree をスキップしてよい。

### 4. ガイドラインを収集する

worktree (とユーザー環境) から、レビュー基準になるドキュメント・設定を集める:

- リポジトリの `CLAUDE.md`、`.claude/rules/`、`CONTRIBUTING.md`、`docs/` 配下のスタイルガイド
- ユーザーのグローバルルール `~/.claude/rules/` (コーディングスタイル・セキュリティ基準など)
- lint / formatter 設定 (`.eslintrc*`, `biome.json`, `ruff.toml`, `.prettierrc*`, `.editorconfig` など) — ルールとして明文化された慣習

見つかったものは**要点をプロンプトに直接貼る** (長大なら関連セクションのみ抜粋し、全文はファイルパスを示して worktree 内で読ませる)。何も見つからなければ「明文化されたガイドラインなし。既存コードの慣習を基準とする」と明記する。

### 5. プロンプトを作る

共通プロンプトを scratchpad に1ファイル書く (例: `prompt.md`)。worktree の中には置かない:

```markdown
あなたは別AI (Claude) からレビューを依頼された独立レビュアーです。
追従せず、根拠を付けて批判的にレビューしてください。

# レビュー対象
<diff (全文)>

コード全体は <worktree絶対パス> にチェックアウト済み。
差分だけで判断せず、必要に応じてリポジトリ内を読んで判断すること (読み取りのみ。ファイルを変更しない)。

# このプロジェクトのガイドライン
<収集したスタイルガイド・ルールの要点。長いものはパスを提示>

# レビュー観点 (すべて確認すること)
1) ガイドライン遵守 — 上記ガイドライン・lint設定に反していないか
2) 慣習・暗黙ルールの踏襲 — 命名/ディレクトリ構成/エラーハンドリング/ログ等が既存コードのパターンと整合しているか (worktree 内の類似コードと比較)
3) DRY / 冗長ロジック — 既存ユーティリティ・共通処理の再実装や重複コードがないか (worktree 内を検索して確認)
4) セキュリティ — 秘匿情報のハードコード、インジェクション、入力検証漏れ、権限・認証の穴
5) パフォーマンス — N+1、ループ内の重い処理、不要な再計算、データ量が増えたときの挙動
6) ロジックバグ・エッジケース漏れ
7) テスト不足 — 変更に見合うテストがあるか

# 出力形式
指摘ごとに: 重要度 (CRITICAL/HIGH/MEDIUM/LOW) / 観点番号 / 場所 (file:line) / 内容 / 根拠
問題がなければ観点ごとに「指摘なし」と明言する
```

### 6. 並列実行

**外部LLM** (`schema: claude-code` / `stdin`) は、**1つの Bash 呼び出しにまとめず個別に** `run_in_background: true` で起動する:

```bash
# schema: claude-code の場合 — worktree を cwd にして起動 (リポジトリ探索を可能にする)
cd <tmp>/funsion-wt && cat <scratchpad>/prompt.md | <command> -p > <scratchpad>/out-<name>.md 2> <scratchpad>/err-<name>.log

# schema: stdin の場合
cd <tmp>/funsion-wt && cat <scratchpad>/prompt.md | <command> > <scratchpad>/out-<name>.md 2> <scratchpad>/err-<name>.log
```

- `timeout` には llms.json の `timeout_ms` を渡す
- 全LLMの起動を済ませてから完了を待つ (逐次実行しない)
- cwd を worktree にするのは、レビュアーにコード全体を探索させるためと、万一書き込まれても使い捨ての worktree で済ませるため

**`schema: self` (Claude 自身)** は、外部LLMを起動した直後・回答を読む**前**に、同じ prompt.md に対する自分のレビューを `<scratchpad>/out-claude.md` に書き切る。自分も worktree 内の類似コードとの比較・既存ユーティリティの検索まで行うこと。先に他モデルの回答を読むと引きずられて独立性が失われるため、順序を守ること。

### 7. 回収

完了通知を受けて `out-<name>.md` を読む。失敗・タイムアウト・空出力のLLMは**リトライせずスキップ**し、最終レポートに「N/M モデルが回答」と明記する。全滅した場合は `err-*.log` の内容を添えて報告する。

### 8. 統合 (fusion)

各モデルの指摘を突き合わせ、Claude 自身の判断を加えて統合する:

```markdown
# Fusion Review 結果 (回答: N/M モデル)

## 合意された指摘 (複数モデルが独立に指摘 — 信頼度高)
- [重要度] 内容 (指摘: claude, deepseek) — 判定: 妥当/誤検知、理由

## 単独指摘 (1モデルのみ — 要検証)
- [重要度] 内容 (指摘: mmx) — Claude が根拠をコード上で検証した結果

## モデル間で矛盾した点
- 論点 / 各モデルの立場 / Claude の裁定と根拠

## 最終判断
対応すべき指摘の優先順リスト。対応不要と判断した指摘は理由を明記
```

単独指摘・矛盾点は必ず Claude 自身がコードや事実に当たって裁定する。多数決を鵜呑みにしない (全員が同じ誤解をすることもある)。

### 9. 出力と後片付け

**ローカルモード**: 統合結果を tmp (セッションの scratchpad ディレクトリ、なければ `/tmp`) に `review.md` として書き出し、パスをユーザーに報告する。リポジトリ内には書かない。

**PRモード**: 統合結果を PR に**1つのレビュー**として投稿する。行を特定できる指摘は該当行へのインラインコメント、行を特定できない指摘と全体サマリー (回答モデル数・合意状況) はレビュー本文に入れる:

```bash
gh api repos/{owner}/{repo}/pulls/{number}/reviews --input review.json
```

```json
{
  "commit_id": "<PRのheadのSHA>",
  "event": "COMMENT",
  "body": "<サマリー + 行を特定できない指摘>",
  "comments": [
    { "path": "src/foo.ts", "line": 42, "side": "RIGHT", "body": "[HIGH] 内容 (指摘: claude, deepseek)" }
  ]
}
```

- `event` は `COMMENT` 固定 (approve / request changes の判断は人間に残す)
- 各コメントに指摘したモデル名を `(指摘: ...)` で付記する
- 対応不要と裁定した指摘は PR には書かず、チャットでの報告にのみ含める
- 投稿前に指摘件数と内容の要約をユーザーに見せる必要はない (このスキルは自律実行前提)。ただし投稿後にレビューURLを報告する

最後に worktree を片付ける:

```bash
git worktree remove --force <tmp>/funsion-wt
```

## 注意

- **read-only**: 外部LLMにファイルを書かせない。llms.json の command は read-only 前提のフラグを維持する
- **コスト**: 呼ぶたびに各社のAPI料金が発生する。本当に複数の目が必要な場面に絞る
- **設定変更はレポ側で**: llms.json を直接 `~/.claude/skills/` 配下の別ファイルとして作り直さない (Git 管理から外れる)
