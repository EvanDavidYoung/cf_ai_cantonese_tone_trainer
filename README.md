# cf_ai_cantonese_tone_trainer

An AI-assisted ear-training app for Cantonese tones, built on Cloudflare.

**Try it live:** https://tools.evanyoung.dev/tone-trainer/ (no install needed; sign up with any username and password to use the AI tutor and digests)

You hear a native speaker say a two-character word, see the characters, the English gloss and the toneless jyutping (`din? si?`), and pick the tone (1–6) of each syllable. The app tracks every answer, steers practice toward the tones you miss, and gives you an AI tutor that knows your history. Each night a Cloudflare Workflow writes a **learner digest**: a compact Markdown summary of your progress, with coach notes from Llama, that the tutor uses as long-term memory and that you can export into your own AI tools.

## How it meets the assignment

| Requirement | Implementation |
|---|---|
| **LLM** | Llama 3.3 70B on Workers AI (`@cf/meta/llama-3.3-70b-instruct-fp8-fast`): the tutor chat (`worker/tutor.js`) and the digest's coach notes (`worker/digest.js`). |
| **Workflow / coordination** | `DigestWorkflow`, a Cloudflare Workflow (`worker/digest-workflow.js`). A nightly Cron Trigger starts a fan-out run that creates one instance per active learner; each instance runs durable, individually retried steps: load data from D1 → write coach notes with Llama → save the digest and the scheduler's focus weights. Also started every 50 answers and on demand. |
| **User input (chat)** | The tutor chat panel, plus the quiz itself. |
| **Memory / state** | D1 (SQLite): accounts, every answer, practice time per day, chat history, and the digests. The tutor's prompt is built from this data, and the latest digest is its week-over-week memory. |

## Architecture

```
 Browser (public/)                         Cloudflare
 ─────────────────                         ───────────────────────────────────────────────────
 quiz UI, audio, timer  ── /api/* ──►  Worker (worker/index.js → worker/api.js)
 scheduler (focus weights)                │  auth, attempts, practice, chat, digest routes
 tutor chat                               ├──► D1  users · sessions · attempts · practice
 "Learner digest (.md)" export            │         chat_messages · digests
                                          ├──► Workers AI  Llama 3.3 (tutor replies)
                                          └──► Workflow DIGEST.create(...)
                                                   │
 Cron Trigger 04:00 UTC ──► scheduled() ───────────┘
                                                   ▼
                                  DigestWorkflow (no params): find learners active in the
                                  last day → start one instance per learner
                                                   ▼
                                  DigestWorkflow {userId}:
                                    1 load learner data      (D1)
                                    2 write coach notes      (Workers AI, 3 retries, backoff)
                                    3 save digest + weights  (D1)
```

Pure logic lives in `public/src/` (no DOM, no storage) and is shared by the browser and the Worker:

- `words.js`: source data → quiz words (two-character words only).
- `game.js`: deck, scoring, confusion matrix.
- `history.js`: one record per answer; all stats are derived from history.
- `practice.js`: practice timer (idle and hidden-tab aware), time per local day.
- `scheduler.js`: 70% random, 30% focus (missed words, or words weighted by your weak tones).
- `digest.js`: the learner digest (facts + Markdown).

More detail for contributors is in [`CLAUDE.md`](CLAUDE.md).

### The learner digest

Markdown with a small YAML frontmatter: fewer tokens than JSON, and any LLM can read it without a schema. It includes totals (all time / last 7 days / previous 7 days), per-tone accuracy, top confusions, "stubborn" words, recency-weighted focus weights and coach notes. Paste it into ChatGPT, Claude, or an agent's memory file.

```
---
type: cantonese-tone-digest
v: 1
as_of: 2026-11-18
---
## Totals
last 7d: words 2 (50% fully right) · tones 75% (3/4) · practice 0m
prev 7d: words 2 (0% fully right) · tones 25% (1/4) · practice 0m
## Confusions (spoken→answered: count all time, last 7d, prev 7d)
6→3: 3 (7d 1, prev 2)
## Coach notes
* Tone accuracy improved from 25% to 75% over the last 7 days. …
```

## Run it locally

Requirements: Node 22.15+ (tested on 24), git, and a Cloudflare account (free plan is enough) for Workers AI.

```sh
git clone https://github.com/EvanDavidYoung/cf_ai_cantonese_tone_trainer.git
cd cf_ai_cantonese_tone_trainer
npm install
npm run setup:audio   # fetch the word list + recordings (see below), ~10 s
npx wrangler login    # Workers AI runs remotely, even in local dev
npm run dev           # applies local D1 migrations, serves http://localhost:8080
```

Then open http://localhost:8080, sign up with any username and password, and practise.

- **`setup:audio` is required**: the word list and audio are built from the upstream source, not stored in this repo.
- **Workers AI is a remote binding**, so `wrangler dev` needs `wrangler login`, and local tutor chats and coach notes use your account's Workers AI quota (the free allowance covers testing).
- **Try the Workflow locally:**
  - Per learner: click **Learner digest (.md)** while logged in (or `POST /api/digest`), then export again a minute later to get the coach notes.
  - Nightly fan-out: `npx wrangler workflows trigger tone-trainer-digest --local`.
  - Inspect results: `npx wrangler d1 execute tone-trainer --local --command "SELECT user_id, day, notes FROM digests"`.

### Tests

```sh
npm test   # node --test; no browser, Worker or network needed (93 tests)
```

The Worker is tested with an in-memory store, a fake Workers AI and a fake Workflow binding.

### Audio and word list

The recordings, example words and glosses come from Baggio Wong's [Jyutping Chart](https://github.com/BaggioWongHK/jyutping-chart) (also at cantolounge.com). That repo has no license, so none of it is included here. `npm run setup:audio` (`scripts/fetch-audio.sh`) does a sparse clone of it, pinned to a fixed commit, into `jyutping-chart/`, keeps the 1,236 two-character words that have a recording, and writes `public/data/words.json` and `public/audio/`. All three are gitignored.

## Deploy

```sh
npm run setup:audio                      # if public/data and public/audio are missing
npx wrangler d1 create tone-trainer      # once; put the id in wrangler.jsonc
npx wrangler d1 migrations apply tone-trainer --remote
npx wrangler deploy
```

`wrangler.jsonc` mounts the app on a route at `tools.evanyoung.dev/tone-trainer*`; change `routes` (or set `"workers_dev": true`) for your own account. The Worker strips the `/tone-trainer` prefix (`worker/config.js`), so the same build also works at the root.

## API

All JSON. Login returns a bearer token.

| Route | |
|---|---|
| `POST /api/signup`, `POST /api/login`, `POST /api/logout`, `GET /api/me` | Accounts (any non-empty username/password; PBKDF2-hashed). |
| `GET/POST /api/attempts` | Answer history `{attempts:[...]}`. |
| `GET/POST /api/practice` | Practice time `{entries:[{day, ms}]}`. |
| `GET/POST/DELETE /api/chat` | Tutor chat; POST `{message, today}` → `{reply}`. 30 messages per user per hour. |
| `GET /api/digest` | Latest digest `{day, markdown, notes, weights, createdAt}` or `null`. |
| `POST /api/digest` | Start a digest now (202; at most one per 10 minutes). |

## AI assistance

Built with Claude Code. The prompts used are in [`PROMPTS.md`](PROMPTS.md).
