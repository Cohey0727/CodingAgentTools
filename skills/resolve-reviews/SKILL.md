---
name: resolve-reviews
description: PR のレビューコメントに修正または返信で対応する。「レビュー対応」「レビュー修正」と言われたときに使用。
---

# Resolve PR Review Comments

Fetch review comments from a pull request, make code fixes for valid feedback, and reply to comments that don't warrant changes.

## Workflow

### Step 1: Identify Target PR

入力に応じてPRを特定する:

**PR番号が指定された場合:**

```bash
# PR番号で直接取得
gh pr view <number> --json number,url,headRefName,baseRefName,title,state
```

**PR URLが指定された場合:**

URLからオーナー・リポジトリ・PR番号を抽出する。
例: `https://github.com/owner/repo/pull/123` → owner=`owner`, repo=`repo`, number=`123`

```bash
gh pr view <url> --json number,url,headRefName,baseRefName,title,state
```

**何も指定されていない場合:**

直前に作成したPRを対象とする:

```bash
# 現在のブランチのPRを確認
gh pr view --json number,url,headRefName,baseRefName,title,state 2>/dev/null

# なければ最新のPRを取得
gh pr list --author "@me" --state open --limit 1 --json number,url,headRefName,baseRefName,title
```

PRが見つからない場合はユーザーに通知して終了する。
PRがクローズ済みまたはマージ済みの場合はその旨を伝えて終了する。

### Step 2: Checkout PR Branch

PRのブランチに切り替える（まだの場合）:

```bash
CURRENT=$(git branch --show-current)
PR_BRANCH=<headRefName from Step 1>

if [ "$CURRENT" != "$PR_BRANCH" ]; then
  # 未コミットの変更を先に確認する
  git status --porcelain

  # 変更がなければチェックアウト
  git checkout "$PR_BRANCH"
  git pull origin "$PR_BRANCH"
fi
```

**重要:** 未コミットの変更がある場合は、チェックアウトの前にユーザーに通知してスタッシュまたはコミットを提案する。変更を失わないよう、必ずチェックアウト前に確認する。

### Step 3: Fetch Review Comments

まずリポジトリのオーナー・リポジトリ名と自分のユーザー名を取得する:

```bash
# owner/repo を取得
gh repo view --json nameWithOwner -q '.nameWithOwner'

# 自分のユーザー名を取得（フィルタリング用）
gh api /user -q '.login'
```

`gh` CLI でレビューコメントを取得する（以下2つは並列実行可能）:

```bash
# レビューコメント（diff上のコメント）を取得
gh api repos/{owner}/{repo}/pulls/{number}/comments --paginate

# PR全体のレビュー（approve/request changes等）も確認
gh api repos/{owner}/{repo}/pulls/{number}/reviews --paginate
```

レビューコメントが存在しない場合はユーザーに通知して終了する。

**フィルタリング:**

1. **PENDING状態のレビューを除外する**: `reviews` の `state` が `PENDING` のものは未提出の下書きレビューなので無視する。`COMMENTED`、`CHANGES_REQUESTED`、`APPROVED` のレビューのみ対象とする。
2. **自分自身のコメントをスキップする**: `user.login` が自分のユーザー名と一致するコメントは対象外。
3. **既に返信済みのスレッドをスキップする**: コメントスレッド（`in_reply_to_id` で連結）の最後の返信が自分のユーザー名の場合、そのスレッドは対応済みとみなしスキップする。

**レビュワーの分類:**

各コメントの投稿者を3種類に分類する:

- **AIレビュワー（Bot）**: `user.type` が `"Bot"` のユーザー（例: `github-actions[bot]`, `copilot-pull-request-reviewer[bot]`, `coderabbitai[bot]` 等）
- **自分名義のレビュー**: `user.login` が `gh api /user -q '.login'` と一致するユーザー。実体は ultrareview 等の AI レビューであり、アカウントの持ち主＝作業依頼者なので**AIレビュワーと同じ扱い**にする
- **他人（人間レビュワー）**: 上記以外の `user.type` が `"User"` のユーザー

