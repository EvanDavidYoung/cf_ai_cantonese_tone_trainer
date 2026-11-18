import { test } from "node:test";
import assert from "node:assert/strict";
import { toneWeakness, missedWords, createScheduler } from "../public/src/scheduler.js";
import { statsFromHistory } from "../public/src/history.js";

const W = (word, t1, t2) => ({
  word,
  chars: [...word],
  syllables: [{ base: "a", tone: t1 }, { base: "b", tone: t2 }],
  gloss: "",
});
const A = (word, actual, guessed) => ({ at: "2026-11-18T00:00:00Z", word, jyutping: "", actual, guessed });

// Plays back a fixed list of numbers, then repeats the last one.
const scripted = (...xs) => () => (xs.length > 1 ? xs.shift() : xs[0]);

function seeded(seed = 1) {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32);
}

test("toneWeakness is a smoothed miss rate per tone", () => {
  const w0 = toneWeakness(statsFromHistory([]));
  assert.equal(w0[3], 0.5); // no data: (0+1)/(0+2)

  const stats = statsFromHistory([A("x", [6, 6], [3, 6]), A("y", [6, 1], [3, 1])]);
  const w = toneWeakness(stats);
  assert.equal(w[6], (2 + 1) / (3 + 2)); // 3 tone-6 syllables, 2 missed
  assert.equal(w[1], (0 + 1) / (1 + 2)); // 1 tone-1 syllable, 0 missed
});

test("missedWords holds words whose most recent attempt was wrong", () => {
  const h = [
    A("甲", [1, 1], [2, 1]), // wrong
    A("乙", [1, 1], [2, 1]), // wrong
    A("甲", [1, 1], [1, 1]), // then right
  ];
  assert.deepEqual([...missedWords(h)], ["乙"]);
});

test("without a focus roll, draws come from the random deck", () => {
  const words = [W("甲", 1, 1), W("乙", 2, 2), W("丙", 3, 3)];
  const s = createScheduler(words, { rng: scripted(0.99), focusRate: 0.3 });
  const seen = new Set();
  for (let i = 0; i < 3; i++) {
    const { word, reason } = s.next([]);
    assert.equal(reason, "random");
    seen.add(word.word);
  }
  assert.equal(seen.size, 3); // deck cycles through all words
});

test("a focus roll with missed words can serve one for review", () => {
  const words = [W("甲", 1, 1), W("乙", 2, 2), W("丙", 3, 3), W("丁", 4, 4)];
  const history = [A("乙", [2, 2], [5, 2])];
  // 0.1 -> focus (< 0.3); 0.1 -> review (< 0.5); 0 -> first candidate
  const s = createScheduler(words, { rng: scripted(0.1, 0.1, 0), focusRate: 0.3, recentGap: 0 });
  const { word, reason } = s.next(history);
  assert.equal(word.word, "乙");
  assert.equal(reason, "review");
});

test("focus picks skip words seen in the last few rounds", () => {
  const words = [W("甲", 1, 1), W("乙", 2, 2), W("丙", 3, 3), W("丁", 4, 4)];
  const history = [A("乙", [2, 2], [5, 2])]; // 乙 was just shown
  const s = createScheduler(words, { rng: scripted(0.1, 0.1, 0), focusRate: 0.3, recentGap: 5, minHistory: 0 });
  const { word, reason } = s.next(history);
  assert.notEqual(word.word, "乙");
  assert.equal(reason, "weak-tone"); // nothing reviewable, so fall back to weak tones
});

test("weak-tone picks favour words containing the tones you miss", () => {
  const words = [];
  for (let i = 0; i < 20; i++) words.push(W(`六${i}`, 6, 6));
  for (let i = 0; i < 20; i++) words.push(W(`一${i}`, 1, 1));
  // Lots of tone-6 mistakes, tone 1 always right.
  const history = [];
  for (let i = 0; i < 10; i++) history.push(A("x", [6, 1], [3, 1]));

  // focusRate 1 and no review candidates (x is not in the word list) => always weak-tone.
  const s = createScheduler(words, { rng: seeded(3), focusRate: 1, recentGap: 0 });
  let six = 0;
  for (let i = 0; i < 2000; i++) {
    const { word, reason } = s.next(history);
    assert.equal(reason, "weak-tone");
    if (word.syllables[0].tone === 6) six++;
  }
  assert.ok(six > 1500, `expected tone-6 words to dominate, got ${six}/2000`);
});

test("roughly focusRate of draws are focus picks", () => {
  const words = Array.from({ length: 50 }, (_, i) => W(`w${i}`, (i % 6) + 1, 1));
  const history = Array.from({ length: 12 }, () => A("x", [1, 1], [1, 1]));
  const s = createScheduler(words, { rng: seeded(9), focusRate: 0.3 });
  let focus = 0;
  for (let i = 0; i < 4000; i++) if (s.next(history).reason !== "random") focus++;
  assert.ok(focus > 1000 && focus < 1400, `got ${focus}/4000`);
});

test("next reports the weakest tone in the picked word for weak-tone picks", () => {
  const words = [W("六六", 6, 3)];
  const history = Array.from({ length: 5 }, () => A("x", [6, 3], [3, 3]));
  const s = createScheduler(words, { rng: scripted(0), focusRate: 1, recentGap: 0, minHistory: 0 });
  assert.deepEqual(s.next(history), { word: words[0], reason: "weak-tone", tone: 6 });
});

test("weak-tone picks wait until there is enough history to mean something", () => {
  const words = [W("甲", 1, 1), W("乙", 2, 2)];
  const s = createScheduler(words, { rng: scripted(0), focusRate: 1, minHistory: 10 });
  const few = Array.from({ length: 9 }, () => A("z", [1, 1], [1, 1]));
  assert.equal(s.next(few).reason, "random");
  assert.equal(s.next([...few, A("z", [1, 1], [1, 1])]).reason, "weak-tone");
});
