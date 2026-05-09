# claude-code-settings 作業ルール

## スキル追加・変更時の絶対ルール

**スキルは必ずこのレポの `skills/` 配下に作成する。`~/.claude/skills/` に直接書くな。**

正しい手順:

1. `skills/<skill-name>/SKILL.md` をこのレポ内に作成・編集する
2. レポルートで `./setup.sh` を実行してシンボリックリンクを反映する

`~/.claude/skills/<skill-name>/` はあくまで `setup.sh` が貼るシンボリックリンクの置き場所であり、原本ではない。直接編集・作成すると Git 管理外になり、レポ同期が壊れる。

### やってはいけない例

- `~/.claude/skills/foo/SKILL.md` を直接 Write する
- レポに置かずに `~/.claude/skills/` だけで完結させる
- スキル追加・変更後に `./setup.sh` を実行し忘れる

### 反映コマンド

```bash
./setup.sh
```

`skills/` 配下の各スキルを `~/.claude/skills/` にシンボリックリンクで配置する。スキル追加・変更後は必ず実行する。