この分類は Step 9 でスレッドをresolveするかどうかの判定に使用する。**resolve してよいのは AIレビュワーと自分名義のスレッドで、他人のスレッドだけが対象外**。

各コメントについて以下の情報を抽出する:

- `id`: コメントID（返信時に使用）
- `path`: 対象ファイルパス
- `line` / `original_line`: 対象行番号
- `body`: コメント内容
- `user.login`: コメント投稿者
- `in_reply_to_id`: 返信先コメントID（スレッドの判定に使用）
- `diff_hunk`: 該当箇所のdiff

### Step 4: Analyze Each Comment

**大前提 — 過剰な心配は容赦なく却下する:**

レビュー指摘の多くは「起き得るかもしれない」という水準の懸念であり、その大半は実際には起きない。
一方で、それを潰すために入れる防御分岐・null チェック・try/catch・追加バリデーションは、**確実に**可読性を落とす。
**起きない事象への防御より、可読性の劣化のほうが負債として大きい。** 迷ったら可読性を取る。

却下の判断基準:

- その事象が起きる**具体的な経路を現在のコードで示せるか**。示せないなら却下する。
- 「将来 X になったら壊れる」類の指摘は、その変更が実際に予定されていない限り却下する。
- 「念のため」「より安全に」「防御的に」「万が一」と書かれた指摘は、実害の裏取りができない限り却下する。
- **「起き得るが確率は低いので一応対応しておく」は選ばない。** 対応するか却下するかの二択で、確率が無視できるなら却下。
- 却下は遠慮しない。**返信で「なぜ起きないのか」「なぜ可読性を優先するのか」を明示**し、AIレビュワー・自分名義ならスレッドを resolve する。

**重要 — Copilot (`copilot-pull-request-reviewer[bot]`) の指摘は大げさである前提で扱う:**

Copilot は事実誤認は少ないが、影響範囲やリスクを過大に見積もる傾向が強い。典型例:

- 実際には起き得ない / 限定的な条件でしか起きないリスクを「壊れる」「動かない可能性が高い」と断定的に書く
- 些末なスタイル・命名の好みを critical 問題のように強調する
- すでに十分機能している実装に対して「より安全に書くべき」と過剰な防御コードを要求する
- 実プロジェクトの方針やトレードオフを無視した教科書的ベストプラクティスを押し付ける

そのため Copilot の指摘は **指摘内容を鵜呑みにせず、影響範囲とリスクを自分で見積もってから** 対応可否を判断する。具体的には:

- 「壊れる」「動かない」と書かれていても、本当にその経路が踏まれるか / 該当バージョンで再現するかを確認する
- 公式ドキュメント (Context7 / WebFetch) や実コードで仕様を裏取りする
- 大げさな warning と判断したら「妥当でない」側に寄せ、返信で根拠を示して現状維持とする
- 逆に、実害が確実に出るとファクトチェックで判明したものだけ「妥当」として対応する

**他の Bot レビュワー (CodeRabbit, chatgpt-codex-connector 等) も大げさ寄りの傾向はあるが、Copilot ほど顕著ではない。** いずれも事実確認は行うが、Copilot は特に厳しめに疑う。

各レビューコメントについて以下の分析を行う:

1. **対象ファイルを読む**: `path` で指定されたファイルを Read ツールで読み込む
2. **コメント周辺のコードを理解する**: `diff_hunk` と行番号からコンテキストを把握する
3. **指摘の影響範囲とリスクを自分で見積もる** (特に Copilot): 主張されたリスクが実際に発生する経路があるか、再現条件は妥当かを検証する
4. **レビュー指摘の妥当性を判定する**:

**妥当と判定するケース**（いずれも「実際に踏まれる経路がある」ことが前提）:

