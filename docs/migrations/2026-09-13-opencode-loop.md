# 2026-09-13 — OpenCode の `/loop`

pi には `npm:@realvendex/pi-loop` があるが OpenCode には同等のものがない。
既存の `/goal` は「目標を達成するまで」のループで、同じプロンプトを条件まで
回し続ける用途には向かない。そこで繰り返しのループを自前で足した。既存の
チェックアウトは `make setup-skills`（または `make setup`）を 1 回流せば
`/loop` が使えるようになる。

追加したもの:

- `opencode/command/loop.md` — スラッシュコマンド本体。
  `~/.config/opencode/command/loop.md` に symlink される。
- `opencode/plugin/loop.js` — ループの実装。`command.execute.before` で
  `/loop` を横取りして task と停止条件を保存し、`session.idle` ごとに継続
  プロンプトを `client.session.promptAsync` で送る。モデル側の終了手段は
  `loop_finish` ツールだけ。`--every 5m` はプロセス内の `setTimeout` で間隔を
  空ける（`session.status` が busy の間は送らず、次の idle に回す）。

使い方と停止条件は README の
[Loops in OpenCode](../../README.md#loops-in-opencode) にある。

## `/goal` との排他

`/loop` と `/goal` はどちらも `session.idle` でセッションを自走させるため、
同じセッションで 2 つが active になると、お互いのプロンプトが交互に飛んで
トークンだけが消費される。そこで `loop.js` は goal の状態ファイルを、
`goal.js` は loop の状態ファイルを読み、相手が active なら set / resume を
拒否する。片方を pause か clear してからもう片方を始める。

`/goal status` などの制御コマンドは `skipNextIdle` でそのターン自体をループ
の 1 回に数えない（goal と同じ）。

## 状態の置き場所

セッションごとに `~/.local/share/opencode-loop/<sessionID>.json`。compaction を
またいで残る。プロセス ID を記録しているので、OpenCode を再起動して古い
セッションを開いても自走は再開せず paused になる（`/loop resume` で再開）。
30 日を過ぎたファイルは起動時に消える。
