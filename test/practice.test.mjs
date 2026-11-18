import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createPracticeTimer,
  addPractice,
  isValidPracticeEntry,
  formatDuration,
  localDay,
  practiceToCsv,
} from "../public/src/practice.js";

const s = (n) => n * 1000;

test("gaps shorter than the idle limit count in full", () => {
  const t = createPracticeTimer({ idleMs: s(30) });
  t.activity(0);
  t.activity(s(10));
  t.activity(s(25));
  assert.equal(t.elapsed(s(25)), s(25));
});

test("gaps longer than the idle limit are capped at the limit", () => {
  const t = createPracticeTimer({ idleMs: s(30) });
  t.activity(0);
  t.activity(s(100));
  assert.equal(t.elapsed(s(100)), s(30));
});

test("elapsed is live while active and stops growing once idle", () => {
  const t = createPracticeTimer({ idleMs: s(30) });
  assert.equal(t.elapsed(s(5)), 0); // nothing happened yet
  t.activity(0);
  assert.equal(t.elapsed(s(5)), s(5));
  assert.equal(t.isActive(s(5)), true);
  assert.equal(t.elapsed(s(60)), s(30));
  assert.equal(t.isActive(s(60)), false);
});

test("drain returns unsynced time without double counting", () => {
  const t = createPracticeTimer({ idleMs: s(30) });
  t.activity(0);
  assert.equal(t.drain(s(20)), s(20));
  assert.equal(t.drain(s(20)), 0);
  t.activity(s(45)); // window from 0 is capped at 30s; 20s already drained
  assert.equal(t.elapsed(s(45)), s(30));
  assert.equal(t.drain(s(45)), s(10));
});

test("pause stops the clock until the next activity", () => {
  const t = createPracticeTimer({ idleMs: s(30) });
  t.activity(0);
  t.pause(s(5));
  assert.equal(t.elapsed(s(100)), s(5));
  assert.equal(t.isActive(s(6)), false);
  t.activity(s(200)); // starts fresh, no credit for the paused gap
  assert.equal(t.elapsed(s(210)), s(15));
});

test("addPractice accumulates milliseconds per day without mutating", () => {
  const a = {};
  const b = addPractice(a, "2026-11-18", 1000);
  const c = addPractice(b, "2026-11-18", 500);
  assert.deepEqual(a, {});
  assert.deepEqual(c, { "2026-11-18": 1500 });
  assert.deepEqual(addPractice(c, "2026-11-18", 0), c);
});

test("isValidPracticeEntry checks the day format and a sane ms range", () => {
  assert.equal(isValidPracticeEntry({ day: "2026-11-18", ms: 1000 }), true);
  assert.equal(isValidPracticeEntry({ day: "2026-11-18", ms: 0 }), false);
  assert.equal(isValidPracticeEntry({ day: "2026-11-18", ms: 86_400_001 }), false);
  assert.equal(isValidPracticeEntry({ day: "2026-11-18", ms: 1.5 }), false);
  assert.equal(isValidPracticeEntry({ day: "Nov 18", ms: 1000 }), false);
  assert.equal(isValidPracticeEntry(null), false);
});

test("formatDuration shows m:ss under an hour and h:mm:ss above", () => {
  assert.equal(formatDuration(0), "0:00");
  assert.equal(formatDuration(s(65)), "1:05");
  assert.equal(formatDuration(s(3600 + 125)), "1:02:05");
});

test("localDay formats the local calendar date", () => {
  assert.equal(localDay(new Date(2026, 0, 5, 23, 59)), "2026-01-05");
});

test("practiceToCsv lists days in order with minutes", () => {
  const csv = practiceToCsv({ "2026-11-18": 90_000, "2026-11-17": 60_000 });
  assert.equal(csv, "day,seconds,minutes\n2026-11-17,60,1.0\n2026-11-18,90,1.5\n");
});
