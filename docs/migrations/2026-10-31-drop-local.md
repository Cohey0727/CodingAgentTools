# 2026-10-31 — Local provider を削除

`127.0.0.1:11301` の `llama-server` を指していた `local` provider は使わなくなった
ので、`configs.jsonc` から外した。OpenCode の `/models`、pi の `/model`、
DeepSeek Harness のモデル選択から `Local` が消える。

変更点:

- `configs.jsonc` の `local` と、`.env.example` の `LOCAL_API_KEY` /
  `LOCAL_BASE_URL` を削除した。
- 同じく `llama-server` を指す `gtr` は残る。モデル id を固定の `default` にしている
  理由は、README の gtr の注と `configs.jsonc` の gtr のコメントに移した。
- 生成物から `local` が消える。pi の `models.json`、OpenCode の `opencode.json`
  （と `~/.config/opencode/claude-compatibles/local.token`）、DeepSeek Harness の
  `cordis.patch.yml`。

## 手順

```bash
cd <repo>
git pull
make pi-global opencode-global dsh-global
```

`make setup` でも同じ生成が走る。

`~/.dsh/.env` の `LOCAL_API_KEY=` の行は消えない。`make dsh-global` は自分が書く
行しか触らないので、要らなければ手で消す。このレポの `.env` に `LOCAL_API_KEY` /
`LOCAL_BASE_URL` を書いていたら、そちらも消してよい（残っていても何も読まない）。

## 確認

```bash
make list
```

`providers (4)` と出て、`local` が無いこと。
