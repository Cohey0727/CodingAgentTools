# 2026-09-18 — pi のダッシュボード拡張

pi の既定の TUI は、フッターにモデル名とトークン数が出るだけで、context の
埋まり具合、生成速度、今の議題、作業の進み具合が見えない。そこで pi の
拡張を 1 本足し、`make setup` で入るようにした。既存のチェックアウトは
`make setup-skills`（または `make setup`）を 1 回流せば有効になる。起動中の
pi には `/reload` で読み込める。

追加したもの:

- `pi/extensions/dashboard.ts` — 拡張本体。`~/.pi/agent/extensions/dashboard.ts`
  に symlink される。フッターを 2 行に差し替え、`todo` ツール、入力欄の上の
  to-do ウィジェット、`/panel`（ctrl+alt+p）のサイドパネル、`/todos`、
  `/topic` を足す。
- `bin/skills-setup.sh` / `bin/skills-uninstall.sh` / `bin/skills-list.sh` —
  `pi/extensions/*.ts` を link / 削除 / 一覧する。`make uninstall` が消すのは
  このレポを指す symlink だけで、自分で置いた拡張は残る。
- `bin/style-check.sh` — `pi/` も走査対象にした。

表示内容と操作は README の [pi dashboard](../../README.md#pi-dashboard) にある。

## 置き換わるもの

pi の組み込みフッターは表示されなくなる。組み込みにあった項目（モデル、
トークン、git ブランチ、他の拡張のステータス）は新しいフッターに含まれて
いる。元に戻すには `~/.pi/agent/extensions/dashboard.ts` の symlink を消して
pi を再起動する。

## モデルへの影響

`before_agent_start` でシステムプロンプトに 1 段落を足し、数ステップ以上の
作業では `todo` ツールで計画して進捗を付けるよう指示している。ツールが 1 つ
増えるぶん、毎リクエストのプロンプトが数百トークン増える。
