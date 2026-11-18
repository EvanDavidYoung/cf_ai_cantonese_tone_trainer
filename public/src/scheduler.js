// Chooses the next word. Most draws are random (a shuffled deck). A share of
// draws (`focusRate`, default 30%) target trouble spots instead:
//   - "review": a word you got wrong and haven't since got right
//   - "weak-tone": a word weighted toward the tones you miss most often
//     (only once there are `minHistory` answers to go on, unless the caller
//     passes `weights`, e.g. the focus weights from the learner digest)

import { TONES, createDeck, drawWord } from "./game.js";
import { statsFromHistory } from "./history.js";

/** Smoothed miss rate per tone: (misses + 1) / (attempts + 2). 0.5 with no data. */
export function toneWeakness(stats) {
  const out = {};
  for (const t of TONES) {
    const row = stats.confusion[t];
    const attempts = TONES.reduce((s, g) => s + row[g], 0);
    out[t] = (attempts - row[t] + 1) / (attempts + 2);
  }
  return out;
}

const DAY_MS = 86_400_000;

/**
 * Recency-weighted miss rate per tone. Each heard syllable counts
 * 0.5^(age / halfLifeDays), then smoothed like toneWeakness: (misses + 1) / (heard + 2).
 */
export function focusWeights(history, now = new Date(), halfLifeDays = 7) {
  const heard = Object.fromEntries(TONES.map((t) => [t, 0]));
  const missed = { ...heard };
  for (const a of history) {
    const age = Math.max(0, (now.getTime() - Date.parse(a.at)) / DAY_MS);
    const w = 0.5 ** (age / halfLifeDays);
    a.actual.forEach((t, i) => {
      heard[t] += w;
      if (a.guessed[i] !== t) missed[t] += w;
    });
  }
  return Object.fromEntries(TONES.map((t) => [t, (missed[t] + 1) / (heard[t] + 2)]));
}

/** Words whose most recent attempt had at least one wrong tone. */
export function missedWords(history) {
  const last = new Map();
  for (const a of history) {
    last.delete(a.word); // keep insertion order = order of most recent attempt
    last.set(a.word, a.actual.every((t, i) => t === a.guessed[i]));
  }
  return new Set([...last].filter(([, ok]) => !ok).map(([w]) => w));
}

function weightedPick(items, weights, rng) {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rng() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r < 0) return items[i];
  }
  return items[items.length - 1];
}

export function createScheduler(words, { rng = Math.random, focusRate = 0.3, recentGap = 5, minHistory = 10 } = {}) {
  const deck = createDeck(words, rng);
  const byWord = new Map(words.map((w) => [w.word, w]));

  return {
    /** @returns {{word, reason: "random"|"review"|"weak-tone", tone?: number}} */
    next(history, { weights } = {}) {
      if (rng() >= focusRate) return { word: drawWord(deck), reason: "random" };

      const recent = new Set(recentGap > 0 ? history.slice(-recentGap).map((a) => a.word) : []);

      const review = [...missedWords(history)].filter((w) => byWord.has(w) && !recent.has(w));
      if (review.length && rng() < 0.5) {
        return { word: byWord.get(review[Math.floor(rng() * review.length)]), reason: "review" };
      }

      // Too few answers to know which tones are weak: stay random.
      if (!weights && history.length < minHistory) return { word: drawWord(deck), reason: "random" };

      const weak = weights ?? toneWeakness(statsFromHistory(history));
      let pool = words.filter((w) => !recent.has(w.word));
      if (!pool.length) pool = words;
      const word = weightedPick(pool, pool.map((w) => w.syllables.reduce((s, x) => s + weak[x.tone] ** 2, 0)), rng);
      const tone = word.syllables.reduce((best, x) => (weak[x.tone] > weak[best] ? x.tone : best), word.syllables[0].tone);
      return { word, reason: "weak-tone", tone };
    },
  };
}
