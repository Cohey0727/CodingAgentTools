---
name: codex
description: ローカルにインストール済みの Codex CLI (OpenAI) を使って、別 LLM からのコードレビュー・セカンドオピニオン・意見交換を取得する。Claude が書いたコードに対して「別モデルの目」を入れたいとき、設計判断で複数モデルの見解を突き合わせたいとき、`codex` / `/codex` と言われたときに使用。
---

# Codex CLI Usage

このマシンには `codex-cli` (`/Users/kohei/.bun/bin/codex`) が入っており、`~/.codex/config.toml` で `gpt-5.5` + `model_reasoning_effort = "xhigh"` がデフォルト設定されている。Claude Code (このセッション) から別 LLM の意見を取るための「セカンドオピニオン」ツールとして使う。

## いつ使うか

- **コードレビュー**: Claude が書いた diff に対し、別モデルの観点でレビューを得たい
- **意見交換 / セカンドオピニオン**: 設計判断・ライブラリ選定・アルゴリズムの妥当性などで他モデルの見解が欲しい
- **盲点チェック**: Claude が出した結論にバイアス・見落としがないか別系統で検証したい

逆に **使わないほうがいい**: 単純な質問・自分で十分判断できる作業・既に並列の Claude agent を回している場合 (重複)。

## 基本コマンド

### 1. 非対話で一発質問する (意見交換の主用途)

```bash
codex exec -s read-only "ここに質問やレビュー依頼を書く"
```

- `exec` = ワンショット実行。stdout に最終回答が出る
- `-s read-only` = サンドボックスを read-only にして、勝手にファイルを書かせない (意見を聞くだけの用途では必須)
- プロンプトを stdin から渡す場合: `cat prompt.md | codex exec -s read-only -`
- プロンプト + stdin 両方を渡すと stdin は `<stdin>` ブロックとして追加される

最後のメッセージだけファイルに書き出したい場合:

```bash
codex exec -s read-only -o /tmp/codex-answer.md "..."
```

JSON で構造化イベントを取りたい場合:

```bash
codex exec --json -s read-only "..." > events.jsonl
```

### 2. コードレビュー (`codex review`)

`codex review` は専用のレビュー用サブコマンド。デフォルトで現在の repo の差分を対象にレビューを返す。

```bash
# 未コミット変更 (staged + unstaged + untracked) をレビュー
codex review --uncommitted

# main からの差分をレビュー
codex review --base main

# 特定コミットのレビュー
codex review --commit <sha>

# レビュー観点を指定する (例: セキュリティ重点)
codex review --uncommitted "セキュリティとエラーハンドリングを重点的に見て"
```

PR を出す前のセルフチェックや、Claude が書いた直後の差分の別目チェックに最適。

### 3. 対話モード (TUI)

```bash
codex                  # 新規セッション
codex resume --last    # 直前のセッション再開
codex fork --last      # 直前のセッションから分岐
```

Claude Code から呼ぶときは基本 `exec` を使う (TUI は人間用)。

## Claude Code から呼ぶときの定型パターン

### パターン A: セカンドオピニオン

Claude が結論を出した直後、別モデルの見解を取りに行く。

```bash
codex exec -s read-only "$(cat <<'EOF'
私 (別 AI) は以下の方針で実装しようとしている。これに反対する立場で論点を出してほしい。
盲点・見落とし・代替案を遠慮なく指摘してほしい。

# 背景
<タスクの背景>

# 提案中の方針
<Claude の結論>

# 制約
<制約条件>
EOF
)"
```

ポイント:
- **反対意見を明示的に求める** (同意を求めると追従しがちなので)
- **役割を明示** (「別 AI からのレビュー依頼」と書くと真面目に検証してくれる)
- ヒアドキュメントで複雑なプロンプトを安全に渡す

### パターン B: diff レビュー

```bash
# 未コミットの変更を別モデルにレビューさせる
codex review --uncommitted "以下の観点でレビューして: 1) ロジックバグ 2) エッジケース漏れ 3) テスト不足 4) 命名"
```

結果を見て Claude 側で対応の要不要を判断する。Codex の指摘を鵜呑みにせず、根拠を確認すること。

### パターン C: 設計判断の突き合わせ

A 案 vs B 案で迷ったとき、両案を提示して Codex の評価を取る。

```bash
codex exec -s read-only "$(cat <<'EOF'
以下の 2 案で迷っている。トレードオフを整理し、推奨案とその理由を述べてほしい。

## 案 A
<内容>

## 案 B
<内容>

## 評価軸
- 保守性
- パフォーマンス
- 実装コスト
EOF
)"
```

## オプション早見表

| オプション | 用途 |
|-----------|------|
| `-s read-only` | 読み取りのみ。意見を聞くだけなら必須 |
| `-s workspace-write` | ファイルを書かせたいとき (Codex に実装させる場合) |
| `-m <model>` | モデル切替 (デフォルトは `gpt-5.5`) |
| `-c key=value` | config 上書き。例: `-c model_reasoning_effort=high` |
| `--search` | Web 検索を有効化 |
| `-o <file>` | 最終メッセージをファイル出力 |
| `--json` | イベントを JSONL で出力 (パース用) |
| `-C <dir>` | 作業ディレクトリ指定 |
| `--skip-git-repo-check` | git repo 外でも動かす |

## 注意

- **Codex に勝手にファイルを書かせない**: 意見交換目的なら必ず `-s read-only`。デフォルトは `workspace-write` で書き込み可能なので注意
- **Codex の指摘を盲信しない**: あくまでセカンドオピニオン。最終判断は Claude (このセッション) が行う
- **長時間ブロックする可能性**: `model_reasoning_effort = "xhigh"` 設定なので 1〜3 分かかることがある。Bash の `timeout` 引数を伸ばすか、長い質問は `run_in_background: true` で投げる
- **秘匿情報**: プロンプトは OpenAI に送られる。社外秘・秘密鍵などを含めない
- **コスト**: 呼ぶたびに OpenAI API 料金が発生する。本当に別モデルの目が必要な場面に絞る

## 設定ファイル

`~/.codex/config.toml`:

```toml
model = "gpt-5.5"
model_reasoning_effort = "xhigh"
hide_agent_reasoning = true
network_access = true

[tools]
web_search = true
```

一時的にモデルや reasoning を変えたいときは `-c` で上書き:

```bash
codex exec -s read-only -m gpt-4.1 -c model_reasoning_effort=medium "..."
```
