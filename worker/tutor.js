// Builds the tutor's prompt: persona + knowledge + a fresh summary of the
// learner's own data (computed from their saved answers and practice time).

import { TONES } from "../public/src/game.js";
import { statsFromHistory } from "../public/src/history.js";
import { TUTOR_PERSONA, TONE_FACTS, RESEARCH } from "./tutor-knowledge.js";

export const TUTOR_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
export const MAX_CONTEXT_MESSAGES = 20;
const TONE_NAMES = { 1: "high level", 2: "high rising", 3: "mid level", 4: "low falling", 5: "low rising", 6: "low level" };

const pct = (n, d) => `${Math.round((100 * n) / d)}%`;
const minutes = (ms) => `${Math.round(ms / 60_000)} min`;
const times = (n) => `${n} time${n === 1 ? "" : "s"}`;

export function learnerSummary(history, practiceDays, today) {
  const totalMs = Object.values(practiceDays).reduce((a, b) => a + b, 0);
  const lines = [`Practice time: today ${minutes(practiceDays[today] ?? 0)}, total ${minutes(totalMs)}`];

  if (!history.length) {
    lines.unshift("No answers yet.");
    return lines.join("\n");
  }

  const s = statsFromHistory(history);
  lines.unshift(
    `Answers: ${s.words} · words fully right: ${s.wordsCorrect} (${pct(s.wordsCorrect, s.words)}) · ` +
      `tones right: ${s.syllablesCorrect} of ${s.syllables} (${pct(s.syllablesCorrect, s.syllables)}) · ` +
      `current streak ${s.streak}, best ${s.bestStreak}`,
  );

  lines.push("", "Accuracy by spoken tone:");
  const mixups = [];
  for (const t of TONES) {
    const row = s.confusion[t];
    const n = TONES.reduce((a, g) => a + row[g], 0);
    lines.push(n ? `- Tone ${t} (${TONE_NAMES[t]}): ${row[t]} of ${n} right (${pct(row[t], n)})` : `- Tone ${t} (${TONE_NAMES[t]}): no data`);
    for (const g of TONES) if (g !== t && row[g]) mixups.push({ t, g, n: row[g] });
  }

  mixups.sort((a, b) => b.n - a.n || a.t - b.t);
  lines.push("", "Most common mix-ups (spoken tone heard as another):");
  if (mixups.length) for (const m of mixups.slice(0, 6)) lines.push(`- tone ${m.t} heard as tone ${m.g}: ${times(m.n)}`);
  else lines.push("- none yet");

  const misses = history.filter((a) => a.actual.some((t, i) => t !== a.guessed[i])).slice(-8).reverse();
  lines.push("", "Recent misses (newest first):");
  if (misses.length) for (const a of misses) lines.push(`- ${a.word} ${a.jyutping} — guessed ${a.guessed.join(" ")}`);
  else lines.push("- none");

  return lines.join("\n");
}

/** The digest body without its frontmatter, as the tutor's week-over-week memory. */
export function memorySection(digest) {
  if (!digest?.markdown) return null;
  const body = digest.markdown.replace(/^---\n[\s\S]*?\n---\n/, "").replace(/^# .*\n/, "").trim();
  return (
    `## Long-term memory (learner digest from ${digest.day}; compare it with the live data to talk about progress)\n` + body
  );
}

export function systemPrompt(summary, memory = null) {
  return [TUTOR_PERSONA, TONE_FACTS, RESEARCH, memorySection(memory), `## This learner's data (live from the app)\n${summary}`]
    .filter(Boolean)
    .join("\n\n");
}

export function buildMessages({ summary, memory = null, past, message }) {
  return [
    { role: "system", content: systemPrompt(summary, memory) },
    ...past.slice(-MAX_CONTEXT_MESSAGES).map(({ role, content }) => ({ role, content })),
    { role: "user", content: message },
  ];
}
