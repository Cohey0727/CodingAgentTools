# 2026-09-09 — providers/ をやめてルートの configs.json に集約

`providers/<name>/` を廃止した。プロバイダの設定は全部ルートの
`configs.json` 1 枚に入り、API キーはそこから `${環境変数名}` で参照する。
値を持つのはルートの `.env` 1 枚だけ。

| | 変更前 | 変更後 |
|---|---|---|
| モデル・エンドポイント | `providers/<name>/models.json` + `.env` | `configs.json`（git 管理） |
| 秘密情報 | `providers/<name>/.env` × 7 | `.env` × 1（gitignore, chmod 600） |
| キーの参照 | `.env` の `API_TOKEN` | `configs.json` の `"API_KEY": "${DEEPSEEK_API_KEY}"` |
| ヘッダー | `.env` の `HEADERS`（`Name: Value` の行） | `configs.json` の `REQUEST_HEADERS`（オブジェクト） |

## 形

```jsonc
{
  "providers": {
    "deepseek": {
      "API_KEY": "${DEEPSEEK_API_KEY}",
      "BASE_URL": "https://api.deepseek.com/anthropic",
      "defaults": { "context_window": 1000000, "max_tokens": 384000 },
      "claude": { "env": { "CLAUDE_CODE_EFFORT_LEVEL": "max" } },
      "models": [
        { "id": "deepseek-v4-pro",   "tags": ["default"] },
        { "id": "deepseek-v4-flash", "tags": ["small"] }
      ]
    },
    "gtr": {
      "API_KEY": "${GTR_API_KEY}",
      "BASE_URL": "https://gtr-llama.spaghetti-monster.com",
      "REQUEST_HEADERS": {
        "CF-Access-Client-Id": "${GTR_CF_ACCESS_CLIENT_ID}",
        "CF-Access-Client-Secret": "${GTR_CF_ACCESS_CLIENT_SECRET}"
      },
      "models": [ … ]
    }
  }
}
```

参照の書き方は 2 つあり、`API_KEY` / `BASE_URL` / `REQUEST_HEADERS` の
どの値でも同じように使える:

| 書き方 | 解決結果 |
|---|---|
| `${NAME}` | 環境の `NAME`。未設定なら空文字列 |
| `${NAME:-fallback}` | 環境の `NAME`。未設定または空なら `fallback` |

ファイルを読めば、どの値が外から来るのか・来なかったらどうなるのかが分かる。
秘密情報には妥当な既定値がないので前者、エンドポイントは後者で書く。
`API_KEY` が空になったプロバイダは生成物から外れるだけでエラーにはならない。

`providers` のキーがそのままプロバイダ名で、launcher 名（`claude<name>`）、
pi のモデル一覧に出る id、OpenCode の `<name>-anthropic` の元になる。
`claude<name>` にしたくない場合だけ `claude.command` で上書きする。

## キーの読み方

`.env` はサブシェルの中でしか読まない。呼び出し元の環境に全プロバイダの
キーが載らないので、`claudeglm` のプロセスに渡るのは `GLM_API_KEY` だけで、
他のプロバイダのキーは 1 つも入らない。

pi の生成物には `!bash -c '. bin/common.sh; env_value DEEPSEEK_API_KEY'` の形で
変数名だけが入る。キーを差し替えても再生成は要らない。OpenCode は
`{file:…}` 参照なので、差し替えたら `make opencode-global` を再実行する。

## 手順

```bash
cd <repo>
git pull
make setup                    # .env 作成 + 旧 providers/*/.env からの取り込み + 全部再生成
```

`make setup` は旧レイアウトの `providers/<name>/.env` から `API_TOKEN` と
`HEADERS` の各値を、`configs.json` が参照している変数名へ移す。移すのは
**まだ空の変数だけ**なので、二重に走らせても既存の値は壊れない。旧ファイルは
そのまま残るので、`make list` を確認してから消す:

```bash
rm -rf providers/
```

`.gitignore` は `providers/` ごと無視するようにしてあるので、消し忘れても
キーがコミットに載ることはない。

## 変数の対応

| 変更前 | 変更後 |
|---|---|
| `providers/<name>/.env` の `API_TOKEN` | `.env` の `<NAME>_API_KEY`（`configs.json` が参照） |
| `providers/<name>/.env` の `BASE_URL` | `configs.json` の `BASE_URL` |
| `providers/<name>/.env` の `HEADERS` | `configs.json` の `REQUEST_HEADERS` + `.env` の変数 |
| `providers/<name>/models.json` の全部 | `configs.json` の `providers.<name>` |

`ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_BASE_URL` の別名は前段階でなくなっている。

## エンドポイントの切り替え

`BASE_URL` は全プロバイダ `${<NAME>_BASE_URL:-<既定値>}` で書いてある。
既定値は `configs.json` に残したまま、`.env` の変数で経路を差し替えられる。
git 管理下のファイルを編集しないので、ローカル差分も出ない:

```bash
# .env
KIMI_BASE_URL=https://api.moonshot.ai/anthropic
MIMO_BASE_URL=https://api.xiaomimimo.com/anthropic
```

`.env.example` には各プロバイダの上書き行がコメントアウトで並べてある。
別ホスト・別課金経路・手前に置いたプロキシやゲートウェイ、いずれもここで
差し替える。
