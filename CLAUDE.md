# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

A browser-based Cantonese tone ear-training app. The frontend is plain HTML/CSS/JS (no build step). A Python script generates the required audio files via Azure TTS before the app can function.

## Running the App

**Serve the frontend** — any static file server works, e.g.:
```
python -m http.server 8080
```
Then open `http://localhost:8080`. Opening `index.html` directly as a `file://` URL also works in most browsers.

**Generate audio files** (required once before using the app):
```
uv run python generate_audio.py
```
This calls Azure TTS and writes MP3s to `audio/` as `{syllable}{tone_id}.mp3` (e.g., `si1.mp3`, `fu3.mp3`). Requires `AZURE_SPEECH_KEY` and `AZURE_SPEECH_REGION` in `.env`.

**Install Python dependencies:**
```
uv pip install -e .
```

## Architecture

The app has two independent layers:

**Frontend** (`index.html`, `app.js`, `styles.css`): entirely self-contained vanilla JS. Syllable/tone data is defined at the top of `app.js` in a `syllables` object. Both Jyutping and Yale romanization are stored per-tone entry. The grid is re-rendered on syllable or romanization mode switches. Audio is loaded on demand from `audio/` with `new Audio(...)`.

**Audio generation** (`generate_audio.py`): mirrors the `syllables` data from `app.js` — the `SYLLABLES` dict maps syllable names to `(tone_id, chinese_char)` pairs. The Chinese character is sent as SSML to Azure TTS (voice `zh-HK-WanLungNeural`), and the response MP3 is saved. When adding a new syllable to the app, it must be added to both `app.js` and `generate_audio.py`, then audio regenerated.

**Audio file naming convention:** `{syllable}{tone_id}.mp3` — the frontend constructs paths as `` `audio/${currentSyllable}${toneId}.mp3` ``.

## Adding New Syllables

1. Add an entry to the `syllables` object in `app.js` with all 6 tones (id, icon, jyutping, yale, char, gloss).
2. Add the matching entry to `SYLLABLES` in `generate_audio.py` with the corresponding Chinese characters.
3. Run `uv run python generate_audio.py` to generate the new audio files.
