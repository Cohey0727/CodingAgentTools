# 2026-10-31 — OpenCode の見出しを Subscriptions から API Key に変更

OpenCode の `/models` で、DeepSeek・Local・GTR9・Claude API をまとめていた
見出しを **Subscriptions** から **API Key** に改めた。

```
OpenCode Zen          OpenCode のサービス。/connect で入れる
API Key               providers."API Key"
  DeepSeek deepseek-v4-pro
  Local default
Command Code          providers."Command Code"
  ...
OpenCode Go           OpenCode のサービス。/connect で入れる
```

OpenCode は Zen を先頭に固定し、残りを名前順に並べる。`API Key` は
`Command Code` より前に来るので、Zen の次に出る。

変更点:

- `configs.jsonc` の `providers` のキー `"Subscriptions"` を `"API Key"` に改めた。
  そのキーの下にいる deepseek / local / gtr / claude-api がまとめて移る。
- 生成される `~/.config/opencode/opencode.json` で、この 4 つの `name` が
  `API Key` になる。provider id（`deepseek-anthropic` など）は変わらないので、
  `--model` に書いた id はそのまま使える。
- pi と DeepSeek Harness の生成物は変わらない。

## 手順

```bash
cd <repo>
git pull
make opencode-global
```

手で足した provider を `"Subscriptions"` の下に置いていたら、そのキーも
`"API Key"` に改める。

## 確認

```bash
make list
```

deepseek / local / gtr / claude-api が `-> API Key` と出ること。OpenCode の
`/models` を開き、そのモデルが **API Key** の下に `<label> <model>` で並んでいる
こと。
