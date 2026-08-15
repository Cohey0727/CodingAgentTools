# claude-code-settings

Claude Code のスキル・サブエージェント・設定を管理するリポジトリ。

## セットアップ

```bash
git clone <this-repo>
cd claude-code-settings
make setup
```

`make setup` は 3 種類のファイルを各エージェント CLI が読む場所にシンボリックリンクで配置します。

### グローバル指示 (`AGENTS.md`)

グローバルな作業ルールは **`AGENTS.md` 1 ファイルが正**です。各 CLI が期待する名前でリンクします。

| リンク先 | 読むツール |
|----------|-----------|
| `~/.claude/CLAUDE.md` | Claude Code（AGENTS.md をネイティブに読まないため CLAUDE.md の名前で貼る） |
| `~/.pi/agent/AGENTS.md` | pi |
| `~/.codex/AGENTS.md` | Codex |

プロジェクト直下の `CLAUDE.md` は pi も読む（pi は各ディレクトリで `AGENTS.md` または `CLAUDE.md` を読む）ため、二重管理が必要なのはグローバルだけです。opencode はグローバル指示を `~/.config/opencode/opencode.jsonc` の `instructions` 配列で指定する方式なので、必要なら `~/Workspace/claude-code-settings/AGENTS.md` を追加してください。

### スキル・サブエージェント

`skills/` 配下の各スキルと `agents/` 配下の各サブエージェントを、以下の 2 箇所に配置します。

| 配置先 | 読むツール |
|--------|-----------|
| `~/.claude/skills/` | Claude Code, opencode |
| `~/.claude/agents/` | Claude Code |
| `~/.agents/skills/` | Codex, opencode, pi |
| `~/.agents/agents/` | （現状どの CLI も読まない。ミラーとして貼っているだけ） |

`~/.agents/skills/` はベンダー中立の置き場所で、pi は `~/.pi/agent/skills/` と並べて、opencode は `~/.claude/skills/` と並べて、Codex は自身のスキルルートとして読む。サブエージェントだけは共通規約がなく、各 CLI が独自の場所（Codex は `~/.codex/agents/*.toml`、opencode は `~/.config/opencode/agent/*.md`、pi は subagent 拡張）を使う。

`make setup` の `checks` セクションに、実際に PATH 上にある読み手が表示される。

リンクの挙動:

- 既存のシンボリックリンク → 張り直す
- 既存の実ファイル・実ディレクトリ → スキップ（絶対に上書きしない）
- 何もない → 作成

実体はレポ内のファイルなので、スキルを編集すればその場で反映されます。スキルを**追加・削除・リネーム**した後は `make setup` を再実行してください。

## make ターゲット

| コマンド | 内容 |
|----------|------|
| `make setup` | `~/.claude` と `~/.agents` にリンクを張る（引数なしの `make` も同じ） |
| `make list` | 管理下のスキル・サブエージェントと、その導入状況を一覧表示 |
| `make uninstall` | このレポを指すシンボリックリンクだけを削除 |
| `make help` | ターゲット一覧 |

スキルの一覧は `make list` で確認できます（README には転記しません）。

## ディレクトリ構成

```
claude-code-settings/
├── README.md
├── AGENTS.md         # グローバル作業ルール（全 CLI 共通の正）
├── CLAUDE.md         # このレポでの作業ルール
├── Makefile          # エントリポイント
├── bin/
│   ├── common.sh     # 配置先・配色・共通ヘルパー
│   ├── setup.sh      # make setup
│   ├── list.sh       # make list
│   ├── uninstall.sh  # make uninstall
│   └── help.sh       # make help
├── agents/
│   └── <name>.md     # サブエージェント定義
└── skills/
    └── <name>/
        └── SKILL.md  # スキル定義
```
