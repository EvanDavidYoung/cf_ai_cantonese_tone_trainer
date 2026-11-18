import { test } from "node:test";
import assert from "node:assert/strict";
import { digestFacts, renderDigest, DIGEST_VERSION } from "../public/src/digest.js";
import { focusWeights, createScheduler } from "../public/src/scheduler.js";
import { coachMessages, runDigest, startNightlyDigests, digestInstanceId } from "../worker/digest.js";
import { MemoryStore } from "../worker/memory-store.js";

const NOW = new Date("2026-11-18T20:00:00Z");
const TODAY = "2026-11-18";
const daysAgo = (d) => new Date(NOW.getTime() - d * 86_400_000).toISOString();
const A = (word, jyutping, actual, guessed, at = daysAgo(0), gloss = "") => ({ at, word, jyutping, gloss, actual, guessed });

// ---- facts ------------------------------------------------------------------

test("digestFacts splits totals into all time, last 7 days and the 7 days before", () => {
  const history = [
    A("a", "x6 y6", [6, 6], [3, 3], daysAgo(10)), // prev week: 0/2
    A("b", "x6 y6", [6, 6], [6, 3], daysAgo(9)), // prev week: 1/2
    A("c", "x6 y6", [6, 6], [6, 6], daysAgo(1)), // this week: 2/2
    A("d", "x1 y6", [1, 6], [1, 6], daysAgo(0)), // this week: 2/2
    A("e", "x1 y6", [1, 6], [1, 6], daysAgo(30)), // older: 2/2
  ];
  const practice = { "2026-11-18": 600_000, "2026-11-08": 300_000, "2026-10-01": 60_000 };
  const f = digestFacts(history, practice, { now: NOW, today: TODAY });

  assert.equal(f.asOf, TODAY);
  assert.deepEqual(f.all, { words: 5, wordsRight: 3, tones: 10, tonesRight: 7, practiceMs: 960_000 });
  assert.deepEqual(f.week, { words: 2, wordsRight: 2, tones: 4, tonesRight: 4, practiceMs: 600_000 });
  assert.deepEqual(f.prevWeek, { words: 2, wordsRight: 0, tones: 4, tonesRight: 1, practiceMs: 300_000 });

  const t6 = f.tones.find((t) => t.tone === 6);
  assert.deepEqual(t6, { tone: 6, all: [5, 8], week: [3, 3], prevWeek: [1, 4] }); // [right, heard]
});

test("digestFacts ranks confusions and keeps their weekly counts", () => {
  const history = [
    A("a", "x6 y6", [6, 6], [3, 3], daysAgo(10)),
    A("b", "x6 y2", [6, 2], [3, 5], daysAgo(1)),
  ];
  const f = digestFacts(history, {}, { now: NOW, today: TODAY });
  assert.deepEqual(f.confusions[0], { actual: 6, guessed: 3, all: 3, week: 1, prevWeek: 2 });
  assert.deepEqual(f.confusions[1], { actual: 2, guessed: 5, all: 1, week: 1, prevWeek: 0 });
});

test("digestFacts lists stubborn words: missed at least twice and still wrong last time", () => {
  const history = [
    A("電視", "din6 si6", [6, 6], [6, 3], daysAgo(3), "television"),
    A("電視", "din6 si6", [6, 6], [6, 6], daysAgo(2), "television"),
    A("電視", "din6 si6", [6, 6], [3, 6], daysAgo(1), "television"),
    A("時間", "si4 gaan3", [4, 3], [4, 2], daysAgo(3)), // missed twice, then right: not stubborn
    A("時間", "si4 gaan3", [4, 3], [4, 2], daysAgo(2)),
    A("時間", "si4 gaan3", [4, 3], [4, 3], daysAgo(1)),
    A("一次", "jat1 ci3", [1, 3], [1, 2], daysAgo(1)), // missed once: not stubborn
  ];
  const f = digestFacts(history, {}, { now: NOW, today: TODAY });
  assert.deepEqual(f.stubborn, [
    { word: "電視", jyutping: "din6 si6", gloss: "television", misses: 2, tries: 3, lastGuess: [3, 6] },
  ]);
});

test("digestFacts includes recency-weighted focus weights", () => {
  const f = digestFacts([A("a", "x6 y6", [6, 6], [3, 3])], {}, { now: NOW, today: TODAY });
  assert.equal(Object.keys(f.weights).length, 6);
  assert.ok(f.weights[6] > f.weights[1]);
});

// ---- markdown -----------------------------------------------------------------