- バグ修正の指摘
- セキュリティ上の懸念で、到達可能な攻撃経路を示せるもの
- 実測または明らかな計算量悪化があるパフォーマンス問題
- コーディング規約違反
- ロジックの誤り
- 実際に到達する失敗経路のエラーハンドリング漏れ
- テストの不足
- suggested changes（提案されたコード変更）

**妥当でないと判定するケース:**

- 好みの問題で合理的根拠がない
- プロジェクトの方針に反する指摘
- 既に別の方法で対処されている
- コンテキストを誤解している指摘
- スコープ外の大規模リファクタリング要求
- 指摘内容が不明瞭で判断できない
- **発生経路を示せない仮定上のリスク**（"could be null" / "might throw" / "in theory" 止まりのもの）
- **実害がないのにコードを複雑にする防御的処理の追加要求**（起き得ない入力への分岐・バリデーション追加）
- **将来の仮想的な仕様変更に備えた作り込み要求**（その変更が予定されていない場合）
- 得られるものが「理論上の安全性」だけで、対価として可読性を落とす指摘

### Step 5: Present Analysis to User

全コメントの分析結果をユーザーに提示する:

```
PR #<number>: <title>
レビューコメント: <total>件

--- 修正対応するコメント (<count>件) ---

[1] @<reviewer> [Bot] - <file>:<line>
  コメント: <comment body (abbreviated)>
  対応方針: <what will be changed>
  → resolve: Yes（AIレビュワー）

[2] @<reviewer> - <file>:<line>
  コメント: <comment body (abbreviated)>
  対応方針: <what will be changed>
  → resolve: No（人間レビュワー）

--- 返信のみ行うコメント (<count>件) ---

[3] @<reviewer> [Bot] - <file>:<line>
  コメント: <comment body (abbreviated)>
  返信内容: <draft reply>
  → resolve: Yes（AIレビュワー）

[4] @<reviewer> - <file>:<line>
  コメント: <comment body (abbreviated)>
  返信内容: <draft reply>
  → resolve: No（人間レビュワー）
```

却下（過剰な心配・発生経路なし）と判定したものは `返信内容` に**却下理由**を書く。
「一応対応します」で濁さず、却下なら却下と明示する。

**ユーザーの確認を得てから次のステップに進む。**
ユーザーが個別のコメントについて対応方針を変更したい場合はそれに従う。

### Step 6: Apply Code Fixes

妥当と判定されたコメントに対して、コード修正を適用する:

1. 対象ファイルを Read で読む
2. Edit ツールで修正を適用する
3. 修正後のコードが正しいことを確認する

修正時の注意点:

- レビューコメントが `suggestion` ブロック（``suggestion` ... ``）を含む場合は、そのコードを正確に適用する
- 最小限の変更に留める（関連しないリファクタリングはしない）
- ファイルの既存スタイルに従う

### Step 7: Verify Changes

修正が正しく適用されたことを確認する:

```bash
# 変更内容を確認
git diff

# プロジェクトにリンター・型チェックがあれば実行を提案
# 例: npm run lint, npx tsc --noEmit, etc.
```

問題がある場合はユーザーに報告して修正する。

### Step 8: Commit and Push

変更をコミットしてプッシュする:

```bash
# 修正ファイルを個別にステージング
git add <file1> <file2> ...

# コミット
git commit -m "<type>: レビュー指摘に対応 @<branch-name>"

# プッシュ
git push origin <branch-name>
```

コミットメッセージの `<type>` はレビュー修正の内容に応じて選択する:

- バグ修正 → `fix`
- リファクタリング → `refactor`
- 複合的 → `chore`

### Step 9: Post Reply Comments and Resolve Threads

各レビューコメントに対して返信を投稿する。

**返信エンドポイント（重要）:** `pull_number` を URL に含める形式を使うこと。`pulls/comments/{id}/replies` だけでは 404 になる。

```bash
gh api repos/{owner}/{repo}/pulls/{pull_number}/comments/{comment_id}/replies \
  -X POST \
  -f body="<reply body>"
