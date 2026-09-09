# 2026-09-09 — モデル設定を providers/<name>/models.json に移す

`.env` はトークンとエンドポイントだけになった。モデルの設定はすべて
`providers/<name>/models.json` に移り、git 管理される。Claude Code /
OpenCode / pi の 3 つとも `bin/models.py` 経由でこのファイルを読む。

| | 変更前 | 変更後 |
|---|---|---|
| モデル id・上限 | `providers/<name>/.env`（gitignore） | `providers/<name>/models.json`（git 管理） |
| スロットの割り当て | `MODEL` / `SMALL_MODEL` と `ANTHROPIC_*` などの上書き変数 | モデルに付ける tag |
| `.env` の中身 | 15〜20 行 | `API_TOKEN` / `BASE_URL`（+ 必要なら `HEADERS`） |

## tag

モデルスロットが複数あるのは Claude Code だけで、そのスロットは全部環境変数。
なので tag は環境変数名そのものにした。中間の語彙を挟まないので、どの変数に
どのモデルが入るかが models.json だけで読める。

| tag | 入るところ |
|---|---|
| `default` | 自前の tag を持たないスロット全部。OpenCode と pi の起動モデル |
| `small` | 下の 2 つの安いスロットと OpenCode の `small_model` |
| `ANTHROPIC_MODEL` | メインスロット |
| `ANTHROPIC_DEFAULT_OPUS_MODEL` | `/model opus` |
| `ANTHROPIC_DEFAULT_SONNET_MODEL` | `/model sonnet` |
| `ANTHROPIC_DEFAULT_FABLE_MODEL` | `/model fable` |
| `ANTHROPIC_DEFAULT_HAIKU_MODEL` | 安いスロット |
| `CLAUDE_CODE_SUBAGENT_MODEL` | サブエージェント |

OpenCode と pi には `models` に並べたモデルが**全部**出る。セッション内の
`/models` `/model` で選ぶものなので、モデルごとに宣言することは何もない。
起動時に乗るのが `default` と `small`。

個別の変数名 > `ANTHROPIC_MODEL` > `default` / `small` の順で決まるので、素直に
2 段構成のプロバイダは `default` と `small` の 2 つだけで足りる。`default` が
ないファイル、1 つの tag を 2 つのモデルに付けたファイル、知らない tag を
書いたファイルは `make setup` がエラーで止める。

## 変数の対応

| 変更前（`.env`） | 変更後（`models.json`） |
|---|---|
| `NAME` | `name` |
| `MODEL` | `tags: ["default"]` |
| `SMALL_MODEL` | `tags: ["small"]` |
| `ANTHROPIC_DEFAULT_HAIKU_MODEL` などスロット個別の上書き | 同名の tag |
| `OPENCODE_EXTRA_MODELS` | `models` に足すだけ（列挙されたモデルは全部 OpenCode と pi に出る） |
| `CONTEXT_WINDOW` / `MAX_TOKENS` | モデルごとの `context_window` / `max_tokens`（`defaults` で共通化できる） |
| `SMALL_CONTEXT_WINDOW` / `SMALL_MAX_TOKENS` | 該当モデルの `context_window` / `max_tokens` |
| `REASONING` / `INPUT` | モデルごとの `reasoning` / `input` |
| `CLAUDE_MODEL_SUFFIX=[1m]` | モデルごとの `claude_id`（例 `"kimi-k3[1m]"`） |
| `COMMAND` | `claude.command` |
| `ARGS` / `CLAUDE_ARGS` | `claude.args` |
| `CLAUDE_CODE_EFFORT_LEVEL` などの追加変数 | `claude.env` |
| `CLAUDE_CODE_AUTO_COMPACT_WINDOW` | `claude.auto_compact_window`（既定はメインモデルの `context_window`） |
| `OPENCODE_LEAN` | `opencode.lean` |
| `OPENCODE_CONTEXT_WINDOW` / `OPENCODE_MAX_TOKENS` | `opencode.context_window` / `opencode.max_tokens` |
| `OPENCODE_MODEL` / `OPENCODE_SMALL_MODEL` / `PI_MODEL` / `PI_SMALL_MODEL` | 廃止。OpenCode と pi は全モデルを一覧に出し、起動モデルは `default` / `small` |
| `API_TOKEN` / `BASE_URL` / `HEADERS` | `.env` のまま |

`ANTHROPIC_AUTH_TOKEN` と `ANTHROPIC_BASE_URL` の別名はなくなった。`.env` に
書くのは `API_TOKEN` と `BASE_URL`。

## 手順

```bash
cd <repo>
git pull
make setup                    # .env の移行 + launcher 再生成 + pi / OpenCode 設定生成
```

`make setup` は旧レイアウトの `.env`（`MODEL=` などが残っているもの）を
`.env.example` から作り直し、API キーと `HEADERS` のブロックはそのまま
引き継ぐ。元のファイルは `.env.bak` に残る。

**launcher は再生成が必須。** インストール済みの `claude<name>` は旧テンプレート
のままだと `.env` から消えた `MODEL` を読もうとして動かない。`make setup` を
飛ばすなら最低限 `make setup-providers` を実行する。

## python3

`bin/models.py` が models.json の唯一の読み手なので、`python3` が必須に
なった（従来も pi の起動モデル設定で任意依存だった）。launcher は起動のたびに
これを呼ぶ。

## モデルを足す

`providers/<name>/models.json` の `models` に 1 行足して再生成するだけ:

```jsonc
{ "id": "glm-5.3-air", "tags": [] }   // tag なし = OpenCode と pi には出るが Claude Code のスロットは埋めない
```

```bash
make pi-global && make opencode-global
```

`make list` が各プロバイダのモデルと tag を出すので、どのスロットに何が
入っているかはそこで確認できる。