test("renderDigest writes compact Markdown with frontmatter, tables and coach notes", () => {
  const history = [
    A("電視", "din6 si6", [6, 6], [6, 3], daysAgo(9), "television"),
    A("電視", "din6 si6", [6, 6], [3, 3], daysAgo(1), "television"),
  ];
  const f = digestFacts(history, { "2026-11-18": 125 * 60_000 }, { now: NOW, today: TODAY });
  const md = renderDigest(f, { learner: "evan", notes: "- Tone 6 still slips to 3." });

  assert.match(md, /^---\ntype: cantonese-tone-digest\n/);
  assert.match(md, new RegExp(`\\nv: ${DIGEST_VERSION}\\n`));
  assert.match(md, /\nlearner: evan\n/);
  assert.match(md, /\nas_of: 2026-11-18\n/);
  assert.match(md, /Tones: 1 high level, 2 high rising, 3 mid level, 4 low falling, 5 low rising, 6 low level/);
  assert.match(md, /^all: words 2 \(0% fully right\) · tones 25% \(1\/4\) · practice 2h05m$/m);
  assert.match(md, /^last 7d: words 1 \(0% fully right\) · tones 0% \(0\/2\) · practice 2h05m$/m);
  assert.match(md, /^prev 7d: words 1 \(0% fully right\) · tones 50% \(1\/2\) · practice 0m$/m);
  assert.match(md, /^\|6\|25% n4\|0% n2\|50% n2\|$/m);
  assert.match(md, /^\|1\|-\|-\|-\|$/m);
  assert.match(md, /^6→3: 3 \(7d 2, prev 1\)$/m);
  assert.match(md, /^電視 din6 si6 "television": 2\/2 wrong, last answered 3 3$/m);
  assert.match(md, /^## Focus weights/m);
  assert.match(md, /## Coach notes\n- Tone 6 still slips to 3\.\n?$/);
});

test("renderDigest says so when there are no coach notes or confusions", () => {
  const f = digestFacts([A("a", "x1 y1", [1, 1], [1, 1])], {}, { now: NOW, today: TODAY });
  const md = renderDigest(f, {});
  assert.doesNotMatch(md, /learner:/);
  assert.match(md, /## Confusions[^\n]*\nnone\n/);
  assert.match(md, /## Stubborn words[^\n]*\nnone\n/);
  assert.match(md, /## Coach notes\nnone yet/);
});

// ---- scheduler ------------------------------------------------------------------

test("focusWeights counts recent misses more than old ones", () => {
  const old = [A("a", "x3 y3", [3, 3], [6, 6], daysAgo(60)), A("b", "x6 y6", [6, 6], [6, 6], daysAgo(0))];
  const fresh = [A("a", "x3 y3", [3, 3], [3, 3], daysAgo(60)), A("b", "x6 y6", [6, 6], [3, 3], daysAgo(0))];
  const w1 = focusWeights(old, NOW);
  const w2 = focusWeights(fresh, NOW);
  assert.ok(w2[6] > w1[3], "a fresh tone-6 miss outweighs an old tone-3 miss");
  assert.ok(Math.abs(w1[1] - 0.5) < 1e-9, "no data -> 0.5");
});

test("scheduler uses supplied focus weights, even before minHistory answers", () => {
  const words = [
    { word: "a", syllables: [{ base: "x", tone: 1 }, { base: "y", tone: 1 }] },
    { word: "b", syllables: [{ base: "x", tone: 6 }, { base: "y", tone: 6 }] },
  ];
  // rng: 0 -> focus draw (no misses, so no review draw); 0.5 -> weighted pick.
  const seq = [0, 0.5];
  const s = createScheduler(words, { rng: () => seq.shift() ?? 0, recentGap: 0 });
  const pick = s.next([], { weights: { 1: 0.9, 2: 0.5, 3: 0.5, 4: 0.5, 5: 0.5, 6: 0.01 } });
  assert.equal(pick.reason, "weak-tone");
  assert.equal(pick.word.word, "a");
  assert.equal(pick.tone, 1);
});

// ---- workflow steps -------------------------------------------------------------

function fakeStep() {
  const names = [];
  return {
    names,
    async do(name, configOrFn, maybeFn) {
      names.push(name);
      const fn = maybeFn ?? configOrFn;
      return structuredClone(await fn({ attempt: 1 }));
    },
  };
}

function fakeAi(reply = "- You are improving on tone 6.") {
  const calls = [];
  return {
    calls,
    async run(model, input) {
      calls.push({ model, input });
      if (reply instanceof Error) throw reply;
      return { response: reply };
    },
  };
}

async function storeWithUser() {
  const store = new MemoryStore();
  const id = await store.createUser("Evan", "h", "s");
  return { store, id };
}

test("coachMessages gives the model the facts and the previous notes", () => {
  const f = digestFacts([A("a", "x6 y6", [6, 6], [3, 3])], {}, { now: NOW, today: TODAY });
  const msgs = coachMessages(f, "- last time: tone 6 weak");
  assert.equal(msgs[0].role, "system");
  assert.equal(msgs.at(-1).role, "user");
  assert.match(msgs.at(-1).content, /6→3/);
  assert.match(msgs.at(-1).content, /last time: tone 6 weak/);
});

test("runDigest computes, asks Llama for notes, and saves a digest with focus weights", async () => {
  const { store, id } = await storeWithUser();
  await store.addAttempts(id, [A("電視", "din6 si6", [6, 6], [3, 3])]);
  await store.addPractice(id, [{ day: TODAY, ms: 60_000 }]);
  const step = fakeStep();
  const ai = fakeAi();

  const out = await runDigest({ userId: id }, { store, ai, step, now: () => NOW });

  assert.equal(out.saved, true);
  assert.deepEqual(step.names, ["load learner data", "write coach notes", "save digest and focus weights"]);
  assert.equal(ai.calls.length, 1);
  const d = await store.latestDigest(id);
  assert.equal(d.day, TODAY);
  assert.match(d.markdown, /learner: Evan/);
  assert.match(d.markdown, /You are improving on tone 6/);
  assert.equal(d.notes, "- You are improving on tone 6.");
  assert.ok(d.weights[6] > d.weights[1]);
});

test("runDigest feeds the previous digest's notes to the model", async () => {
  const { store, id } = await storeWithUser();
  await store.addAttempts(id, [A("a", "x6 y6", [6, 6], [3, 3])]);
  await store.addDigest(id, { day: "2026-11-17", markdown: "old", notes: "- PREVIOUS NOTE", weights: {} });
  const ai = fakeAi();
  await runDigest({ userId: id }, { store, ai, step: fakeStep(), now: () => NOW });
  assert.match(ai.calls[0].input.messages.at(-1).content, /PREVIOUS NOTE/);
});

test("runDigest skips learners with no answers", async () => {
  const { store, id } = await storeWithUser();
  const ai = fakeAi();
  const out = await runDigest({ userId: id }, { store, ai, step: fakeStep(), now: () => NOW });
  assert.equal(out.saved, false);
  assert.equal(ai.calls.length, 0);
  assert.equal(await store.latestDigest(id), null);
});

test("runDigest still saves the data digest when the model keeps failing", async () => {
  const { store, id } = await storeWithUser();
  await store.addAttempts(id, [A("a", "x6 y6", [6, 6], [3, 3])]);
  const step = fakeStep();
  step.do = async (name, configOrFn, maybeFn) => {
    step.names.push(name);
    return (maybeFn ?? configOrFn)({ attempt: 1 }); // real Workflows rethrow after the last retry
  };
  await runDigest({ userId: id }, { store, ai: fakeAi(new Error("down")), step, now: () => NOW });
  const d = await store.latestDigest(id);
  assert.ok(d);
  assert.equal(d.notes, "");
  assert.match(d.markdown, /## Coach notes\nnone yet/);
});

test("runDigest also rejects an empty model reply (so the step retries)", async () => {
  const { store, id } = await storeWithUser();
  await store.addAttempts(id, [A("a", "x6 y6", [6, 6], [3, 3])]);
  await runDigest({ userId: id }, { store, ai: fakeAi("   "), step: fakeStep(), now: () => NOW });
  assert.equal((await store.latestDigest(id)).notes, "");
});

test("startNightlyDigests starts one instance per learner active in the last day", async () => {
  const store = new MemoryStore();
  const a = await store.createUser("a", "h", "s");
  const b = await store.createUser("b", "h", "s");
  const c = await store.createUser("c", "h", "s");
  await store.addAttempts(a, [A("x", "x1 y1", [1, 1], [1, 1], daysAgo(0.5))]);
  await store.addAttempts(b, [A("x", "x1 y1", [1, 1], [1, 1], daysAgo(3))]); // inactive
  await store.addAttempts(c, [A("x", "x1 y1", [1, 1], [1, 1], daysAgo(0.1))]);
  const created = [];
  const workflow = {
    async create(opts) {
      if (opts.id.startsWith(`u${c}-`)) throw new Error("instance already exists");
      created.push(opts);
    },
  };
  const out = await startNightlyDigests({ store, workflow, step: fakeStep(), now: () => NOW });
  assert.deepEqual(created, [{ id: digestInstanceId(a, "nightly", TODAY), params: { userId: a } }]);
  assert.equal(out.started, 1);
});

test("digestInstanceId is a valid, stable Workflows instance id", () => {
  assert.equal(digestInstanceId(7, "nightly", "2026-11-18"), "u7-nightly-2026-11-18");
  assert.match(digestInstanceId(7, "n", 3), /^[\w-]{1,100}$/);
});