```

**返信スタイル — レビュワー別に厳格に分ける:**

- **AIレビュワー (`user.type == "Bot"`) / 自分名義のレビューへの返信:**
  - **対応方針のみ**を簡潔に書く。
  - **禁止: 「ご指摘ありがとうございます」「ありがとうございます」等の感謝・社交辞令、丁寧語の前置き、絵文字、結びの挨拶。**
  - 修正対応 → 「<何を変更したか> を実施。」のように事実だけ。
  - 返信のみ（変更しない） → 「<理由> のため現状維持。」のように方針だけ。
  - AI は感情を持たないので礼儀は不要。トークンの無駄。

- **他人（人間レビュワー）への返信:**
  - 丁寧で建設的な表現を使う。決して攻撃的にしない。
  - 修正対応 → 「修正しました。」＋必要に応じて補足。
  - 妥当でないと判定 → 丁寧に理由を説明する。

**例（AIレビュワー向け）:**

```
良い例: ai-agents/.env.example に KIGYO_DB_DATABASE_URL のダミー値を追加。
悪い例: ご指摘ありがとうございます。ai-agents/.env.example に KIGYO_DB_DATABASE_URL のダミー値を追加しました。
```

```
良い例: CI 専用 seed であり実 DB へ接続する経路はないため現状維持。
悪い例: ご指摘ありがとうございます。CI 専用 seed であり実 DB へ接続する経路はないため、現状維持とさせてください。
```

過剰な心配を却下する場合は、**起きない根拠**と**可読性を優先した事実**を書く:

```
良い例: 呼び出し元は必ず値を設定しており null になる経路がない。防御分岐は可読性を落とすだけなので現状維持。
悪い例: 念のため null チェックを追加しました。
```

```
良い例: 指摘の条件は現行の入力仕様では発生しない。仮定上のリスクに対する追加バリデーションは入れない。
悪い例: 可能性は低いですが、安全のためガードを追加しました。
```

**AIレビュワー・自分名義のスレッドをresolveする:**

レビュワーがAI（`user.type == "Bot"`）または**自分のアカウント名義**の場合、返信後にスレッドをresolveする。
自分名義のレビューは ultrareview 等の AI レビュー出力であり、アカウントの持ち主が作業依頼者本人なので、
確認待ちにする理由がない。**他人**のスレッドだけはresolveしない（本人が確認してresolveすべきため）。

resolveにはGraphQL APIを使用する。まず対象スレッドの `threadId` を取得し、`resolveReviewThread` ミューテーションを実行する:

```bash
# PR のレビュースレッド一覧を取得（threadId とコメントの対応を得る）
gh api graphql -f query='
  query($owner: String!, $repo: String!, $number: Int!) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $number) {
        reviewThreads(first: 100) {
          nodes {
            id
            isResolved
            comments(first: 1) {
              nodes {
                databaseId
              }
            }
          }
        }
      }
    }
  }
' -f owner="{owner}" -f repo="{repo}" -F number={number}
```

取得した `reviewThreads` から、resolve 対象（AIレビュワーまたは自分名義）のコメントID（`databaseId`）に一致するスレッドの `id`（GraphQLのノードID）を特定する。

```bash
# スレッドをresolveする
gh api graphql -f query='
  mutation($threadId: ID!) {
    resolveReviewThread(input: {threadId: $threadId}) {
      thread {
        isResolved
      }
    }
  }
