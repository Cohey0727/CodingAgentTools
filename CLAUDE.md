# CodingAgentTools 作業ルール

全プロジェクト共通の契約は `AGENTS.md`（`~/.claude/CLAUDE.md` の実体）にある。
ここに書くのはこのレポ固有の規約だけ。

## 具象は configs.jsonc だけが持つ

`configs.jsonc` 以外のファイルに、次を書いてはいけない。**コメントも含む。**

- provider 名・vendor 名を、分岐・値・ルックアップのキーとして使うこと
- モデル id
- provider id の組み立て規則（`<name>` に接尾辞を足す類）
- SDK / npm パッケージ名、プロトコル名
- agent CLI が読む環境変数の名前、パッケージ spec
- `configs.jsonc` が決めるべきものの既定値（fallback の provider、schema の既定値など）
- agent 名で引くルックアップ（CLI の存在確認を N 個並べる、generator を名指しで呼ぶ、など）

`configs.jsonc` を書き換えたときに **黙って壊れる / 何もしなくなる** なら違反。

### なぜ

このレポの存在理由が「1 つのファイルで全 CLI・全 provider を駆動する」ことだから。
code に literal が 1 つでもあると、そこが第二の設定ファイルになり、`configs.jsonc`
は単一の真実ではなくなる。コメントも同じ: 古いモデル名を書いたコメントは、次の読み手を
間違った場所へ案内する。

### どう書くか

| 欲しいもの | 取り方 |
|---|---|
| モデル id（`<provider id>/<model>`） | `bin/model-ref.sh <provider> <agent> <main\|small>` |
| provider ごとの値 | `models_resolve <provider> <agent>` → `M_*` |
| agent ごとの値 | `settings_resolve <agent>` → `S_*` |
| provider / agent の一覧 | `provider_names` / `agent_names` |

新しい概念が要るなら、順序は必ずこう:

1. `configs.jsonc` にキーを足す
2. `bin/models.py` がそれを検証して `M_*` / `S_*` に載せる
3. shell 側はその変数を読むだけ

code に literal を置く選択肢はない。「とりあえず直書きして後で移す」もしない。

### 強制

`bin/style-check.sh` が禁止語を `configs.jsonc` から生成して、実行されるファイルを
すべて走査する。禁止語リストは code に書かれていない —
`bin/models.py vocabulary` が `configs.jsonc` から作るので、provider を足せば
その名前が自動的に禁止語になる。

`lefthook` の pre-commit が `make check` を回す。違反があるとコミットできない。
フックは `make hooks` で入る。

どうしても 1 行だけ必要なら、その行の末尾に `style-check: allow` を書く。
レビューで理由を説明できないなら使わない。

## ドキュメント

`README.md` / `docs/` / `AGENTS.md` は provider を説明するのが役割なので走査対象外。
ただし `configs.jsonc` を変えたら README も直す — 古い変数名を残さない。

## コメント

`AGENTS.md` のコメント規約に加えて、このレポでは移行の来歴を書かない。
`docs/migrations/` がその役割を持っている。
