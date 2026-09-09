# 2026-09-09 — GLM の軽量モデルを glm-5.3-flash に / ox 廃止

## GLM の `SMALL_MODEL`

| | 変更前 | 変更後 |
|---|---|---|
| `SMALL_MODEL` | `glm-4.7` | `glm-5.3-flash` |
| `SMALL_CONTEXT_WINDOW` | `200000` | （削除） |
| `SMALL_MAX_TOKENS` | `131072` | （削除） |

`glm-5.3-flash` は 1M context / 128K output で `glm-5.3` と同じなので、専用の
上限設定は要らなくなった（未設定なら `CONTEXT_WINDOW` / `MAX_TOKENS` に落ちる）。
Z.ai の Anthropic エンドポイントで id・上限とも実測確認済み（`max_tokens` は
131072 を超えると 1210 エラー）。

既存のチェックアウトは `providers/glm/.env` を手で直す。`make setup` は
`.env.example` に増えた設定を追記するだけで、既存の値は書き換えない:

```bash
# providers/glm/.env
SMALL_MODEL=glm-5.3-flash
# SMALL_CONTEXT_WINDOW と SMALL_MAX_TOKENS の 2 行は消す
```

そのあと `make pi-global && make opencode-global` で生成物に反映する。

## ox（OpenRouter）の削除

`providers/ox/` ごと削除した。`claudeox` と、生成物の中の ox もなくなる。

既存のチェックアウトでは、`make uninstall` はリポジトリにあるプロバイダしか
見ないので、インストール済みの launcher が孤児として残る。手で消す:

```bash
rm -f ~/.local/bin/claudeox
make pi-global && make opencode-global   # 生成物から ox を落とす
```

`providers/ox/.env` に入れていた OpenRouter の API キーは消える。必要なら
https://openrouter.ai/settings/keys で再発行する。

## モデルの切り替え

launcher は引数をそのまま `claude` に渡すので、`.env` の `MODEL` に固定される
わけではない:

```bash
claudeglm --model glm-5.3-flash
```

opencode の `/models` と pi の `/model` には、プロバイダごとに `MODEL` と
`SMALL_MODEL` の 2 つが出る。
