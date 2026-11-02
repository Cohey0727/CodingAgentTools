# 2026-11-02 — opencode web を削除

`bin/serve.sh` が Cloudflare Tunnel 越しに OpenCode の Web UI を出す機能は使わなく
なったので外した。`dsh web` はそのまま残る。

変更点:

- `bin/serve.sh` は `opencode serve`（`127.0.0.1:3082`）を起動しない。
  `bin/serve.opencode.nginx.conf` を削除した。
- `make setup` のチェックボックスから `opencode web` の行が消える。
- `.env.example` の `SERVE_OPENCODE_HOST` を削除した。

## 手順

```bash
cd <repo>
git pull
bin/serve-service.sh
```

`make setup` でも同じ再起動が走る。

このレポの `.env` に `SERVE_OPENCODE_HOST` を書いていたら消してよい（残っていても
何も読まない）。Cloudflare Tunnel の該当 route と Access の設定は手で消す。残して
いても、そのホスト名への要求には nginx が 404 を返す。

## 確認

```bash
lsof -nP -iTCP:3082 -sTCP:LISTEN
```

何も出ないこと。
