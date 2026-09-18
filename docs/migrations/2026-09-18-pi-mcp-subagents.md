# 2026-09-18 — pi の MCP・サブエージェントと起動モデル

pi には Web 検索とサブエージェントの手段がなく、Claude Code の `Agent` や
WebSearch を前提にしたスキルが pi では動かなかった。pi のパッケージを 2 つ
足し、pi 本体も `make setup` で更新するようにした。あわせて pi の起動モデルを
OpenCode Go の DeepSeek にした。既存のチェックアウトは `make setup` を
1 回流せば揃う。

変わったこと:

- `bin/common.sh` の `PI_PACKAGES` に `npm:pi-mcp-adapter`（`/mcp`）と
  `npm:@tintinweb/pi-subagents`（`/agents`）を追加。
- `make setup` — pi のパッケージ導入の前に `pi update --self` を流す。
- `make pi-global`
  - `~/.pi/agent/mcp.json` の `imports` に `opencode` を足す。MCP サーバーは
    生成済みの `~/.config/opencode/opencode.json` から読まれるので、
    `configs.jsonc` の `opencode.overrides.mcp` が両方の CLI の一覧になる。
    `mcp.json` のほかのキーはそのまま残す。
  - `configs.jsonc` の最上位 `pi.overrides` を `~/.pi/agent/settings.json` に
    最後に deep-merge する。`opencode.overrides` と同じ仕組み。今は
    `defaultProvider` / `defaultModel` を `opencode-go` / `deepseek-v4.1-flash`
    にしている。
- `pi/agents/Explore.md` — サブエージェントパッケージ組み込みの `Explore` は
  Claude Haiku で動くが、この構成では有料の provider にしか Haiku がない。
  同じプロンプトで `model:` を持たない定義に差し替え、親セッションの
  モデルで動かす。`make setup-skills` が `~/.pi/agent/agents/` に symlink する。
- `pi/extensions/dashboard.ts` — to-do の指示をシステムプロンプトに足すのを
  UI のあるセッションだけにした。サブエージェントと `-p` には足さない。
- README の pi パッケージの節は、存在しない `configs.jsonc` の
  `agents.pi.packages` を案内していたので、`PI_PACKAGES` に直した。
