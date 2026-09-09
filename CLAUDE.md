# CodingAgentTools 作業ルール

全プロジェクト共通の契約は `AGENTS.md`（`~/.claude/CLAUDE.md` の実体）にある。
ここに書くのはこのレポ固有の規約だけ。

## provider の具象は configs.jsonc だけが持つ

`configs.jsonc` 以外のファイルに、次を書いてはいけない。**コメントも含む。**

- provider 名を、分岐・値・ルックアップのキーとして使うこと
- モデル id
- provider の endpoint
- provider id の組み立て規則（provider 名に接尾辞を足す類）
- `configs.jsonc` が決めるべき provider 側の既定値（fallback の provider など）

判定基準: **`configs.jsonc` の provider を書き換えたときに、そのファイルが黙って
壊れる / 何もしなくなるなら違反。**

### 対象外

**agent / CLI レベルの具象は直書きしてよい。** 次はすべて許される:

- `configs.jsonc` の `agents` セクションそのもの（provider 名を除く全部）
- 各 CLI の設定ディレクトリ・ファイル名・環境変数（`bin/common.sh`）
- 各 CLI の設定ファイルのキー名や記法。`bin/opencode-global-config.sh` は
  OpenCode の設定を書くための script なので、その形式はそこの主題であって
  隠れた設定ではない
- agent 名で引くテーブル（`bin/skills-common.sh`）、agent ごとの make ターゲット

agent は 3 つで、CLI ごとに generator が 1 本ずつある。そこを抽象化しても
読みにくくなるだけで、`configs.jsonc` が単一の真実である性質は変わらない。

### provider の値をどう取るか

| 欲しいもの | 取り方 |
|---|---|
| モデル id（`<provider id>/<model>`） | `bin/model-ref.sh <provider> <agent> <main\|small>` |
| provider ごとの値 | `models_resolve <provider> <agent>` → `M_*` |
| agent ごとの値 | `settings_resolve <agent>` → `S_*` |
| provider / agent の一覧 | `provider_names` / `agent_names` |

provider に新しい属性が要るなら、順序は必ずこう:

1. `configs.jsonc` にキーを足す
2. `bin/models.py` が検証して `M_*` / `S_*` に載せる
3. shell 側はその変数を読むだけ

### 強制

`bin/style-check.sh` が禁止語を `configs.jsonc` から生成して、実行されるファイルを
走査する。禁止語リストは script に書かれていない —
`bin/models.py vocabulary` が `configs.jsonc` から作るので、provider を足せば
その名前が自動的に禁止語になる。3 文字以下の provider 名は、値として使われた
形（引用符や `=` の右）でのみ検出する。

走査対象は `bin/` `Makefile` `opencode/` `skills/**/*.json` `skills/**/SKILL.md`
と staged の新規ファイル。`README.md` / `docs/` / `AGENTS.md` は provider を
説明するのが役割なので対象外。

`lefthook` の pre-commit が `make check` を回す。違反があるとコミットできない
（`make hooks` で導入）。

逃げ道は 2 つだけ:

- 行末に `style-check: allow`
- `.style-check-allow` に `<path><TAB><語>` を書く。**語単位**なので、その
  ファイルに別の禁止語（モデル id など）が出れば依然として弾かれる。
  provider を「選ぶ」ためにその名前を書くファイル（`llms.json`）用

どちらもレビューで理由を説明できないなら使わない。

## ドキュメント

`configs.jsonc` を変えたら `README.md` も直す。古い変数名を残さない。

## コメント

`AGENTS.md` のコメント規約に加えて、このレポでは移行の来歴を書かない。
`docs/migrations/` がその役割を持っている。
