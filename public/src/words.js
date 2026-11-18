// Pure helpers for turning jyutping-chart's sample-word data into quiz words.
// Shared by the build script (Node) and usable in the browser.

const SYLLABLE_RE = /^([a-z]+)([1-6])$/;

/** "din6 si6" -> [{base:"din",tone:6},{base:"si",tone:6}], or null if malformed. */
export function splitJyutping(jyutping) {
  const parts = String(jyutping ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return null;
  const out = [];
  for (const p of parts) {
    const m = SYLLABLE_RE.exec(p);
    if (!m) return null;
    out.push({ base: m[1], tone: Number(m[2]) });
  }
  return out;
}

/** A sample-word entry -> quiz word, or null unless it is a clean two-syllable word. */
export function parseEntry(entry) {
  if (!entry || !entry.chinese) return null;
  const chars = [...entry.chinese];
  if (chars.length !== 2) return null;
  const syllables = splitJyutping(entry.jyutping);
  if (!syllables || syllables.length !== chars.length) return null;
  return { word: entry.chinese, chars, syllables, gloss: entry.english ?? "" };
}

/**
 * sampleWords[syllable][tone] -> unique quiz words that have a recording.
 * @param {(word: string) => boolean} hasAudio
 */
export function buildWordList(sampleWords, hasAudio) {
  const byWord = new Map();
  for (const tones of Object.values(sampleWords)) {
    for (const entry of Object.values(tones)) {
      const w = parseEntry(entry);
      if (w && !byWord.has(w.word) && hasAudio(w.word)) byWord.set(w.word, w);
    }
  }
  return [...byWord.values()].sort((a, b) => a.word.localeCompare(b.word, "zh-Hant"));
}
