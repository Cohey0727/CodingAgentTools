# 2026-10-31 — Crush・Reasonix・Codewhale の対応を削除

Crush・Reasonix・Codewhale は使わなくなったので、このレポの対応をやめた。
グローバル設定を生成する CLI は OpenCode・pi・DeepSeek Harness の 3 つだけになる。

変更点:

- 生成スクリプト `bin/crush-global-config.sh` / `bin/reasonix-global-config.sh` /
  `bin/codewhale-global-config.sh` と、`make crush-global` /
  `make reasonix-global` / `make codewhale-global` を削除した。
  `make setup` と `make update` もこの 3 つを流さない。
- `AGENTS.md` を `~/.config/crush/CRUSH.md` にリンクしなくなった。
  `~/.claude/skills` と `~/.agents/skills` のリンクは変わらない。
- `make setup` の PATH チェックから `crush` / `reasonix` / `codewhale` を外した。
- `configs.jsonc` の provider の `agents` に書けるのは `pi` / `opencode` / `dsh`
  だけになった。ほかの名前が残っていると `make check` が落ちる。
- `make uninstall` は、この 3 つが書いた設定ファイルとリンクを消さなくなった。

## 手順

```bash
cd <repo>
git pull
make setup
```

これまでに `make setup` を流していたなら、次のファイルが残っている。
`make uninstall` はもう消さないので、要らなければ手で消す。

```bash
rm -f ~/.config/crush/crushrc ~/.config/crush/CRUSH.md
rm -f ~/.reasonix/config.toml ~/.reasonix/.env
rm -f ~/.codewhale/config.toml
```

`~/.reasonix/.env` と `~/.codewhale/config.toml` には API キーの写しが入っている。
`CRUSH.md` はこのレポの `AGENTS.md` へのシンボリックリンクなので、消しても
本体は残る。

手で書いた configs.jsonc の `agents` に `crush` / `reasonix` / `codewhale` を
入れていたら、その名前を外す。

## 確認

```bash
make check
make help
```

`make help` に `crush-global` / `reasonix-global` / `codewhale-global` が
出ないこと。
