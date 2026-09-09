# 2026-09-09 — providers/ を廃止し configs.jsonc 1 枚に集約する

`providers/<name>/` をやめた。プロバイダの設定はリポジトリ直下の
`configs.jsonc` 1 枚に入り、秘密情報はそこから `${環境変数名}` で参照する。
値を持つのは直下の `.env` 1 枚だけ。Claude Code / OpenCode / pi の 3 つとも
`bin/models.py` 経由でこのファイルを読む。

| | 変更前 | 変更後 |
|---|---|---|
| モデル id・上限 | `providers/<name>/.env`（gitignore） | `configs.jsonc`（git 管理） |
| スロットの割り当て | `MODEL` / `SMALL_MODEL` と `ANTHROPIC_*` などの上書き変数 | モデルに付ける tag |
| エンドポイント | `providers/<name>/.env` の `BASE_URL` | `configs.jsonc` の `BASE_URL`（`.env` で上書き可） |
| 秘密情報 | `providers/<name>/.env` × 7 | `.env` × 1（gitignore, chmod 600） |
| ヘッダー | `.env` の `HEADERS`（`Name: Value` の行） | `configs.jsonc` の `REQUEST_HEADERS`（オブジェクト） |

## 手順

```bash
cd <repo>
git pull
make setup                    # .env 作成 + 旧 providers/*/.env からの取り込み + 全部再生成
```

`make setup` は旧レイアウトの `providers/<name>/.env` から `API_TOKEN` と
`HEADERS` の各値を、`configs.jsonc` が参照している変数名へ移す。移すのは
**まだ空の変数だけ**なので、二重に走らせても既存の値は壊れない。旧ファイルは
そのまま残るので、`make list` を確認してから消す:

```bash
rm -rf providers/
```

`.gitignore` は `providers/` ごと無視するので、消し忘れてもキーがコミットに
載ることはない。

**launcher は再生成が必須。** インストール済みの `claude<name>` は旧テンプレート
のままだと動かない。`make setup` を飛ばすなら最低限 `make setup-providers` を
実行する。

## configs.jsonc の形

```jsonc
{
  "providers": {
    "deepseek": {
      "API_KEY": "${DEEPSEEK_API_KEY}",
      "BASE_URL": "${DEEPSEEK_BASE_URL:-https://api.deepseek.com/anthropic}",
      "defaults": { "context_window": 1000000, "max_tokens": 384000 },
      "claude": { "env": { "CLAUDE_CODE_EFFORT_LEVEL": "max" } },
      "models": [
        { "id": "deepseek-v4-pro",   "tags": ["default"] },
        { "id": "deepseek-v4-flash", "tags": ["small"] }
      ]
    },
    "gtr": {
      "API_KEY": "${GTR_API_KEY:-gtr}",
      "BASE_URL": "${GTR_BASE_URL:-https://gtr-llama.spaghetti-monster.com}",
      "REQUEST_HEADERS": {
        "CF-Access-Client-Id": "${GTR_CF_ACCESS_CLIENT_ID}",
        "CF-Access-Client-Secret": "${GTR_CF_ACCESS_CLIENT_SECRET}"
      },
      "models": [ … ]
    }
  }
}
```

`providers` のキーがそのままプロバイダ名で、launcher 名（`claude<name>`）、
pi のモデル一覧に出る id、OpenCode の `<name>-anthropic` の元になる。
`claude<name>` にしたくない場合だけ `claude.command` で上書きする。
`//` 行コメントが書ける。

## 参照

外から来る値は全部 `${...}` で書く。書き方は 2 つ:

| 書き方 | 解決結果 |
|---|---|
| `${NAME}` | 環境の `NAME`。未設定なら空文字列 |
| `${NAME:-fallback}` | 環境の `NAME`。未設定または空なら `fallback` |

ファイルを読めば、どの値が外から来るのか・来なかったらどうなるのかが分かる。
秘密情報には妥当な既定値がないので前者、エンドポイントは後者で書く。
`API_KEY` が空になったプロバイダは生成物から外れるだけでエラーにはならない。

`.env` はサブシェルの中でしか読まない。呼び出し元の環境に全プロバイダの
キーが載らないので、`claudeglm` のプロセスに渡るのは `GLM_API_KEY` だけで、
他のプロバイダのキーは 1 つも入らない。

pi の生成物には `!bash -c '. bin/common.sh; env_value DEEPSEEK_API_KEY'` の形で
変数名だけが入る。キーを差し替えても再生成は要らない。OpenCode は
`{file:…}` 参照なので、差し替えたら `make opencode-global` を再実行する。

## tag

`default` と `small` の 2 つが標準で、全スロットがこのどちらかに従う。

