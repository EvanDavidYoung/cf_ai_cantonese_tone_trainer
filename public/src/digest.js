// Learner digest: a compact, LLM-friendly snapshot of how the learner is doing,
// this week vs last week. Built from history + practice time (pure, no I/O), so
// the Worker's nightly Workflow and the browser (guest export) share it.
//
// Rendered as Markdown with a small YAML frontmatter: fewer tokens than JSON,
// and models (and people) read it without a schema. Paste it into any agent.

import { TONES } from "./game.js";
import { focusWeights } from "./scheduler.js";

export const DIGEST_VERSION = 1;
export const TONE_NAMES = { 1: "high level", 2: "high rising", 3: "mid level", 4: "low falling", 5: "low rising", 6: "low level" };

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;
const MAX_CONFUSIONS = 8;
const MAX_STUBBORN = 8;

const emptyTotals = () => ({ words: 0, wordsRight: 0, tones: 0, tonesRight: 0, practiceMs: 0 });
const dayStart = (day) => Date.parse(`${day}T00:00:00Z`);

/**
 * @param history attempts, oldest first
 * @param practiceDays { "YYYY-MM-DD": ms }
 * @param {{now: Date, today: string}} when "today" is the learner's local day
 */
export function digestFacts(history, practiceDays, { now = new Date(), today }) {
  const nowMs = now.getTime();
  const windowOf = (atMs) => (atMs > nowMs - WEEK_MS ? "week" : atMs > nowMs - 2 * WEEK_MS ? "prevWeek" : null);
  const windows = ["all", "week", "prevWeek"];

  const totals = { all: emptyTotals(), week: emptyTotals(), prevWeek: emptyTotals() };
  const tones = Object.fromEntries(TONES.map((t) => [t, { all: [0, 0], week: [0, 0], prevWeek: [0, 0] }]));
  const confusions = new Map(); // "6>3" -> {actual, guessed, all, week, prevWeek}
  const byWord = new Map(); // word -> {word, jyutping, gloss, misses, tries, lastGuess, lastWrong}

  for (const a of history) {
    const ws = ["all", windowOf(Date.parse(a.at))].filter(Boolean);
    const right = a.actual.filter((t, i) => t === a.guessed[i]).length;
    for (const w of ws) {
      totals[w].words++;
      totals[w].tones += a.actual.length;
      totals[w].tonesRight += right;
      if (right === a.actual.length) totals[w].wordsRight++;
    }
    a.actual.forEach((t, i) => {
      const g = a.guessed[i];
      for (const w of ws) {
        tones[t][w][1]++;
        if (g === t) tones[t][w][0]++;
      }
      if (g !== t) {
        const key = `${t}>${g}`;
        const c = confusions.get(key) ?? { actual: t, guessed: g, all: 0, week: 0, prevWeek: 0 };
        for (const w of ws) c[w]++;
        confusions.set(key, c);
      }
    });
    const wrong = right !== a.actual.length;
    const entry = byWord.get(a.word) ?? { word: a.word, jyutping: a.jyutping, gloss: a.gloss ?? "", misses: 0, tries: 0 };
    entry.tries++;
    if (wrong) entry.misses++;
    entry.lastWrong = wrong;
    entry.lastGuess = [...a.guessed];
    byWord.set(a.word, entry);
  }

  const todayMs = dayStart(today);
  for (const [day, ms] of Object.entries(practiceDays)) {
    const ago = (todayMs - dayStart(day)) / DAY_MS;
    totals.all.practiceMs += ms;
    if (ago >= 0 && ago < 7) totals.week.practiceMs += ms;
    else if (ago >= 7 && ago < 14) totals.prevWeek.practiceMs += ms;
  }

  const weights = focusWeights(history, now);
  for (const t of TONES) weights[t] = Math.round(weights[t] * 100) / 100;

  return {
    asOf: today,
    ...Object.fromEntries(windows.map((w) => [w, totals[w]])),
    tones: TONES.map((t) => ({ tone: t, ...tones[t] })),
    confusions: [...confusions.values()]
      .sort((a, b) => b.all - a.all || b.week - a.week || a.actual - b.actual)
      .slice(0, MAX_CONFUSIONS),
    stubborn: [...byWord.values()]
      .filter((e) => e.misses >= 2 && e.lastWrong)
      .sort((a, b) => b.misses - a.misses || b.tries - a.tries)
      .slice(0, MAX_STUBBORN)
      .map(({ word, jyutping, gloss, misses, tries, lastGuess }) => ({ word, jyutping, gloss, misses, tries, lastGuess })),
    weights,
  };
}

const pct = (n, d) => `${Math.round((100 * n) / d)}%`;

export function formatMinutes(ms) {
  const m = Math.round(ms / 60_000);
  return m >= 60 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}m` : `${m}m`;
}

function totalsLine(label, t) {
  if (!t.words) return `${label}: no answers · practice ${formatMinutes(t.practiceMs)}`;
  return (
    `${label}: words ${t.words} (${pct(t.wordsRight, t.words)} fully right) · ` +
    `tones ${pct(t.tonesRight, t.tones)} (${t.tonesRight}/${t.tones}) · practice ${formatMinutes(t.practiceMs)}`
  );
}

const cell = ([right, heard]) => (heard ? `${pct(right, heard)} n${heard}` : "-");

/** The digest as Markdown. `notes` are the coach's (LLM) bullet points, if any. */
export function renderDigest(f, { learner, notes } = {}) {
  const front = ["---", "type: cantonese-tone-digest", `v: ${DIGEST_VERSION}`];
  if (learner) front.push(`learner: ${learner}`);
  front.push(`as_of: ${f.asOf}`, "---");

  const out = [
    ...front,
    "# Cantonese tone perception digest",
    "Task: learner hears a native speaker say a 2-syllable word and names each syllable's tone (1-6). " +
      `Tones: ${Object.entries(TONE_NAMES).map(([t, n]) => `${t} ${n}`).join(", ")}.`,
    "",
    "## Totals",
    totalsLine("all", f.all),
    totalsLine("last 7d", f.week),
    totalsLine("prev 7d", f.prevWeek),
    "",
    "## Tone accuracy (% of syllables with this spoken tone answered right; n = syllables heard)",
    "|tone|all|7d|prev 7d|",
    "|-|-|-|-|",
    ...f.tones.map((t) => `|${t.tone}|${cell(t.all)}|${cell(t.week)}|${cell(t.prevWeek)}|`),
    "",
    "## Confusions (spoken→answered: count all time, last 7d, prev 7d)",
    ...(f.confusions.length
      ? f.confusions.map((c) => `${c.actual}→${c.guessed}: ${c.all} (7d ${c.week}, prev ${c.prevWeek})`)
      : ["none"]),
    "",
    "## Stubborn words (missed 2+ times, still wrong on the last try)",
    ...(f.stubborn.length
      ? f.stubborn.map(
          (s) => `${s.word} ${s.jyutping}${s.gloss ? ` "${s.gloss}"` : ""}: ${s.misses}/${s.tries} wrong, last answered ${s.lastGuess.join(" ")}`,
        )
      : ["none"]),
    "",
    "## Focus weights (recency-weighted miss rate per tone, 0-1; higher = practise more)",
    TONES.map((t) => `${t}:${f.weights[t].toFixed(2)}`).join(" "),
    "",
    "## Coach notes",
    notes?.trim() ? notes.trim() : "none yet",
  ];
  return out.join("\n") + "\n";
}
