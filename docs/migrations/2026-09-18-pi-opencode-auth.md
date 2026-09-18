# 2026-09-18 — pi から OpenCode Zen / Go を使う

pi は OpenCode Zen（`opencode`）と OpenCode Go（`opencode-go`）を組み込みの
provider として持っているが、鍵が無いので `/model` に出ていなかった。鍵は
OpenCode の `/connect` で `~/.local/share/opencode/auth.json` に入っている。
Zen と Go は OpenCode のものとして扱い `configs.jsonc` には入れない方針なので、
その鍵を pi から参照させることにした。既存のチェックアウトは `make pi-global`
（または `make setup`）を 1 回流せば使えるようになる。

変わったこと:

- `make pi-global` — OpenCode の `auth.json` にある API キーのうち、pi が
  provider として知っている id（`pi auth check` で判定）ごとに、
  `~/.pi/agent/auth.json` へ `"key": "!bash -c '. <repo>/bin/common.sh; opencode_auth_key <id>'"`
  のエントリを書く。鍵そのものはコピーしないので、OpenCode 側で鍵を
  差し替えても再実行は要らない。OpenCode で切断した id のエントリは次の
  実行で消える。
- pi の `/login` で自分で入れたエントリ（上のコマンドではないもの）は
  上書きしない。OAuth のログインは共有しない。
- `make setup` — pi のパッケージ導入のあとに `pi update --models` を流す。
  インストール済みの pi のカタログには、リリース後に Zen / Go に足された
  モデル（`deepseek-v4.1-flash` など）が入っていないため。
- `make uninstall` — pi の `auth.json` から上のエントリだけを消す。

Command Code は以前から `configs.jsonc` の provider として
`commandcode-openai` / `commandcode-anthropic` の 2 ルートで pi に入っている。