| tag | 入るところ |
|---|---|
| `default` | `ANTHROPIC_MODEL`、opus / sonnet / fable スロット、OpenCode と pi の起動モデル |
| `small` | `ANTHROPIC_DEFAULT_HAIKU_MODEL`、`CLAUDE_CODE_SUBAGENT_MODEL`、OpenCode がセッションのタイトル生成に使うモデル |

モデルスロットが複数あるのは Claude Code だけで、そのスロットは全部環境変数。
なので、この 2 つから外れるための tag は環境変数名そのものにした。

| tag | 入るところ | 未指定なら |
|---|---|---|
| `ANTHROPIC_DEFAULT_OPUS_MODEL` | `/model opus` | `default` |
| `ANTHROPIC_DEFAULT_SONNET_MODEL` | `/model sonnet` | `default` |
| `ANTHROPIC_DEFAULT_FABLE_MODEL` | `/model fable` | `default` |
| `CLAUDE_CODE_SUBAGENT_MODEL` | サブエージェント | `small` |

`ANTHROPIC_MODEL` と `ANTHROPIC_DEFAULT_HAIKU_MODEL` に対応する tag は
用意しない。この 2 つは `default` と `small` そのもので、別名を作っても
同じことを言う 2 つ目の書き方が増えるだけ。

OpenCode と pi には `models` に並べたモデルが**全部**出る。セッション内の
`/models` `/model` で選ぶものなので、モデルごとに宣言することは何もない。
起動時に乗るのが `default` と `small`。

素直に 2 段構成のプロバイダは `default` と `small` の 2 つだけで足りる。
`default` がないファイル、1 つの tag を 2 つのモデルに付けたファイル、
知らない tag を書いたファイルは `make setup` がエラーで止める。

## 変数の対応

| 変更前（`providers/<name>/.env`） | 変更後 |
|---|---|
| `NAME` | `providers` のキー |
| `API_TOKEN` | `.env` の `<NAME>_API_KEY`（`configs.jsonc` の `API_KEY` が参照） |
| `BASE_URL` | `configs.jsonc` の `BASE_URL`（`.env` の `<NAME>_BASE_URL` で上書き） |
| `HEADERS` | `configs.jsonc` の `REQUEST_HEADERS` + `.env` の変数 |
| `MODEL` | `tags: ["default"]` |
| `SMALL_MODEL` | `tags: ["small"]` |
| `ANTHROPIC_DEFAULT_OPUS_MODEL` などスロット個別の上書き | 同名の tag（`ANTHROPIC_MODEL` と `ANTHROPIC_DEFAULT_HAIKU_MODEL` は `default` / `small`） |
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
| `ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_BASE_URL` の別名 | 廃止 |

## GLM の軽量モデル

`glm-4.7` を使っていたスロットは `glm-5.3-flash` になった。1M context /
128K output で `glm-5.3` と同じなので専用の上限設定は要らず、`defaults` に
落ちる。Z.ai の Anthropic エンドポイントで id・上限とも実測確認済み
（`max_tokens` は 131072 を超えると 1210 エラー）。

`configs.jsonc` に入っているので、既存のチェックアウトで直すものはない。

## ox の削除

`providers/ox/` は削除済み。`make uninstall` はリポジトリにあるプロバイダしか
見ないので、インストール済みの launcher が孤児として残る。手で消す:

```bash
rm -f ~/.local/bin/claudeox
make pi-global && make opencode-global   # 生成物から落とす
```

## python3

`bin/models.py` が `configs.jsonc` の唯一の読み手なので、`python3` が必須に
なった（従来も pi の起動モデル設定で任意依存だった）。launcher は起動のたびに
これを呼ぶ。

## モデルを足す

`configs.jsonc` の該当プロバイダの `models` に 1 行足して再生成するだけ:

```jsonc
{ "id": "glm-5.3-air", "tags": [] }   // tag なし = OpenCode と pi には出るが Claude Code のスロットは埋めない
```

```bash
make pi-global && make opencode-global
```

`make list` が各プロバイダのモデルと tag を出すので、どのスロットに何が
入っているかはそこで確認できる。

## エンドポイントの切り替え

`BASE_URL` は全プロバイダ `${<NAME>_BASE_URL:-<既定値>}` で書いてある。
既定値は `configs.jsonc` に残したまま、`.env` の変数で経路を差し替えられる。
git 管理下のファイルを編集しないので、ローカル差分も出ない:

```bash
# .env
KIMI_BASE_URL=https://api.moonshot.ai/anthropic
MIMO_BASE_URL=https://api.xiaomimimo.com/anthropic
```

`.env.example` には各プロバイダの上書き行がコメントアウトで並べてある。
別ホスト・別課金経路・手前に置いたプロキシやゲートウェイ、いずれもここで
差し替える。

## モデルの切り替え

launcher は引数をそのまま `claude` に渡すので、`default` の tag に固定される
わけではない:

```bash
claudeglm --model glm-5.3-flash
```
