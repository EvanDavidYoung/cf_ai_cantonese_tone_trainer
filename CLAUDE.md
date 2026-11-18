# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

A Cantonese tone ear-training app. It plays a real speaker saying a two-character word, shows the word (characters, gloss, toneless jyutping like `din? si?`), and the user picks the tone of each syllable. It runs as a Cloudflare Worker: static frontend in `public/` plus a small JSON API backed by D1 (SQLite) for accounts, answer history, practice time, and tutor chat memory. A tutor chat uses Llama 3.3 on Workers AI. The old single-syllable TTS trainer lives on `main`.

## Commands

```
npm install           # wrangler (only dev dependency)
npm run setup:audio   # clone the upstream jyutping-chart (pinned, sparse) if missing, then build:words
npm run build:words   # regenerate public/data/words.json and copy recordings to public/audio/ (both gitignored)
npm run dev           # apply local D1 migrations, then wrangler dev on http://localhost:8080
npm test              # node --test; no browser or Worker needed
```

`npm run build:words` needs `jyutping-chart/` (Baggio Wong's repo, https://github.com/BaggioWongHK/jyutping-chart, gitignored) next to this file; it is the source of the word list and the ~1,236 recordings. It has no license, so nothing derived from it (word list, audio) is committed; `scripts/fetch-audio.sh` fetches it.

Local D1 data lives in `.wrangler/`. Inspect it with `npx wrangler d1 execute tone-trainer --local --command "SELECT ..."`.

## Architecture

Pure logic modules (no DOM, no storage) are shared by the browser and the Worker and are what the tests cover:

- `public/src/words.js`: jyutping-chart sample words -> quiz words `{word, chars, syllables:[{base,tone}], gloss}`. Only exactly-two-character words with well-formed jyutping.
- `public/src/game.js`: shuffled deck, scoring, `recordResult` (stats with a 6x6 confusion matrix keyed `actual -> guessed`).
- `public/src/history.js`: one attempt record per answer `{at, word, jyutping, gloss, actual[], guessed[]}`. **History is the source of truth**: stats are always derived with `statsFromHistory`. Also CSV export and `isValidAttempt` (used by the API).
- `public/src/practice.js`: practice timer. Each user action credits up to `IDLE_MS` (30s) after it; tab hidden pauses. Time is stored per local day `{ "YYYY-MM-DD": ms }`.
- `public/src/scheduler.js`: picks the next word. 70% random deck; 30% "focus": half the time a missed word (last attempt wrong, not in the last 5 rounds), otherwise (once there are 10+ answers) a word weighted by the user's smoothed per-tone miss rate. `next(history, { weights })` uses the digest's focus weights instead when given (`focusWeights`: miss rate with a 7-day half-life).
- `public/src/digest.js`: learner digest. `digestFacts` (all time / last 7d / prev 7d totals, per-tone accuracy, confusions, stubborn words, focus weights) and `renderDigest`, which writes compact Markdown with YAML frontmatter (`type: cantonese-tone-digest`, `v`). It's meant to be pasted into the learner's own AI agent, so keep it token-lean and self-explanatory; bump `DIGEST_VERSION` if the format changes.

Browser glue: `public/src/main.js` (UI, audio, timer events, sync, export) and `public/src/api.js` (fetch wrapper; session token in localStorage).

Guests keep history and practice time in localStorage. On login/signup the guest data is uploaded to the account and cleared locally. Logged-in clients queue new attempts and practice time and POST them every 15s (and on page hide, with `keepalive`).

Worker (`worker/`):
- `index.js`: routes `/api/*` to `handleApi`, everything else to the static assets binding.
- `api.js`: routes, independent of storage. Takes a store; `MemoryStore` in tests, `D1Store` in production.
- `auth.js`: deliberately minimal (any non-empty username/password, usernames case-insensitive) but passwords are PBKDF2-hashed; bearer-token sessions.
- `tutor.js`: `learnerSummary` (per-tone accuracy, top mix-ups, recent misses, practice time, all computed from saved data) and `buildMessages` (system prompt + last 20 chat messages + new message). Model: `@cf/meta/llama-3.3-70b-instruct-fp8-fast`.
- `digest.js` + `digest-workflow.js`: the `DigestWorkflow` (Cloudflare Workflows). Run with no params (nightly: the Cron Trigger in `wrangler.jsonc`, 04:00 UTC, calls `scheduled` in `worker/index.js`, which creates instance `nightly-<day>`; Workflow `schedules` would be simpler but need a paid plan): it starts one instance per learner who answered in the last day. Run with `{userId}`: steps `load learner data` -> `write coach notes` (Llama, retried; if it keeps failing the digest is saved without notes) -> `save digest and focus weights` (D1 `digests`). Per-learner instances also start from `POST /api/digest` and whenever the learner's answer count crosses a multiple of 50. Instance ids are deterministic (`digestInstanceId`) so retries and repeat triggers don't duplicate work. The latest digest goes into the tutor's system prompt as long-term memory.
- `tutor-knowledge.js`: the tutor's persona/rules, Cantonese tone facts, and paraphrased summaries of the learner-provided sources (perceptual narrowing article; McClelland, Fiez & McCandliss 2002 r/l training paper; inarticulate.xyz minimal-pair post) with caveats about what each does and does not show. Edit this to change what the tutor knows.
- Schema in `migrations/` (users, sessions, attempts with full attempt JSON in `data`, practice per user per day, chat_messages).

API: `POST /api/signup|login|logout`, `GET /api/me`, `GET|POST /api/attempts` (`{attempts:[...]}`), `GET|POST /api/practice` (`{entries:[{day, ms}]}`, added to the day's total), `GET|POST|DELETE /api/chat` (POST `{message, today}` -> `{reply}`; login required), `GET /api/digest` (`{digest: {day, markdown, notes, weights, createdAt} | null}`), `POST /api/digest` (202; starts a digest, at most one per 10 minutes).

The "Learner digest (.md)" export always computes the numbers fresh in the browser and adds the coach notes from the latest server digest; guests get it without notes.

The `AI` binding is remote even in `wrangler dev`, so local chats call Cloudflare and use the account's Workers AI quota. Tests use a fake `ai` object passed to `handleApi(request, store, { ai, digest })` (`digest` is a fake Workflow binding). `npm test` preloads `test/setup.mjs`, which maps `cloudflare:workers` to a stub so `worker/index.js` imports under node. Workflows run locally under `wrangler dev`; `npx wrangler workflows trigger tone-trainer-digest --local` runs the nightly fan-out.

## Deploying

Live at https://tools.evanyoung.dev/tone-trainer/ (Worker `cantonese-tone-trainer`).

- It is a Worker route `tools.evanyoung.dev/tone-trainer*` on the `evanyoung.dev` zone. The rest of `tools.evanyoung.dev` is the separate `tools` Worker (custom domain); the route takes precedence for this path. `worker/index.js` strips the `BASE` prefix (`worker/config.js`) and the client uses relative URLs (`api/...`, `audio/...`), so the same build also works at the root under `wrangler dev`.
- Don't add named exports to `worker/index.js` other than the default handler and the Workflow class (`DigestWorkflow`): Workers treats them as entrypoints and fails to start.
- Production D1 database `tone-trainer` (id in `wrangler.jsonc`). New migrations: `npx wrangler d1 migrations apply tone-trainer --remote` before deploying code that needs them.
- Deploy: `npm run setup:audio` (if `public/data/` or `public/audio/` is missing), then `npx wrangler deploy`.
- Tutor chat is capped at 30 user messages per user per hour (`DEFAULT_CHAT_LIMIT_PER_HOUR` in `worker/api.js`) since every message costs Workers AI usage and signup is open.

## Development

Use red/green TDD: add a failing test in `test/` first, then implement. Keep new logic in the pure modules so it stays testable and reusable server-side (e.g. for an LLM tutor endpoint).
