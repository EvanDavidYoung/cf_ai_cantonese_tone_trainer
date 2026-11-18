#!/usr/bin/env python3
"""Generate Cantonese tone audio files using Azure TTS.

Usage:
  uv run python generate_audio.py           # generate syllable files (audio/tones/)
  uv run python generate_audio.py --words   # generate word files (jyutping-chart/audio/words/)
                                            # requires export_words.js to have been run first
"""

import json
import os
import sys
from pathlib import Path
import httpx
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env")

AZURE_KEY = os.environ.get("AZURE_SPEECH_KEY", "")
AZURE_REGION = os.environ.get("AZURE_SPEECH_REGION", "eastus")
VOICE = "zh-HK-WanLungNeural"  # swap to zh-HK-HiuGaaiNeural for female

SYLLABLES = {
    "si": [
        (1, "詩"),  # high level   — poetry
        (2, "史"),  # high rising  — history
        (3, "試"),  # mid level    — test
        (4, "時"),  # low falling  — time
        (5, "市"),  # low rising   — market
        (6, "是"),  # low level    — to be
    ],
    "fu": [
        (1, "夫"),  # high level   — husband
        (2, "虎"),  # high rising  — tiger
        (3, "富"),  # mid level    — rich
        (4, "符"),  # low falling  — symbol
        (5, "婦"),  # low rising   — woman
        (6, "父"),  # low level    — father
    ],
}

# Path to jyutping-chart repo (sibling directory)
JYUTPING_CHART = Path(__file__).parent.parent / "jyutping-chart"


def make_ssml(text: str) -> str:
    return (
        '<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="zh-HK">'
        f'<voice name="{VOICE}">{text}</voice>'
        "</speak>"
    )


def generate(text: str, out_path: Path) -> None:
    url = f"https://{AZURE_REGION}.tts.speech.microsoft.com/cognitiveservices/v1"
    headers = {
        "Ocp-Apim-Subscription-Key": AZURE_KEY,
        "Content-Type": "application/ssml+xml",
        "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
        "User-Agent": "cantonese-tone-trainer",
    }
    resp = httpx.post(url, content=make_ssml(text).encode(), headers=headers, timeout=15)
    resp.raise_for_status()
    out_path.write_bytes(resp.content)


def generate_syllables() -> None:
    audio_dir = Path(__file__).parent / "audio"
    audio_dir.mkdir(exist_ok=True)

    # Also write to jyutping-chart/audio/tones/ so the trainer page can use them
    tones_dir = JYUTPING_CHART / "audio" / "tones"
    tones_dir.mkdir(parents=True, exist_ok=True)

    total = 0
    for syllable, tones in SYLLABLES.items():
        print(f"\n{syllable}:")
        for tone_id, char in tones:
            name = f"{syllable}{tone_id}.mp3"
            print(f"  Tone {tone_id}  {char}  → {name} ...", end=" ", flush=True)
            try:
                out = audio_dir / name
                generate(char, out)
                # Mirror to jyutping-chart
                (tones_dir / name).write_bytes(out.read_bytes())
                print("✓")
                total += 1
            except httpx.HTTPStatusError as e:
                print(f"✗  HTTP {e.response.status_code}: {e.response.text[:120]}")
                sys.exit(1)

    print(f"\n{total} files written to {audio_dir}/ and {tones_dir}/")


def generate_words() -> None:
    words_dir = JYUTPING_CHART / "audio" / "words"
    words_json = words_dir / "words.json"

    if not words_json.exists():
        print(f"Error: {words_json} not found.")
        print("Run this first from the jyutping-chart directory:")
        print("  node export_words.js")
        sys.exit(1)

    words = json.loads(words_json.read_text(encoding="utf-8"))
    words_dir.mkdir(parents=True, exist_ok=True)

    total = skipped = errors = 0
    for entry in words:
        chinese = entry["chinese"]
        jyutping = entry["jyutping"]
        filename = jyutping.replace(" ", "-") + ".mp3"
        out_path = words_dir / filename

        if out_path.exists():
            skipped += 1
            continue

        print(f"  {chinese}  ({jyutping})  → {filename} ...", end=" ", flush=True)
        try:
            generate(chinese, out_path)
            print("✓")
            total += 1
        except httpx.HTTPStatusError as e:
            print(f"✗  HTTP {e.response.status_code}: {e.response.text[:120]}")
            errors += 1

    print(f"\n{total} generated, {skipped} skipped, {errors} errors → {words_dir}/")


def main() -> None:
    if not AZURE_KEY:
        print("Error: set AZURE_SPEECH_KEY in .env")
        sys.exit(1)

    if "--words" in sys.argv:
        generate_words()
    else:
        generate_syllables()


if __name__ == "__main__":
    main()