' -f threadId="{thread_node_id}"
```

**注意:**

- 他人のスレッドは絶対にresolveしない（AIレビュワーと自分名義のスレッドは resolve する）
- 既にresolve済み（`isResolved: true`）のスレッドはスキップする
- レビューコメントが多数ある場合（10件以上）、GitHub APIのレート制限に注意する。必要に応じてリクエスト間に間隔を空ける。

### Step 10: Summary

完了後、対応結果のサマリーを表示する:

```
--- レビュー対応完了 ---
PR: #<number> <title>
修正コミット: <commit hash>
対応済み: <count>件
返信のみ: <count>件
Resolved: <count>件（AIレビュワー・自分名義のスレッド）
未Resolve: <count>件（他人のスレッド）
PR URL: <url>
```

## Language

返信コメントの言語は、レビューコメントの言語に合わせる:

- 英語でレビューされたら英語で返信する
- 日本語でレビューされたら日本語で返信する
- 混在している場合は英語をデフォルトとする

## Rules

- **コード修正後は必ず commit → push まで完了すること。修正だけして commit/push を忘れるのは厳禁。Step 6（修正）→ Step 7（確認）→ Step 8（commit & push）→ Step 9（返信）を必ず一連で実行する。**
- ユーザーの確認なしにコード修正を適用しない
- ユーザーの確認なしにコメントを投稿しない
- `suggestion` ブロックのコードは正確にそのまま適用する（改変しない）
- 修正はレビュー指摘の範囲に限定する（関連しない変更を入れない）
- `git add -A` や `git add .` は使用しない
- `git push --force` は絶対に使用しない
- 他人（人間レビュワー）への返信は丁寧で建設的な表現を使う
- **AIレビュワー（Bot）・自分名義のレビューへの返信は対応方針のみ**。感謝・前置き・社交辞令は一切書かない
- 返信エンドポイントは `repos/{owner}/{repo}/pulls/{pull_number}/comments/{comment_id}/replies` 形式を使う（pull_number 省略形は 404 になる）
- 自分が投稿した返信には返信しない（自分名義の**レビュー指摘**には返信する — ultrareview 等はユーザー名義で投稿される）
- 既に返信済みのコメントスレッドはスキップする
- PRがマージ済み・クローズ済みの場合は操作を行わない
- **過剰な心配・発生経路を示せないリスクの指摘は容赦なく却下する。** 「一応対応」で妥協せず、却下理由を返信に明記して resolve する
- **可読性の劣化は確実な負債、起きない事象への防御は無価値。** トレードオフでは常に可読性を優先する
- セキュリティに関する指摘は、到達可能な攻撃経路を示せるものは常に妥当として最優先で対応する。経路を示せない理論上の懸念は他の過剰指摘と同様に却下する
- コミット前にローカルで変更を確認できるようにする
- AIレビュワー（`user.type == "Bot"`）と自分名義のスレッドは返信後にresolveする
- 他人のスレッドは絶対にresolveしない（本人が確認してresolveする）

## Examples

### PR番号を指定して実行

```
ユーザー: /resolve-reviews 42

1. gh pr view 42 → PR #42: feat: add user authentication
2. ブランチ feat/add-user-auth にチェックアウト
3. レビューコメント3件を取得
4. 分析結果を提示:
   [1] @reviewer - src/auth.ts:15 → 修正対応（バリデーション不足）
   [2] @reviewer - src/auth.ts:30 → 修正対応（エラーハンドリング）
   [3] @reviewer - src/utils.ts:5 → 返信のみ（好みの問題）
5. ユーザー確認 → 承認
6. src/auth.ts を修正
7. git add src/auth.ts && git commit && git push
8. 3件のコメントに返信を投稿
9. サマリー表示
```

### PR URLを指定して実行

```
ユーザー: /resolve-reviews https://github.com/user/repo/pull/42

→ 上記と同じフロー
```

### 指定なしで実行

```
ユーザー: /resolve-reviews

1. 現在のブランチのPRを検索 → PR #42 を発見
2. 以降同じフロー
```

### レビューコメントがない場合

```
ユーザー: /resolve-reviews 42

1. gh pr view 42 → PR #42
2. レビューコメントを取得 → 0件
3. 「レビューコメントはありません。」と通知して終了
```

### suggestion ブロックの対応

レビューコメントに以下のような suggestion ブロックが含まれる場合:

    ```suggestion
    const result = items.filter(item => item.active)
    ```

→ 該当行を suggestion のコードで正確に置換する。コードを改変せずそのまま適用する。
