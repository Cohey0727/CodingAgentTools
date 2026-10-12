#!/usr/bin/env -S uv run --script --quiet
# /// script
# requires-python = "==3.12.*"  # misaki supports Python < 3.13 only
# dependencies = [
#   "mlx-audio==0.5.8",
#   "misaki==0.9.4",
#   # misaki[en] without spacy-curated-transformers, which pulls in torch.
#   "num2words",
#   "spacy",
#   "phonemizer-fork",
#   "espeakng-loader",
#   "en-core-web-sm @ https://github.com/explosion/spacy-models/releases/download/en_core_web_sm-3.8.0/en_core_web_sm-3.8.0-py3-none-any.whl",
#   # misaki[ja] with unidic-lite: unidic ships without its dictionary and
#   # fails until a separate 526MB `python -m unidic download`.
#   "fugashi",
#   "jaconv",
#   "mojimoji",
#   "pyopenjtalk",
#   "unidic-lite",
# ]
# ///
"""Read the text given as arguments aloud with Kokoro-82M.

  speak.py <text>...
"""

import re
import sys

import numpy as np
import sounddevice as sd
from mlx_audio.tts.utils import load_model

text = " ".join(sys.argv[1:]).strip()
if not text:
    sys.exit("usage: speak.py <text>...")

if re.search(r"[぀-ヿ一-鿿]", text):
    voice, lang_code = "jf_alpha", "j"
else:
    voice, lang_code = "af_heart", "a"

model = load_model("mlx-community/Kokoro-82M-bf16")
# The pipeline chunks non-English text only at ASCII ".!?", and cuts a chunk
# past 510 phonemes, so a long Japanese line would be read only partway.
segments = model.generate(
    text=text, voice=voice, lang_code=lang_code, split_pattern=r"\n+|(?<=[。！？])"
)
for segment in segments:
    sd.play(np.array(segment.audio), segment.sample_rate)
    sd.wait()
