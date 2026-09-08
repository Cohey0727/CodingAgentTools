# 2026-09-08 — claude-code-settings の統合

スキルとグローバル指示を持っていた `claude-code-settings` レポを、このレポに
履歴ごと取り込んだ。`skills/` と `AGENTS.md` がここに来て、両レポにあった
`bin/common.sh` と `bin/setup.sh` の名前衝突を解いた。

| 旧 (claude-code-settings) | 新 (このレポ) |
|---|---|
| `bin/common.sh` | `bin/skills-common.sh` |
| `bin/setup.sh` | `bin/skills-setup.sh` |
| `bin/list.sh` | `bin/skills-list.sh`（`bin/list.sh` は両方を出す） |
| `bin/uninstall.sh` | `bin/skills-uninstall.sh` |
| `bin/help.sh` | `bin/help.sh`（全ターゲットを載せ直した） |
| `make setup` | `make setup-skills`（`make setup` は両方） |

バナー・配色・`section` / `ok` / `warn` / `note` / `tilde` は `bin/ui.sh` に
集約した。`SKIP_BANNER=1` で 2 つのスクリプトを続けて呼んでもバナーは 1 回。

`skills/freelance-*/personal-config.json` は両レポとも Git 管理外なので、
移動では運ばれない。旧レポのものを手でコピーする。

## 手順

```bash
cd <repo>
git pull
make setup-skills     # または make setup で両方
```

`~/.claude/skills/*`、`~/.agents/skills/*`、`~/.claude/CLAUDE.md` などの
シンボリックリンクは旧レポを指したままなので、貼り直しが要る。既存の
シンボリックリンクは張り直され、実ファイルは触らない。

## 確認

```bash
make list                        # skills が全部 ✔ になる
readlink ~/.claude/CLAUDE.md     # このレポの AGENTS.md を指す
```

`make setup-skills` の `checks` に dangling symlink が出ないこと。

## 旧レポ

`~/Workspace/claude-code-settings` はそのまま残してある。リンクの貼り直しが
済んだら消してよい。GitHub の `Cohey0727/claude-code-settings` は archive する。
