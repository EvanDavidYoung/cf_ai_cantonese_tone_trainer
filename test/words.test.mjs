import { test } from "node:test";
import assert from "node:assert/strict";
import { splitJyutping, parseEntry, buildWordList } from "../public/src/words.js";

test("splitJyutping separates base syllable and tone number", () => {
  assert.deepEqual(splitJyutping("din6 si6"), [
    { base: "din", tone: 6 },
    { base: "si", tone: 6 },
  ]);
});

test("splitJyutping tolerates extra whitespace", () => {
  assert.deepEqual(splitJyutping("  wu1   aa1 "), [
    { base: "wu", tone: 1 },
    { base: "aa", tone: 1 },
  ]);
});

test("splitJyutping returns null for malformed syllables", () => {
  assert.equal(splitJyutping("kwai1 geoi"), null); // missing tone
  assert.equal(splitJyutping("dai1 B"), null); // non-jyutping
  assert.equal(splitJyutping("si7"), null); // tone out of range
});

test("parseEntry builds a two-syllable word", () => {
  const w = parseEntry({ chinese: "電視", jyutping: "din6 si6", english: "television" });
  assert.deepEqual(w, {
    word: "電視",
    chars: ["電", "視"],
    syllables: [
      { base: "din", tone: 6 },
      { base: "si", tone: 6 },
    ],
    gloss: "television",
  });
});

test("parseEntry rejects words that are not exactly two characters", () => {
  assert.equal(parseEntry({ chinese: "差", jyutping: "caa1", english: "bad" }), null);
  assert.equal(
    parseEntry({ chinese: "扶手電梯", jyutping: "fu4 sau2 din6 tai1", english: "escalator" }),
    null,
  );
});

test("parseEntry rejects empty, mismatched, or malformed entries", () => {
  assert.equal(parseEntry({}), null);
  assert.equal(parseEntry({ chinese: "" }), null);
  assert.equal(parseEntry({ chinese: "規矩", jyutping: "kwai1 geoi", english: "rules" }), null);
  assert.equal(parseEntry({ chinese: "電視", jyutping: "din6", english: "tv" }), null);
});

test("buildWordList keeps only words with audio and dedupes by word", () => {
  const sample = {
    baa: {
      1: { chinese: "爸爸", jyutping: "baa4 baa1", english: "father" },
      4: { chinese: "爸爸", jyutping: "baa4 baa1", english: "father" },
      5: { chinese: "" },
    },
    si: {
      6: { chinese: "電視", jyutping: "din6 si6", english: "television" },
      4: { chinese: "時間", jyutping: "si4 gaan3", english: "time" },
    },
  };
  const hasAudio = (word) => word !== "時間";
  const list = buildWordList(sample, hasAudio);
  assert.deepEqual(
    list.map((w) => w.word),
    ["爸爸", "電視"],
  );
});
