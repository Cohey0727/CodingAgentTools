# CodingAgentTools 作業ルール

全プロジェクト共通の契約は `AGENTS.md`（`~/.claude/CLAUDE.md` の実体）にある。
ここに書くのはこのレポ固有の規約だけ。

## provider の具象は configs.jsonc だけが持つ

`configs.jsonc` 以外のファイルに、次を書いてはいけない。**コメントも含む。**

- provider 名を、分岐・値・ルックアップのキーとして使うこと
- モデル id
- provider の endpoint
- provider id の組み立て規則（provider 名に接尾辞を足す類）。route id と pi の id は、
  解決機構の `bin/models.py` だけが組み立てる
- `configs.jsonc` が決めるべき provider 側の既定値（fallback の provider など）

判定基準: **`configs.jsonc` の provider を書き換えたときに、そのファイルが黙って
壊れる / 何もしなくなるなら違反。**

### 対象外

**agent / CLI レベルの具象は直書きしてよい。** 次はすべて許される:

- `configs.jsonc` の `opencode` / `pi` セクション（各 CLI の設定へ最後に
  deep-merge する `overrides`）そのもの
- 各 CLI の設定ディレクトリ・ファイル名・環境変数（`bin/common.sh`）
- 各 CLI の設定ファイルのキー名や記法。`bin/opencode-global-config.sh` は
  OpenCode の設定を書くための script なので、その形式はそこの主題であって
  隠れた設定ではない
- agent 名で引くテーブル（`bin/skills-common.sh`）、agent ごとの make ターゲット

generator は CLI ごとに 1 本ずつある（pi / OpenCode / Crush / Reasonix /
Codewhale / DeepSeek Harness）。そこを抽象化しても読みにくくなるだけで、
`configs.jsonc` が単一の真実である性質は変わらない。

### provider の値をどう取るか

| 欲しいもの | 取り方 |
|---|---|
| モデル id（`<route id>/<model>`） | `bin/model-ref.sh <provider> [main\|small]` |
| route id | `models_resolve` の後に `route_id [<api>]`（`M_ROUTE_IDS` を引く） |
| provider ごとの値 | `models_resolve <provider> [<api>]` → `M_*` |
| agent ごとの上書き | `models.py opencode-merge` / `pi-merge`（`<agent>.overrides`） |
| provider の一覧 | `provider_names` |

provider に新しい属性が要るなら、順序は必ずこう:

1. `configs.jsonc` にキーを足す
2. `bin/models.py` が検証して `M_*` に載せる
3. shell 側はその変数を読むだけ

### 強制

`bin/style-check.sh` が禁止語を `configs.jsonc` から生成して、実行されるファイルを
走査する。禁止語リストは script に書かれていない —
`bin/models.py vocabulary` が `configs.jsonc` から作るので、provider を足せば
その名前が自動的に禁止語になる。`${VAR:-fallback}` は、検査するシェルの環境に
関係なく fallback の値で数える。3 文字以下の provider 名と、機構が別の意味で使う
語と同じ綴りの provider 名（`local` `default` `small` `main` `command` `exec`
`name`）は、値として使われた形（引用符や `=` の右）でのみ検出する。3 文字以下の
モデル id・endpoint・route id と、タグと同じ綴りのモデル id `default` は、一般語と
区別できないので禁止語にしない。

走査対象はこのレポの機構 — `bin/` `Makefile` `lefthook.yml` `opencode/` `pi/`
`.claude/*.json` — と staged の新規ファイル。`README.md` / `docs/` /
`AGENTS.md` / `.env.example` は provider を説明するのが役割（`.env.example` は
`configs.jsonc` が参照する変数と、各鍵の取得 URL の置き場所）、`skills/` は
使いたい provider を名指しするのが役割なので、どちらも対象外。

`lefthook` の pre-commit が `make check` を回す。違反があるとコミットできない
（`make hooks` で導入）。

逃げ道は行末の `style-check: allow` だけ。レビューで理由を説明できないなら
使わない。

## ドキュメント

`configs.jsonc` を変えたら `README.md` も直す。古い変数名を残さない。

## コメント

`AGENTS.md` のコメント規約に加えて、このレポでは移行の来歴を書かない。
`docs/migrations/` がその役割を持っている。
