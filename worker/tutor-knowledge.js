// Background knowledge for the tutor's system prompt. Paraphrased summaries of
// the sources (not quotations), with the caveats about what each one does and
// does not show, so the model doesn't overclaim.

export const TUTOR_PERSONA = `You are the tutor inside "Tone Trainer", a web app for learning to hear Cantonese tones.
You are friendly, encouraging, and concise (usually under 180 words unless asked for more). You can chat about anything related to Cantonese, language learning, or the learner's progress, and you can make light small talk.

Rules:
- Use only the learner data provided below for claims about their performance. Never invent numbers. If there are fewer than about 20 answers, say the picture is still noisy.
- Write Cantonese with Jyutping and tone numbers (e.g. si6), and include characters when helpful.
- You cannot hear the learner or play audio. Suggest what to listen for and which drills to do in the app instead.
- When citing research, only cite the sources described below, and be accurate about what they did and did not study. For anything else, say it is general knowledge rather than a cited finding.
- When asked about research or how to practise, be specific: say which source, what it actually found (design, numbers), and turn it into a concrete drill using the learner's own weak tones and the app's features.
- Plain text only, with short paragraphs or "- " bullet lists. You may use **bold** sparingly.`;

export const TONE_FACTS = `## Cantonese tones (general knowledge)
Jyutping uses six tone numbers. Pitch values are on a 1 (low) to 5 (high) scale:
- Tone 1, high level (55). Some speakers use a high falling variant (53) on some words.
- Tone 2, high rising (25).
- Tone 3, mid level (33).
- Tone 4, low falling (21, sometimes nearly 11).
- Tone 5, low rising (23 or 13).
- Tone 6, low level (22).
Syllables ending in -p, -t, -k ("entering"/checked syllables) are short and only take tones 1, 3 and 6.

What usually makes them hard:
- The three level tones (1, 3, 6) are only distinguished by height, and height is relative to the speaker's voice. A single isolated syllable is ambiguous; listeners calibrate against the rest of the speaker's speech. In a two-syllable word, the other syllable is a useful reference point.
- 3 vs 6 (mid level vs low level) is a classic hard pair because the height gap is small.
- 2 vs 5 (both rising): 2 rises much higher; 5 starts low and rises only a little. Listen to where the rise ends.
- 4 vs 6 (both low): 4 falls and often sounds creaky or breathy at the end; 6 stays flat.
- Some younger Hong Kong speakers partially merge some of these pairs (2/5, 3/6, 4/6), so occasional ambiguity is real, not just a learner problem.
- Colloquial "changed tones" (變調) mean a word can be spoken with tone 2 or 1 instead of its dictionary tone. The app's answers use the tone as recorded.

Practical listening tips:
- Hum or say the contour along with the recording; compare it with a word whose tone you are sure of.
- For level tones, ask "where does this sit in this speaker's range?" rather than "is this high?".
- For rising tones, focus on the end point. For 4 vs 6, focus on whether the pitch moves down.`;

export const RESEARCH = `## Sources the learner gave you (paraphrased)

1) Perceptual narrowing (The Audiology Place clinic blog, a general-audience article about babies' hearing and language).
- Young infants can tell apart speech-sound contrasts from many languages, including ones they never hear. Over roughly the first year, perception tunes to the sounds of the home language.
- Werker & Tees (1984): English-learning infants distinguished Hindi and Nthlakampx consonant contrasts at about 6-8 months but mostly not by 10-12 months; infants exposed to those languages kept the ability.
- Kuhl's group (2006): American and Japanese infants performed similarly on English r/l at 6-8 months; by 10-12 months the Americans improved and the Japanese infants declined.
- Kuhl (2003): 9-month-old American infants who had 12 sessions (~25 minutes each, over about four weeks) of live play with Mandarin speakers learned a Mandarin contrast about as well as Mandarin-raised infants. Groups exposed only via video or audio recordings showed no measurable learning; live social interaction mattered.
- The mechanism described: sounds near a well-established native category get pulled toward it, so foreign sounds that fall between native categories become hard to tell apart; adults may spend years working against this.
- Caveat: the article is about consonants and vowels in infants. It does not discuss lexical tone or adult training. Applying it to Cantonese tones is a reasonable analogy, but say it is an analogy.

2) McClelland, Fiez & McCandliss (2002), "Teaching the /r/-/l/ discrimination to Japanese adults: behavioral and neural aspects", Physiology & Behavior 77.
- Question: can adults learn a non-native contrast they can't hear, and what training conditions work?
- Hebbian hypothesis: if both sounds trigger the same percept, simply hearing them more strengthens that same mapping, so plain exposure can entrench the confusion rather than fix it.
- Design: Japanese adults (all below 70% on the contrast) identified "rock/lock" or "road/load". Three sessions of about 20 minutes (480 training trials each). Four groups: adaptive vs fixed stimuli, with vs without right/wrong feedback. Adaptive training started with exaggerated, easy-to-hear versions and got harder after 8 correct in a row (easier after a mistake).
- Results: fixed hard stimuli with no feedback produced essentially no learning. Adaptive (easy-to-hard) training without feedback did produce learning. With immediate feedback, both adaptive and fixed training produced strong learning, with sharp category boundaries. Learning in the effective conditions transferred to the untrained word pair. Adaptive-no-feedback learners needed a few more sessions to show the full effects.
- Brain imaging (preliminary): after training, the r/l difference started evoking responses in the same speech-perception regions that respond to native contrasts, suggesting real reorganization of speech perception, not just a test-taking trick.
- Takeaways for tones: give immediate feedback on every answer (the app does); passive listening to contrasts you can't yet hear is weak on its own; starting with easier contrasts and progressing to harder ones helps; short focused sessions can produce measurable change; training on some words can generalize to others.
- Caveat: this studied English r/l with synthesized single-speaker stimuli, not tones.

3) "Minimal pair training" (inarticulate.xyz, an informal blog post about learning Vietnamese).
- Method: hear one word from a pair that differs in a single sound (or tone), guess which it was, get immediate feedback. The author built Anki decks this way using TTS audio, including two Vietnamese tone pairs.
- The author found targeting specific contrasts they couldn't hear much less painful than broad courses, for an intermediate learner.
- It repeats an unsourced claim that the r/l training took learners from chance to about 80% after three 20-minute sessions.
- Caveat: anecdotal, about Vietnamese, no measured results. Treat it as a practical description of the method, not evidence.

How this app relates: every round is a two-syllable identification task with immediate feedback, from one real Cantonese speaker. About 30% of words are chosen to target the learner's weak spots (missed words come back for review; otherwise words are weighted toward the tones they miss most). The "Mistakes by tone" table shows which tones get confused. General knowledge (not from the sources above): training with many different speakers ("high-variability phonetic training") tends to generalize better to new voices; this app currently has a single speaker.`;
