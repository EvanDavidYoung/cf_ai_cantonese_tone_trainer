import { test } from "node:test";
import assert from "node:assert/strict";
import { makeAttempt, statsFromHistory, historyToCsv, isValidAttempt } from "../public/src/history.js";

const word = {
  word: "電視",
  chars: ["電", "視"],
  syllables: [
    { base: "din", tone: 6 },
    { base: "si", tone: 6 },
  ],
  gloss: "television",
};

test("makeAttempt captures the word, actual and guessed tones, and time", () => {
  const a = makeAttempt(word, [6, 3], new Date("2026-11-18T12:00:00Z"));
  assert.deepEqual(a, {
    at: "2026-11-18T12:00:00.000Z",
    word: "電視",
    jyutping: "din6 si6",
    gloss: "television",
    actual: [6, 6],
    guessed: [6, 3],
  });
});

test("statsFromHistory replays attempts into totals, streaks, and confusion", () => {
  const h = [
    makeAttempt(word, [6, 6]),
    makeAttempt(word, [6, 6]),
    makeAttempt(word, [6, 3]),
  ];
  const s = statsFromHistory(h);
  assert.equal(s.words, 3);
  assert.equal(s.wordsCorrect, 2);
  assert.equal(s.syllablesCorrect, 5);
  assert.equal(s.streak, 0);
  assert.equal(s.bestStreak, 2);
  assert.equal(s.confusion[6][3], 1);
  assert.equal(s.confusion[6][6], 5);
});

test("statsFromHistory of an empty history is all zeros", () => {
  const s = statsFromHistory([]);
  assert.equal(s.words, 0);
  assert.equal(s.bestStreak, 0);
});

test("historyToCsv writes a header and one row per attempt", () => {
  const csv = historyToCsv([makeAttempt(word, [6, 3], new Date("2026-11-18T12:00:00Z"))]);
  const lines = csv.trim().split("\n");
  assert.equal(
    lines[0],
    "time,word,jyutping,meaning,tone1_actual,tone1_guess,tone2_actual,tone2_guess,syllables_correct,word_correct",
  );
  assert.equal(lines[1], "2026-11-18T12:00:00.000Z,電視,din6 si6,television,6,6,6,3,1,0");
});

test("historyToCsv quotes fields containing commas or quotes", () => {
  const w = { ...word, gloss: 'to "watch", TV' };
  const csv = historyToCsv([makeAttempt(w, [6, 6], new Date(0))]);
  assert.match(csv, /,"to ""watch"", TV",/);
});

test("isValidAttempt accepts well-formed attempts and rejects junk", () => {
  assert.equal(isValidAttempt(makeAttempt(word, [1, 2])), true);
  assert.equal(isValidAttempt(null), false);
  assert.equal(isValidAttempt({ ...makeAttempt(word, [1, 2]), guessed: [1, 9] }), false);
  assert.equal(isValidAttempt({ ...makeAttempt(word, [1, 2]), guessed: [1] }), false);
  assert.equal(isValidAttempt({ ...makeAttempt(word, [1, 2]), word: 5 }), false);
  assert.equal(isValidAttempt({ ...makeAttempt(word, [1, 2]), at: "yesterday" }), false);
});
