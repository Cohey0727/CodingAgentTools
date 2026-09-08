# 2026-09-08 — OpenCode の `/goal`

pi には `npm:pi-goal` があるが OpenCode には同等のものがない。1 メッセージ =
1 ターンで止まるので、目標を持たせて自走させるループを自前で足した。既存の
チェックアウトは `make setup-skills`（または `make setup`）を 1 回流せば
`/goal` が使えるようになる。

追加したもの:

- `opencode/command/goal.md` — スラッシュコマンド本体。
  `~/.config/opencode/command/goal.md` に symlink される。
- `opencode/plugin/goal.js` — ループの実装。`command.execute.before` で
  `/goal` を横取りして目標を保存し、`session.idle` ごとに継続プロンプトを
  `client.session.promptAsync` で送る。モデル側の終了手段は `goal_finish`
  ツールだけ。
- `bin/opencode-plugin.template` — プラグインの shim。

使い方と停止条件は README の
[Goals in OpenCode](../../README.md#goals-in-opencode) にある。

## プラグインだけ symlink ではなく shim なのはなぜか

OpenCode はプラグインの npm import を**実体のパス基準**で解決する。symlink を
置くと解決の起点がこのリポジトリになり、`@opencode-ai/plugin` が見つからずに
プラグインが黙って読まれない（ログにも出ない。ツール一覧に `goal_finish` が
現れないことでしか気づけない）。

そこで `make setup-skills` は shim だけを設定ディレクトリ側に生成し、
`tool` を実装へ渡す。`@opencode-ai/plugin` は OpenCode が
`~/.config/opencode/node_modules` へ自動で入れるので、事前インストールは不要。
実装はリポジトリに残るため、編集は次回の OpenCode 起動で効く。

コマンド（markdown）は import を持たないので symlink のままでよい。

## 状態の置き場所

セッションごとに `~/.local/share/opencode-goal/<sessionID>.json`。compaction を
またいで残る。プロセス ID を記録しているので、OpenCode を再起動して古い
セッションを開いても自走は再開せず paused になる（`/goal resume` で再開）。
30 日を過ぎたファイルは起動時に消える。
