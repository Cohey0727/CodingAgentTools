---
name: google-calendar
description: 予定・空き時間の確認やカレンダー登録を Google Calendar MCP で処理する。「予定」「スケジュール」「カレンダー」「会議」「空き時間」、schedule / meeting / calendar / availability と言われたときに使用。
---

# Google Calendar

カレンダー関連の依頼は推測で答えず、必ず Google Calendar MCP ツールで実データを取得する。

## ツール

| ツール | 用途 |
|--------|------|
| `get-current-time` | 現在時刻の取得。相対日付（今日・来週・明日）を解決する前に必ず呼ぶ |
| `list-calendars` | カレンダー一覧 |
| `list-events` | 期間指定でイベント取得 |
| `search-events` | キーワード検索 |
| `get-event` | イベント詳細 |
| `create-event` | 新規作成 |
| `update-event` | 更新 |
| `delete-event` | 削除 |
| `get-freebusy` | 空き時間の確認 |
| `respond-to-event` | 招待への応答 |
| `list-colors` | 色一覧 |
| `manage-accounts` | 接続アカウント管理 |

## 手順

1. **相対日付は必ず `get-current-time` で解決する。** セッションに埋め込まれた日付を起点にしない。
2. 対象カレンダーが曖昧なら `list-calendars` で確認する。複数アカウントがあるなら、どれを見たか回答に明記する。
3. 参照系（一覧・検索・空き時間）はそのまま実行してよい。
4. **書き込み系（create / update / delete / respond）は実行前に内容を提示して確認を取る。** 日時・タイトル・参加者・カレンダーを読み上げてから実行する。
5. 予定を並べるときは、時刻・タイトル・場所（あれば）・参加者数を簡潔に。全フィールドを羅列しない。

## 注意

- タイムゾーンは明示する。ユーザーの指定が無ければ現地時間で解釈し、結果にタイムゾーンを添える。
- 「空いてる？」に答えるときは `list-events` ではなく `get-freebusy` を使う。他人のカレンダーでも空き状況だけは取れる。
- 削除は取り消せない。対象イベントを `get-event` で特定してから確認を取る。
