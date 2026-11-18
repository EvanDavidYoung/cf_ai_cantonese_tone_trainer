import { test } from "node:test";
import assert from "node:assert/strict";
import { learnerSummary, buildMessages, MAX_CONTEXT_MESSAGES } from "../worker/tutor.js";

const A = (word, jyutping, actual, guessed, at = "2026-11-18T12:00:00Z") => ({ at, word, jyutping, gloss: "", actual, guessed });

test("learnerSummary says so when there is no data yet", () => {
  const s = learnerSummary([], {}, "2026-11-18");
  assert.match(s, /no answers yet/i);
});

test("learnerSummary reports totals, per-tone accuracy, and practice time", () => {
  const history = [
    A("電視", "din6 si6", [6, 6], [6, 3]),
    A("時間", "si4 gaan3", [4, 3], [4, 3]),
  ];
  const s = learnerSummary(history, { "2026-11-17": 60_000, "2026-11-18": 120_000 }, "2026-11-18");
  assert.match(s, /Answers: 2/);
  assert.match(s, /words fully right: 1 \(50%\)/);
  assert.match(s, /tones right: 3 of 4 \(75%\)/);
  assert.match(s, /Tone 6 \(low level\): 1 of 2 right \(50%\)/);
  assert.match(s, /Tone 4 \(low falling\): 1 of 1 right \(100%\)/);
  assert.match(s, /Tone 1 \(high level\): no data/);
  assert.match(s, /today 2 min, total 3 min/);
});

test("learnerSummary ranks the most frequent mix-ups", () => {
  const history = [
    A("a", "x6 y6", [6, 6], [3, 3]), // 6->3 twice
    A("b", "x6 y2", [6, 2], [3, 5]), // 6->3, 2->5
  ];
  const s = learnerSummary(history, {}, "2026-11-18");
  const mix = s.slice(s.indexOf("Most common mix-ups"));
  assert.match(mix, /tone 6 heard as tone 3: 3 times/);
  assert.ok(mix.indexOf("6 heard as tone 3") < mix.indexOf("2 heard as tone 5"));
});

test("learnerSummary lists recent misses with what was guessed", () => {
  const history = [A("電視", "din6 si6", [6, 6], [6, 3])];
  const s = learnerSummary(history, {}, "2026-11-18");
  assert.match(s, /電視 din6 si6 — guessed 6 3/);
});

test("buildMessages puts the system prompt first, keeps recent chat, and ends with the user message", () => {
  const past = Array.from({ length: MAX_CONTEXT_MESSAGES + 6 }, (_, i) => ({
    role: i % 2 ? "assistant" : "user",
    content: `m${i}`,
  }));
  const msgs = buildMessages({ summary: "SUMMARY", past, message: "why do I miss tone 6?" });
  assert.equal(msgs[0].role, "system");
  assert.match(msgs[0].content, /SUMMARY/);
  assert.match(msgs[0].content, /minimal pair/i); // knowledge base included
  assert.deepEqual(msgs.at(-1), { role: "user", content: "why do I miss tone 6?" });
  assert.equal(msgs.length, 1 + MAX_CONTEXT_MESSAGES + 1);
  assert.equal(msgs[1].content, `m6`); // oldest messages dropped
});
