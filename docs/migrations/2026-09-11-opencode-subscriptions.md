# 2026-09-11 — OpenCode の Subscriptions 見出し

OpenCode の `/models` で、自分で契約したエンドポイントと、OpenCode 自身の
サービス（OpenCode Zen / OpenCode Go）を見出しで分けるようにした。

```
OpenCode Zen          OpenCode のサービス。/connect で入れる
OpenCode Go           OpenCode のサービス。/connect で入れる
Subscriptions         configs.jsonc の全 provider
  DeepSeek deepseek-v4-pro
  Z.AI glm-5.3
  Moonshot kimi-k3
  ...
```

OpenCode Go は `glm-5.3` や `kimi-k3` を自前の契約と同じ id で出すので、
id では見分けがつかない。見出しを見れば、どちらの枠を消費するかがわかる。

変更点:

- configs.jsonc の provider から `schema` / `schema_id` を削除した。
  deepseek / glm / kimi も models.dev（OpenCode のカタログ）を使わず、
  `BASE_URL` の Anthropic エンドポイントに自前で宣言する。launcher と同じ経路。
- OpenCode 上の provider id が全 provider で `<name>-anthropic` になった。

| 変更前 | 変更後 |
|---|---|
| `deepseek/deepseek-v4-pro` | `deepseek-anthropic/deepseek-v4-pro` |
| `zai-coding-plan/glm-5.3` | `glm-anthropic/glm-5.3` |
| `kimi-for-coding/k3` | `kimi-anthropic/kimi-k3` |

- models.dev にしかなかったモデル（`glm-5.3-highspeed` や `k3-256k` など）は
  `/models` から消える。使うなら configs.jsonc の `models` に足す。

## 手順

```bash
cd <repo>
git pull
make opencode-global
```

`opencode --model zai-coding-plan/...` のように古い id を書いたスクリプトや
設定は、上の表の id に直す。`/models` の Recent / Favorites に残る古い id は、
選び直せば置き換わる。

OpenCode Zen / Go を使うときは、OpenCode の `/connect` でキーを入れる。
`OPENCODE_API_KEY` を環境変数に置くと、Zen（従量課金）と Go の両方が同じキーで
有効になる。

## 確認

```bash
opencode models | grep -- -anthropic/
```

`/models` を開き、configs.jsonc のモデルがすべて **Subscriptions** の下に
`<label> <model>` で並んでいること。`label` は configs.jsonc の provider の
表示名で、書かなければ provider 名になる。
