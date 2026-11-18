# AI prompts

This project was built with AI assistance (Claude Code). As the assignment asks, this file lists the prompts used. It has two parts:

1. **Development prompts:** what I asked the coding assistant, quoted as written.
2. **Runtime prompts:** the prompts the app itself sends to Llama 3.3 on Workers AI.

## 1. Development prompts

### Session: from the TTS prototype to the word trainer, accounts, tutor, deploy (2026-11-18)

The starting point was a single-syllable tone trainer using TTS audio (the first commit; still on the `legacy-tts` branch).

> can you launch this? Also give me a rundown of what it is.

> can you reliablly tell the tones apart given that the flat tones are relative?

> in this project, there's also the project with a real speaker pronouncing words no?

> i want the program to play a clip and then you have to guess what tones they are. yeah actuall create a new branch and basically start from scratch.
>
> It plays a clip and then you try to guess the tones of both words.
>
> Use the real speaker clips and display the word.
>
> Features I will add, LLM / cloudflare worker, etc...

> try claude chrome now. I opened it

> can you make it save progress via creating a user on the website? very insecure just username password no requirements

> this is also saved in sqlite database

> yeah I want the tutor chat to explain my weak tones and just generally chat with
>
> I want it to be programmed with this info as well:
> [Perceptual Narrowing](https://www.theaudiologyplace.com.au/perceptual-narrowing-babies-language/)
> [Paper on Minimal Pair Training](https://stanford.edu/~jlmcc/papers/McCFiezMcCandliss02.pdf)
> [Inarticulate.xyz minimal pair training](https://inarticulate.xyz/posts/minimal-pair-training/)

> can you pull up the github project i forked?

> it should be good. deploy to cloudflare under my domain under tools for evanyoung.dev

What came out of that session: the two-syllable word quiz with real-speaker audio, accounts and answer history in D1, the practice timer, the focus scheduler, CSV/JSON export, the Llama tutor chat with its knowledge base, and the deployment at tools.evanyoung.dev/tone-trainer.

### Session: requirements check, learner digest Workflow, deploy (2026-11-18)

> does this project satisfy the requirements of the cloudflare thing?

> other use cases for durable objects and workflows? I thought that the memory would mean that i'm using a durable object but i guess not?

> 1. Nightly learner digest (best fit). Every night, or after N new answers: (a) pull the day's attempts from D1, (b) have Llama write a summary of how the learner is progressing, (c) save it as long-term tutor memory, (d) update the scheduler's focus weights. Each step retries if it fails. Then the tutor can say something like "last week you mixed up tones 3 and 6; this week you're improving."
>
> This one seems like a good fit. Save it in a format that is best understood by an LLM. Whether that's JSON, MD or whatever. efficiency in tokens. The idea is to have an exportable object that the user can plug into their own language learning agent-enabled environment.

> how does the job get triggerd?

> does the nightly job run every night? Is this service or need to be run manually? How is this configured?

> yes, and also deploy the app.

> explain the difference between schedules and triggers.

> how does the trigger call a durable object? can you show me the diagram?

> does this meet the requirements?

> yeah add this - Reproducibility: jyutping-chart/ and public/audio/ are gitignored, so someone who clones the repo can't build the word list or the audio. The README should point reviewers to the live site and explain how to get jyutping-chart, or the repo should include a small sample set so it runs without it.
>
> and put a script that you can run to get the audio files.
> Write PROMPTS.md. […]
> Commit, then create the GitHub repo as something like cf_ai_cantonese_tone_trainer and push. […]

> make it up to spec please and thank you

What came out of that session: `DigestWorkflow` (Cloudflare Workflows) with a nightly Cron Trigger, the Markdown learner digest, recency-weighted focus weights for the scheduler, the digest as the tutor's long-term memory, `scripts/fetch-audio.sh`, this README and PROMPTS.md. It was built test-first (failing test, then implementation).

## 2. Runtime prompts (sent to Llama 3.3)

These are in the source. Edit them there.

| Prompt | Where | What it does |
|---|---|---|
| Tutor persona, rules and Cantonese tone facts | `worker/tutor-knowledge.js` (`TUTOR_PERSONA`, `TONE_FACTS`) | The tutor's role, tone, and the facts it may rely on. |
| Research summaries | `worker/tutor-knowledge.js` (`RESEARCH`) | Paraphrased summaries of sources about perceptual learning and minimal pairs, with caveats about what each does and does not show. |
| Tutor system prompt | `worker/tutor.js` (`systemPrompt`, `buildMessages`) | Persona + knowledge + the latest learner digest (long-term memory) + a live summary of the learner's data, then the last 20 chat messages. |
| Digest coach notes | `worker/digest.js` (`coachMessages`) | Asks for 3–5 Markdown bullets under 120 words, using only the data given: what improved or slipped this week vs last week, the most persistent confusion, and one thing to practise next. The previous digest's notes are included for continuity. |
