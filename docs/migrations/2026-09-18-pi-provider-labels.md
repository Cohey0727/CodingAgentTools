# 2026-09-18 — pi の provider id を label に揃える

pi の `/model` は provider id をモデルの横に `[glm-anthropic]` のように出す。
OpenCode のモデルダイアログは同じモデルを `Z.AI glm-5.3` と出すので、pi も
`configs.jsonc` の `label` を provider id にした。既存のチェックアウトは
`make pi-global`（または `make setup`）を 1 回流せば切り替わる。

変わったこと:

- `make pi-global` — `~/.pi/agent/models.json` に provider を API 別の
  `<name>-<api>` ではなく 1 provider 1 エントリで書く。id は `label`、無ければ
  provider 名。pi は API と base URL をモデル単位で持てるので、Anthropic と
  OpenAI の両方を話す Command Code も 1 エントリになる。
- `make check` — pi の id が 2 つの provider で重なると失敗する。
- OpenCode / Crush / Reasonix / Codewhale / DeepSeek Harness と
  `bin/model-ref.sh` の `<name>-<api>` はそのまま。

| 旧 | 新 |
|---|---|
| `deepseek-anthropic/deepseek-v4-pro` | `DeepSeek/deepseek-v4-pro` |
| `glm-anthropic/glm-5.3` | `Z.AI/glm-5.3` |
| `kimi-anthropic/kimi-k3` | `Moonshot/kimi-k3` |
| `local-anthropic/default` | `Local/default` |
| `gtr-anthropic/default` | `GTR9/default` |
| `commandcode-openai/<model>` / `commandcode-anthropic/<model>` | `commandcode/<model>` |

`pi --model` に旧 id を渡している alias やスクリプトは新 id に直す。旧 id で
保存された pi のセッションを再開すると、そのモデルは見つからない。`/model` で
選び直す。
