# claude-code-settings 作業ルール

## グローバル指示の編集ルール

**グローバルな作業ルールはこのレポの `AGENTS.md` が唯一の正。** `~/.claude/CLAUDE.md` / `~/.pi/agent/AGENTS.md` / `~/.codex/AGENTS.md` は `make setup` が貼るシンボリックリンクであり、原本ではない。`~/.claude/rules/` は廃止済みで復活させない（内容は `AGENTS.md` に統合）。

`AGENTS.md` に書いてよいのは**契約（non-negotiables）だけ**。全セッションに常時注入されるため、説明・背景・コード例・ツール一覧を足すと全プロジェクトのトークンを恒久的に食う。特定条件でだけ必要な知識は `skills/` に切り出し、description だけを常駐させる。

## スキル追加・変更時の絶対ルール

**スキルは必ずこのレポの `skills/` 配下に作成する。`~/.claude/skills/` にも `~/.agents/skills/` にも直接書くな。**

正しい手順:

1. `skills/<skill-name>/SKILL.md` をこのレポ内に作成・編集する
2. レポルートで `make setup` を実行してシンボリックリンクを反映する

`~/.claude/skills/<skill-name>/` と `~/.agents/skills/<skill-name>/` はあくまで `make setup` が貼るシンボリックリンクの置き場所であり、原本ではない。直接編集・作成すると Git 管理外になり、レポ同期が壊れる。

### やってはいけない例

- `~/.claude/skills/foo/SKILL.md` を直接 Write する
- `~/.agents/skills/foo/SKILL.md` を直接 Write する
- レポに置かずに `~/.claude/skills/` だけで完結させる
- スキル追加・変更後に `make setup` を実行し忘れる

### 反映コマンド

```bash
make setup
```

`skills/` 配下の各スキルと `agents/` 配下の各サブエージェントを、`~/.claude/`（Claude Code）と `~/.agents/`（Codex ほかのエージェント CLI）の両方にシンボリックリンクで配置する。スキル追加・変更後は必ず実行する。
