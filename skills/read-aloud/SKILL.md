---
name: read-aloud
description: テキストを音声で読み上げる。「読み上げて」「読んで」「音声にして」と言われたときに使用。
---

# Read Aloud - 高品質テキスト読み上げ

テキストファイルまたは指定テキストを、ナチュラルな音声で読み上げる（または音声ファイルとして保存する）。

## TTS エンジン優先順位

以下の順に利用可能なエンジンを自動検出する。

### 1. Kokoro TTS CLI（推奨・最高品質・ローカル実行）

HuggingFace TTS Arena 1位。82Mパラメータで軽量かつ高品質。完全ローカル実行。

セットアップ（初回のみ）:
```bash
pip install kokoro-tts

# モデルファイルを ~/.kokoro/ にダウンロード（任意の固定ディレクトリ）
mkdir -p ~/.kokoro && cd ~/.kokoro
wget https://github.com/nazdridoy/kokoro-tts/releases/download/v1.0.0/voices-v1.0.bin
wget https://github.com/nazdridoy/kokoro-tts/releases/download/v1.0.0/kokoro-v1.0.onnx
```

注意: kokoro-tts コマンドは、カレントディレクトリに `voices-v1.0.bin` と `kokoro-v1.0.onnx` が必要。
実行時は `cd ~/.kokoro &&` を先頭につけるか、モデルファイルがある場所で実行すること。

使い方:
```bash
# ファイル読み上げ（ストリーミング再生）
cd ~/.kokoro && kokoro-tts /path/to/input.txt --stream --lang ja --voice jf_alpha

# ファイルに保存
cd ~/.kokoro && kokoro-tts /path/to/input.txt output.wav --lang ja --voice jf_alpha

# 速度調整
cd ~/.kokoro && kokoro-tts /path/to/input.txt --stream --lang ja --voice jf_alpha --speed 1.1

# 音声ブレンド
cd ~/.kokoro && kokoro-tts /path/to/input.txt --stream --lang ja --voice "jf_alpha:60,jm_kumo:40"
```

日本語音声:
- 女性: jf_alpha, jf_gongitsune, jf_nezumi, jf_tebukuro
- 男性: jm_kumo
- 言語指定: `--lang ja`

Python 要件: 3.9〜3.12（3.13は非対応）

### 2. edge-tts（フォールバック・無料・ネットワーク必要）

Microsoft Edge の TTS エンジン。ネットワーク必要だが無料で高品質。

セットアップ（初回のみ）:
```bash
pip install edge-tts
```

使い方:
```bash
# ファイル読み上げ（ファイルに保存して再生）
edge-tts --voice ja-JP-NanamiNeural --file input.txt --write-media output.mp3
afplay output.mp3

# 男性音声
edge-tts --voice ja-JP-KeitaNeural --file input.txt --write-media output.mp3
```

日本語音声: `ja-JP-NanamiNeural`（女性）、`ja-JP-KeitaNeural`（男性）

### 3. OpenAI TTS（API課金・最高品質）

API 課金あり。短いテキストには最高品質。長いテキスト（5000文字以上）には不向き。

```python
from openai import OpenAI
from pathlib import Path

client = OpenAI()
speech_file = Path("output.mp3")
response = client.audio.speech.create(
    model="tts-1-hd",
    voice="nova",
    input="読み上げるテキスト",
)
response.stream_to_file(speech_file)
```

## Workflow

### Step 1: 入力の特定

ユーザーが指定したテキストまたはファイルを特定する。

- ファイルパスが指定された場合 → そのファイルを読む
- 「台本を読んで」等の曖昧な指示 → カレントディレクトリの scripts/ 等から該当ファイルを探す
- テキストが直接指定された場合 → 一時ファイルに書き出す

### Step 2: エンジンの検出

利用可能なエンジンを自動検出する:

```bash
which kokoro-tts 2>/dev/null && echo "kokoro available"
which edge-tts 2>/dev/null && echo "edge-tts available"
```

- 見つかった場合 → そのまま Step 3 へ進む。セットアップの話はしない。
- いずれも見つからない場合 → 「TTS エンジン優先順位」セクションのセットアップ手順を案内して終了。実行はしない（ユーザーが自分でセットアップする）。

### Step 3: 読み上げ実行

検出されたエンジンで読み上げを実行する。

Kokoro TTS の場合:
```bash
cd ~/.kokoro && kokoro-tts <absolute-path-to-file> --stream --lang ja --voice jf_alpha --speed 1.0
```

edge-tts の場合:
```bash
TMPFILE=$(mktemp /tmp/tts_XXXXXX.mp3)
edge-tts --voice ja-JP-NanamiNeural --file <file> --write-media "$TMPFILE" && afplay "$TMPFILE" && rm "$TMPFILE"
```

### Step 4: オプション対応

ユーザーの要望に応じて調整:

- 「速く」→ `--speed 1.3`
- 「ゆっくり」→ `--speed 0.8`
- 「男性の声で」→ 男性音声に切り替え（kokoro: jm_kumo / edge-tts: ja-JP-KeitaNeural）
- 「保存して」→ ストリーミングではなくファイル出力
- 「MP3で」→ `--format mp3`

## Rules

- 長いテキスト（5000文字以上）は OpenAI TTS を使わない（コスト問題）
- 音声ファイルの保存先はユーザーに確認する（デフォルトはカレントディレクトリ）
- バックグラウンド再生する場合は `afplay` に `&` をつけて実行
- エンジンが見つからない場合はセットアップ手順を案内し、Kokoro TTS を推奨する
- 日本語テキストには必ず日本語音声を使用する
- kokoro-tts 実行時は必ずモデルファイルがあるディレクトリ（~/.kokoro/）から実行する
