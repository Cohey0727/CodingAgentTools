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

tag は 3 つの CLI のスロット名そのもの。Claude Code のどのスロットに
どのモデルが入るかが models.json だけで読める。

| tag | 入るところ |
|---|---|
| `default` | 自前の tag を持たないメインスロット全部 |
| `small` | 自前の tag を持たない安いスロット全部 |
| `claude_model` | `ANTHROPIC_MODEL` |
| `claude_opus_model` | `ANTHROPIC_DEFAULT_OPUS_MODEL` |
| `claude_sonnet_model` | `ANTHROPIC_DEFAULT_SONNET_MODEL` |
| `claude_fable_model` | `ANTHROPIC_DEFAULT_FABLE_MODEL` |
| `claude_haiku_model` | `ANTHROPIC_DEFAULT_HAIKU_MODEL` |
| `claude_subagent_model` | `CLAUDE_CODE_SUBAGENT_MODEL` |
| `opencode_model` / `opencode_small_model` | OpenCode の `model` / `small_model` |
| `pi_model` / `pi_small_model` | pi の `defaultModel` / 安いほう |

個別 tag > `claude_model` > `default` / `small` の順で決まるので、素直に
2 段構成のプロバイダは `default` と `small` の 2 つだけで足りる。1 つの tag を
2 つのモデルに付ける、知らない tag を書く、どのモデルも埋めないスロットが
できる、のいずれも `make setup` がエラーで止める。

## 変数の対応

| 変更前（`.env`） | 変更後（`models.json`） |
|---|---|
| `NAME` | `name` |
| `MODEL` | `tags: ["default"]` |
| `SMALL_MODEL` | `tags: ["small"]` |
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
| `ANTHROPIC_MODEL` / `ANTHROPIC_DEFAULT_*_MODEL` / `CLAUDE_CODE_SUBAGENT_MODEL` / `OPENCODE_MODEL` / `OPENCODE_SMALL_MODEL` / `PI_MODEL` / `PI_SMALL_MODEL` | 対応する tag |
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
{ "id": "glm-5.3-air", "tags": [] }   // tag なし = 一覧に出るがスロットは埋めない
```

```bash
make pi-global && make opencode-global
```

`make list` が各プロバイダのモデルと tag を出すので、どのスロットに何が
入っているかはそこで確認できる。
