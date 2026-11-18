import { test } from "node:test";
import assert from "node:assert/strict";
import { createDeck, drawWord, scoreGuess, emptyStats, recordResult } from "../public/src/game.js";

const W = (word, t1, t2) => ({
  word,
  chars: [...word],
  syllables: [
    { base: "a", tone: t1 },
    { base: "b", tone: t2 },
  ],
  gloss: "",
});

const words = [W("一二", 1, 2), W("三四", 3, 4), W("五六", 5, 6)];

// Deterministic RNG so shuffles are repeatable.
function seeded(seed = 42) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 2 ** 32;
    return s / 2 ** 32;
  };
}

test("drawWord goes through every word once before repeating", () => {
  const deck = createDeck(words, seeded());
  const firstPass = [drawWord(deck), drawWord(deck), drawWord(deck)].map((w) => w.word);
  assert.deepEqual([...firstPass].sort(), words.map((w) => w.word).sort());
});

test("drawWord reshuffles when exhausted without repeating the last word immediately", () => {
  const deck = createDeck(words, seeded(7));
  let prev = null;
  for (let i = 0; i < 60; i++) {
    const w = drawWord(deck);
    assert.notEqual(w.word, prev, `repeat at draw ${i}`);
    prev = w.word;
  }
});

test("drawWord works with a single-word list", () => {
  const deck = createDeck([words[0]], seeded());
  assert.equal(drawWord(deck).word, "一二");
  assert.equal(drawWord(deck).word, "一二");
});

test("createDeck rejects an empty list", () => {
  assert.throws(() => createDeck([], seeded()));
});

test("scoreGuess marks each syllable independently", () => {
  assert.deepEqual(scoreGuess(words[1], [3, 4]), { perSyllable: [true, true], allCorrect: true });
  assert.deepEqual(scoreGuess(words[1], [3, 6]), { perSyllable: [true, false], allCorrect: false });
  assert.deepEqual(scoreGuess(words[1], [6, 3]), { perSyllable: [false, false], allCorrect: false });
});

test("scoreGuess requires a guess for every syllable", () => {
  assert.throws(() => scoreGuess(words[1], [3, null]));
  assert.throws(() => scoreGuess(words[1], [3]));
});

test("recordResult tallies words, syllables, and streaks", () => {
  let s = emptyStats();
  s = recordResult(s, words[0], [1, 2]); // both right
  s = recordResult(s, words[1], [3, 4]); // both right
  s = recordResult(s, words[2], [5, 3]); // one wrong
  assert.equal(s.words, 3);
  assert.equal(s.wordsCorrect, 2);
  assert.equal(s.syllables, 6);
  assert.equal(s.syllablesCorrect, 5);
  assert.equal(s.streak, 0);
  assert.equal(s.bestStreak, 2);
});

test("recordResult builds a confusion matrix keyed actual -> guessed", () => {
  let s = emptyStats();
  s = recordResult(s, words[2], [5, 3]); // actual 5 guessed 5; actual 6 guessed 3
  s = recordResult(s, W("x", 6, 6), [3, 6]);
  assert.equal(s.confusion[6][3], 2);
  assert.equal(s.confusion[6][6], 1);
  assert.equal(s.confusion[5][5], 1);
  assert.equal(s.confusion[1][1], 0);
});

test("recordResult does not mutate the previous stats", () => {
  const s0 = emptyStats();
  recordResult(s0, words[0], [1, 2]);
  assert.equal(s0.words, 0);
  assert.equal(s0.confusion[1][1], 0);
});
