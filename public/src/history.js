// Learning history: one record per answered word. Stats are derived from it,
// so the history is the single source of truth (and what gets exported/synced).

import { emptyStats, recordResult } from "./game.js";

export function makeAttempt(word, guesses, now = new Date()) {
  return {
    at: now.toISOString(),
    word: word.word,
    jyutping: word.syllables.map((s) => s.base + s.tone).join(" "),
    gloss: word.gloss ?? "",
    actual: word.syllables.map((s) => s.tone),
    guessed: [...guesses],
  };
}

const isTone = (t) => Number.isInteger(t) && t >= 1 && t <= 6;

export function isValidAttempt(a) {
  return (
    !!a &&
    typeof a === "object" &&
    typeof a.at === "string" &&
    !Number.isNaN(Date.parse(a.at)) &&
    typeof a.word === "string" &&
    a.word.length > 0 &&
    typeof a.jyutping === "string" &&
    (a.gloss === undefined || typeof a.gloss === "string") &&
    Array.isArray(a.actual) &&
    Array.isArray(a.guessed) &&
    a.actual.length > 0 &&
    a.actual.length === a.guessed.length &&
    a.actual.every(isTone) &&
    a.guessed.every(isTone)
  );
}

export function statsFromHistory(history) {
  return history.reduce(
    (stats, a) => recordResult(stats, { syllables: a.actual.map((tone) => ({ tone })) }, a.guessed),
    emptyStats(),
  );
}

const CSV_HEADER = [
  "time", "word", "jyutping", "meaning",
  "tone1_actual", "tone1_guess", "tone2_actual", "tone2_guess",
  "syllables_correct", "word_correct",
];

function csvField(v) {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function historyToCsv(history) {
  const rows = history.map((a) => {
    const right = a.actual.filter((t, i) => t === a.guessed[i]).length;
    return [
      a.at, a.word, a.jyutping, a.gloss,
      a.actual[0], a.guessed[0], a.actual[1] ?? "", a.guessed[1] ?? "",
      right, right === a.actual.length ? 1 : 0,
    ];
  });
  return [CSV_HEADER, ...rows].map((r) => r.map(csvField).join(",")).join("\n") + "\n";
}
