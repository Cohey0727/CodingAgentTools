---
name: gh-uploads
description: GitHub の user-attachments に画像・動画をアップロードして URL を取得し、PR / Issue に埋め込む。「PR に画像を貼る」「スクショを添付」「動画をアップロード」と言われたときに使用。
---

# gh-uploads

PR / Issue に画像や動画を添付する。Web UI のドラッグ&ドロップで生成されるのと同じ `user-attachments` の URL を、`gh` のトークンだけで取得する。ブラウザも拡張機能も要らない。

## 前提

`gh auth status` で対象ホストにログイン済みであること。classic PAT（`ghp_`）で 201 が返ることを確認済み。

## アップロード

```bash
REPO=owner/repo
FILE=path/to/shot.png
REPO_ID=$(gh api "repos/$REPO" --jq .id)

curl -s "https://uploads.github.com/user-attachments/assets?name=$(basename "$FILE")&content_type=image/png&repository_id=$REPO_ID" \
  -X POST \
  -H "Authorization: Bearer $(gh auth token)" \
  -H "Accept: application/json" \
  --data-binary "@$FILE"
# → {"url":"https://github.com/user-attachments/assets/<uuid>"}
```

`name`・`content_type`・`repository_id` の3つが必須。`repository_id` は数値 ID で、slug は受け付けない。

複数ファイルは URL を配列に集めてから埋め込む。

```bash
for f in a.png b.png; do
  curl -s "https://uploads.github.com/user-attachments/assets?name=$f&content_type=image/png&repository_id=$REPO_ID" \
    -X POST -H "Authorization: Bearer $(gh auth token)" -H "Accept: application/json" \
    --data-binary "@$f" | sed -n 's/.*"url":"\([^"]*\)".*/\1/p'
done
```

## content_type

| 拡張子 | content_type |
| --- | --- |
| .png | image/png |
| .jpg / .jpeg | image/jpeg |
| .gif | image/gif |
| .webp | image/webp |
| .svg | image/svg+xml |
| .mp4 | video/mp4 |
| .mov | video/quicktime |
| .webm | video/webm |
| .pdf | application/pdf |
| .zip | application/zip |

## 埋め込み

画像は `<img>` で幅を指定する。`![]()` は原寸で出るため、縦長のスクリーンショットが読みづらくなる。

```html
<img width="1600" alt="説明" src="https://github.com/user-attachments/assets/<uuid>" />
```

動画は URL を単独行に置くと GitHub がプレイヤーに変換する。コーデックはブラウザ依存のため H.264 を選ぶ。

```
https://github.com/user-attachments/assets/<uuid>
```

## PR / Issue への差し込み

本文は必ず現在の内容を取得してから追記する。全文を組み直すとユーザーの編集が消える。

```bash
gh pr view <N> --json body --jq .body > /tmp/body.md
# /tmp/body.md の該当セクションに追記する
gh pr edit <N> --body-file /tmp/body.md
```

コメントとして残す場合は `gh pr comment <N> --body-file /tmp/comment.md`。

## 検証

アップロード後は URL を取り直し、元ファイルとサイズが一致することを確認する。

```bash
curl -sL -o /tmp/check -w "%{http_code} %{content_type} %{size_download}\n" \
  -H "Authorization: Bearer $(gh auth token)" "<url>"
```

## 上限

| 種類 | 上限 |
| --- | --- |
| 画像・GIF | 10MB |
| 動画（Free プラン） | 10MB |
| 動画（有料プラン） | 100MB |
| その他 | 25MB |

## 注意

- このエンドポイントは GitHub の REST API リファレンスに載っていない。予告なく壊れうるので、失敗したら Web UI のドラッグ&ドロップに切り替える
- private リポジトリに上げたアセットは、そのリポジトリの閲覧権限を持つ者しか取得できない。URL が公開されるわけではない
- `github.com/upload/policies/assets` を経由する古いフローとは別物。あちらはセッション Cookie が必要で、`gh attach` 系の拡張がブラウザを起動するのはそのため

出典: <https://island94.org/2026/08/programmatically-upload-attachments-to-github-issues-pull-requests-comments>
