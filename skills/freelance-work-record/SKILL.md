---
name: freelance-work-record
description: 稼働実績（縦一列カレンダー形式）の PDF を生成する。「稼働実績作って」「稼働表作って」「作業実績まとめて」と言われたときに使用。
---

# 稼働実績 PDF の生成

受け取った日別の稼働明細を、月の全日を縦一列に並べたカレンダー形式の PDF にする。
稼働時間の算出方法はこのスキルの関知外 — 数字はユーザーまたは呼び出し元の会話から受け取る。

## 前提

- 作成者名・出力先は同ディレクトリの `personal-config.json` から読む（**git 管理外**。無ければ `personal-config.example.json` をコピーしてユーザーに記入を依頼して終了）
- デザインは `templates/kadou-jisseki.html` に固定。レイアウト変更の依頼がない限りテンプレートは編集しない
- PDF 化は Chrome ヘッドレスを使う

## Step 1: 入力の収集

会話・引数から以下を確定させる。不足があればユーザーに確認する:

| 項目 | デフォルト |
|---|---|
| 対象年月 | 前月 |
| 相手先（〜分（相手先）の表記） | なし（必須） |
| 日別明細: 日付・時間帯・作業内容 | なし（必須） |
| 出力ファイル名 | `<prefix>_稼働実績.pdf`。請求書とペアで出すときは請求書番号を prefix にする（例: `20260801-1_稼働実績.pdf`）。単体なら `稼働実績_YYYY-MM.pdf` |

## Step 2: 行の生成 → PDF 化

`templates/kadou-jisseki.html` の `{{PLACEHOLDER}}`（ISSUER_NAME / YEAR / MONTH / CLIENT_NAME / ROWS / TOTAL）を置換して
作業ディレクトリ（scratchpad）に HTML を書き、Chrome ヘッドレスで PDF 化する:

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless --disable-gpu --no-pdf-header-footer \
  --print-to-pdf="<output_dir>/<ファイル名>" kadou.html
```

### 行フォーマット（固定ルール）

- 月の全日を出す。稼働のない日も日付だけの空行で出す
- 日付は `MM/DD（曜）`、土曜行は `<tr class="sat">`・日曜行は `<tr class="sun">`
- 行の形: `<tr><td class="date">MM/DD（曜）</td><td class="times">…</td><td class="hours">H:MM</td><td class="work">…</td></tr>`
- 時間帯は 15 分単位、複数区間は全角スペース区切り、日またぎは `25:15` 形式（24 時間超）で開始日に計上
- 稼働時間は `H:MM`、合計も `H:MM`（例: `77:30`）
- 作業内容は 1 日 1 行の要約。複数案件は `／` 区切り、補足は `(名前)` の括弧書き

## Step 3: 検証と送付

1. 生成した PDF を Read で開いて確認する: 1 ページに収まっているか、日別の合計と合計行が一致しているか、ヘッダーや表の文字が不自然に折り返していないか
2. 問題なければ SendUserFile で送付

## よくある調整依頼

- **稼働の手動追加・修正**: 指定日の時間帯を追加・変更し、合計を連動更新（請求書とペアの場合は freelance-invoice スキル側の金額も更新）
- **別請求分の控除**: 一部の時間を別請求書で請求済みの場合、稼働実績はそのままにして freelance-invoice スキル側の数量だけ減らす
- **過大な日の振り分け**: 1 日十数時間など不自然な日は、超過分を近隣の空き日へ移す。移動先の作業内容にはその期間に実際行っていた別の作業を充てる。合計は変えない
