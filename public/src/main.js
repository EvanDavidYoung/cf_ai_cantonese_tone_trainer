import { TONES, scoreGuess, recordResult } from "./game.js";
import { createScheduler } from "./scheduler.js";
import { makeAttempt, statsFromHistory, historyToCsv } from "./history.js";
import { createPracticeTimer, addPractice, localDay, formatDuration, practiceToCsv } from "./practice.js";
import { api, getToken, setToken, ApiError } from "./api.js";
import { digestFacts, renderDigest } from "./digest.js";

const AUDIO_BASE = "audio/";
const GUEST_HISTORY_KEY = "tone-trainer:history:v1";
const GUEST_PRACTICE_KEY = "tone-trainer:practice:v1";
const SYNC_EVERY_MS = 15_000;

// Chao tone letters (1 = low, 5 = high), used to draw each tone's contour.
const CONTOURS = { 1: [5, 5], 2: [2, 5], 3: [3, 3], 4: [2, 1], 5: [2, 3], 6: [2, 2] };
const TONE_NAMES = { 1: "high level", 2: "high rising", 3: "mid level", 4: "low falling", 5: "low rising", 6: "low level" };

const $ = (id) => document.getElementById(id);
const els = {
  word: $("word"), gloss: $("gloss"), hint: $("hint"), stats: $("stats"),
  play: $("play-btn"), action: $("action-btn"), confusion: $("confusion"),
  clock: $("clock"), clockTotal: $("clock-total"),
  account: $("account"), authForm: $("auth-form"), authError: $("auth-error"),
  username: $("username"), password: $("password"),
  exportCount: $("export-count"), exportNote: $("export-note"), reason: $("reason"),
  chatLocked: $("chat-locked"), chatBody: $("chat-body"), chatLog: $("chat-log"), chatForm: $("chat-form"),
  chatInput: $("chat-input"), chatSend: $("chat-send"), chatClear: $("chat-clear"), chatSuggestions: $("chat-suggestions"),
};

// ---- state -----------------------------------------------------------------

let scheduler;
let current = null;
let guesses = [];
let checked = false;
let audio = null;

let user = null; // username when logged in
let history = []; // attempts, oldest first
let stats = statsFromHistory([]);
let practiceDays = {}; // { "YYYY-MM-DD": ms }
let digest = null; // latest server digest (logged in): { day, markdown, notes, weights, createdAt }

// Waiting to be sent to the server (logged-in only).
let outboxAttempts = [];
let outboxPractice = {};

const timer = createPracticeTimer();

// ---- guest storage -----------------------------------------------------------

function readLocal(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function writeLocal(key, value) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

// ---- rendering ---------------------------------------------------------------

function contourSvg(tone) {
  const [a, b] = CONTOURS[tone];
  const y = (v) => 22 - (v - 1) * 4.5;
  return `<svg class="contour" viewBox="0 0 32 26" aria-hidden="true">
    <line x1="4" y1="${y(5)}" x2="4" y2="${y(1)}" class="axis"/>
    <polyline points="8,${y(a)} 28,${y(b)}" class="line"/>
  </svg>`;
}

function renderWord() {
  const w = current;
  els.gloss.textContent = w.gloss;
  els.word.innerHTML = "";
  w.chars.forEach((ch, i) => {
    const col = document.createElement("div");
    col.className = "syllable";
    const tone = checked ? w.syllables[i].tone : guesses[i] ?? "?";
    col.innerHTML = `
      <div class="char" lang="zh-HK">${ch}</div>
      <div class="jp">${w.syllables[i].base}<span class="jp-tone">${tone}</span></div>
      <div class="tones" role="group" aria-label="Tone for ${ch}"></div>`;

    const group = col.querySelector(".tones");
    for (const t of TONES) {
      const b = document.createElement("button");
      b.className = "tone";
      b.title = TONE_NAMES[t];
      b.innerHTML = `<span class="num">${t}</span>${contourSvg(t)}`;
      if (guesses[i] === t) b.classList.add("selected");
      if (checked) {
        b.disabled = true;
        if (t === w.syllables[i].tone) b.classList.add("answer");
        else if (guesses[i] === t) b.classList.add("wrong");
      }
      b.onclick = () => pick(i, t);
      group.appendChild(b);
    }
    if (checked) col.classList.add(guesses[i] === w.syllables[i].tone ? "ok" : "bad");
    els.word.appendChild(col);
  });

  els.action.textContent = checked ? "Next →" : "Check";
  els.action.disabled = !checked && !guesses.every((g) => g != null);
}

function renderStats() {
  const pct = (n, d) => (d ? Math.round((100 * n) / d) + "%" : "–");
  els.stats.innerHTML = `
    <span title="Words with both tones right"><b>${pct(stats.wordsCorrect, stats.words)}</b> words</span>
    <span title="Individual syllables right"><b>${pct(stats.syllablesCorrect, stats.syllables)}</b> tones</span>
    <span title="Current streak (best)"><b>${stats.streak}</b> streak <small>(${stats.bestStreak})</small></span>`;

  let html = `<table><thead><tr><th></th>${TONES.map((t) => `<th>${t}</th>`).join("")}<th>acc</th></tr></thead><tbody>`;
  for (const a of TONES) {
    const row = stats.confusion[a];
    const total = TONES.reduce((s, g) => s + row[g], 0);
    html += `<tr><th title="${TONE_NAMES[a]}">${a}</th>`;
    for (const g of TONES) {
      const n = row[g];
      const cls = n === 0 ? "zero" : a === g ? "hit" : "miss";
      const alpha = total ? Math.min(1, 0.15 + n / total) : 0;
      html += `<td class="${cls}" style="--a:${alpha}">${n || ""}</td>`;
    }
    html += `<td class="acc">${pct(row[a], total)}</td></tr>`;
  }
  els.confusion.innerHTML = html + "</tbody></table>";
  els.exportCount.textContent = `${history.length} answer${history.length === 1 ? "" : "s"}`;
}

function renderClock() {
  const now = Date.now();
  const today = practiceDays[localDay()] ?? 0;
  const total = Object.values(practiceDays).reduce((a, b) => a + b, 0);
  els.clock.textContent = formatDuration(today);
  els.clock.parentElement.classList.toggle("active", timer.isActive(now));
  els.clockTotal.textContent = formatDuration(total);
}

function renderAccount() {
  els.authForm.hidden = !!user;
  els.account.hidden = !user;
  if (user) els.account.querySelector(".who").textContent = user;
  els.chatLocked.hidden = !!user;
  els.chatBody.hidden = !user;
  els.chatClear.hidden = !user;
  if (!user) els.chatLog.innerHTML = "";
}

// ---- tutor chat ------------------------------------------------------------------

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function addBubble(role, text) {
  const div = document.createElement("div");
  div.className = `bubble ${role}`;
  div.innerHTML = escapeHtml(text).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  els.chatLog.appendChild(div);
  els.chatLog.scrollTop = els.chatLog.scrollHeight;
  return div;
}

function renderChat(messages) {
  els.chatLog.innerHTML = "";
  for (const m of messages) addBubble(m.role, m.content);
  els.chatSuggestions.hidden = messages.length > 0;
}

async function loadChat() {
  if (!user) return;
  try {
    renderChat((await api("GET", "api/chat")).messages);
  } catch {
    renderChat([]);
  }
}

let chatBusy = false;

async function sendChat(text) {
  const message = text.trim();
  if (!message || chatBusy || !user) return;
  chatBusy = true;
  els.chatSend.disabled = true;
  els.chatSuggestions.hidden = true;
  els.chatInput.value = "";
  markActive();
  // Bank answers and practice time first so the tutor sees the latest data.
  tick();
  await sync();
  addBubble("user", message);
  const pending = addBubble("assistant pending", "Thinking…");
  try {
    const { reply } = await api("POST", "api/chat", { message, today: localDay() });
    pending.remove();
    addBubble("assistant", reply);
  } catch (e) {
    pending.remove();
    addBubble("error", e.message);
    els.chatInput.value = message;
    if (e instanceof ApiError && e.status === 401) logOutLocally("Session expired. Please log in again.");
  } finally {
    chatBusy = false;
    els.chatSend.disabled = false;
  }
}

async function clearChat() {
  try {
    await api("DELETE", "api/chat");
    renderChat([]);
  } catch (e) {
    addBubble("error", e.message);
  }
}

// ---- game --------------------------------------------------------------------

function play() {
  if (!current) return;
  if (audio) audio.pause();
  audio = new Audio(AUDIO_BASE + encodeURIComponent(current.word) + ".mp3");
  audio.addEventListener("ended", markActive);
  audio.play().catch(() => {
    els.hint.textContent = "⚠ Couldn't play audio. Run `npm run build:words` to copy the recordings.";
  });
}

function pick(i, tone) {
  if (checked) return;
  guesses[i] = guesses[i] === tone ? null : tone;
  renderWord();
}

function check() {
  const { perSyllable, allCorrect } = scoreGuess(current, guesses);
  const attempt = makeAttempt(current, guesses);
  history.push(attempt);
  stats = recordResult(stats, current, guesses);
  if (user) outboxAttempts.push(attempt);
  else writeLocal(GUEST_HISTORY_KEY, history);
  if (user) sync();

  checked = true;
  els.hint.textContent = allCorrect
    ? `✓ ${attempt.jyutping}`
    : `✗ ${attempt.jyutping} — ${perSyllable.filter(Boolean).length}/2 right`;
  renderWord();
  renderStats();
}

const REASON_LABELS = {
  review: "Review: you missed this one",
  "weak-tone": (tone) => `Focus: tone ${tone} (${TONE_NAMES[tone]})`,
};

function showNextWord() {
  // The digest's recency-weighted focus weights steer the "weak tone" picks once one exists.
  const pick = scheduler.next(history, { weights: digest?.weights });
  current = pick.word;
  guesses = current.syllables.map(() => null);
  checked = false;
  const label = REASON_LABELS[pick.reason];
  els.reason.textContent = typeof label === "function" ? label(pick.tone) : label ?? "";
  renderWord();
}

function next() {
  showNextWord();
  els.hint.textContent = "Pick a tone for each syllable.";
  play();
}

function onAction() {
  if (checked) next();
  else if (guesses.every((g) => g != null)) check();
}

// ---- practice time -------------------------------------------------------------

function markActive() {
  timer.activity(Date.now());
}

/** Move newly elapsed practice time into today's total. */
function tick() {
  const ms = timer.drain(Date.now());
  if (ms) {
    const day = localDay();
    practiceDays = addPractice(practiceDays, day, ms);
    if (user) outboxPractice = addPractice(outboxPractice, day, ms);
    else writeLocal(GUEST_PRACTICE_KEY, practiceDays);
  }
  renderClock();
}

// ---- server sync -----------------------------------------------------------------

let syncing = false;

async function sync({ keepalive = false } = {}) {
  if (!user || syncing) return;
  const attempts = outboxAttempts;
  const entries = Object.entries(outboxPractice).map(([day, ms]) => ({ day, ms: Math.round(ms) }));
  if (!attempts.length && !entries.length) return;
  outboxAttempts = [];
  outboxPractice = {};
  syncing = true;
  try {
    if (attempts.length) await api("POST", "api/attempts", { attempts }, { keepalive });
    if (entries.length) await api("POST", "api/practice", { entries }, { keepalive });
    setSyncNote("");
  } catch (e) {
    // Put it back and try again on the next sync.
    outboxAttempts = attempts.concat(outboxAttempts);
    for (const { day, ms } of entries) outboxPractice = addPractice(outboxPractice, day, ms);
    if (e instanceof ApiError && e.status === 401) return logOutLocally("Session expired. Please log in again.");
    setSyncNote("Not saved yet (offline?). Will retry.");
  } finally {
    syncing = false;
  }
}

function setSyncNote(text) {
  els.account.querySelector(".sync").textContent = text;
}

async function loadFromServer() {
  const [{ attempts }, { days }, d] = await Promise.all([
    api("GET", "api/attempts"),
    api("GET", "api/practice"),
    api("GET", "api/digest").catch(() => ({ digest: null })),
  ]);
  history = attempts;
  practiceDays = days;
  digest = d.digest;
  stats = statsFromHistory(history);
}

/** After logging in, move anything practised as a guest into the account. */
async function uploadGuestData() {
  const guestHistory = readLocal(GUEST_HISTORY_KEY, []);
  const guestPractice = readLocal(GUEST_PRACTICE_KEY, {});
  const entries = Object.entries(guestPractice)
    .map(([day, ms]) => ({ day, ms: Math.round(ms) }))
    .filter((e) => e.ms > 0);
  if (guestHistory.length) await api("POST", "api/attempts", { attempts: guestHistory });
  if (entries.length) await api("POST", "api/practice", { entries });
  writeLocal(GUEST_HISTORY_KEY, null);
  writeLocal(GUEST_PRACTICE_KEY, null);
}

function loadGuest() {
  history = readLocal(GUEST_HISTORY_KEY, []);
  practiceDays = readLocal(GUEST_PRACTICE_KEY, {});
  stats = statsFromHistory(history);
}

function logOutLocally(message = "") {
  user = null;
  digest = null;
  setToken(null);
  outboxAttempts = [];
  outboxPractice = {};
  loadGuest();
  els.authError.textContent = message;
  renderAccount();
  renderStats();
  renderClock();
}

async function authenticate(kind) {
  const username = els.username.value.trim();
  const password = els.password.value;
  els.authError.textContent = "";
  if (!username || !password) {
    els.authError.textContent = "Enter a username and password.";
    return;
  }
  tick(); // bank guest time before switching
  try {
    const res = await api("POST", `api/${kind}`, { username, password });
    setToken(res.token);
    user = res.username;
    await uploadGuestData();
    await loadFromServer();
    loadChat();
  } catch (e) {
    if (!user) setToken(null);
    els.authError.textContent = e.message;
    return;
  }
  els.password.value = "";
  renderAccount();
  renderStats();
  renderClock();
}

async function logOut() {
  tick();
  await sync();
  try { await api("POST", "api/logout"); } catch {}
  logOutLocally();
}

// ---- export ----------------------------------------------------------------------

function download(filename, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportFile(kind) {
  tick();
  const stamp = localDay();
  const who = user ? `-${user.replace(/[^\w-]/g, "_")}` : "";
  if (kind === "answers") {
    download(`tone-trainer${who}-answers-${stamp}.csv`, historyToCsv(history), "text/csv");
  } else if (kind === "practice") {
    download(`tone-trainer${who}-practice-${stamp}.csv`, practiceToCsv(practiceDays), "text/csv");
  } else if (kind === "digest") {
    exportDigest(who, stamp);
  } else {
    const data = {
      exportedAt: new Date().toISOString(),
      username: user,
      summary: {
        answers: stats.words,
        wordsCorrect: stats.wordsCorrect,
        tonesCorrect: stats.syllablesCorrect,
        tonesTotal: stats.syllables,
        bestStreak: stats.bestStreak,
        practiceMs: Object.values(practiceDays).reduce((a, b) => a + b, 0),
      },
      confusion: stats.confusion,
      practiceByDay: practiceDays,
      answers: history,
    };
    download(`tone-trainer${who}-${stamp}.json`, JSON.stringify(data, null, 2), "application/json");
  }
}

/**
 * The numbers are always computed fresh here; the coach notes come from the
 * latest server digest (written by the Workflow with Llama). If that digest is
 * not from today, ask the server for a new one for next time.
 */
async function exportDigest(who, stamp) {
  const facts = digestFacts(history, practiceDays, { now: new Date(), today: stamp });
  const notes = digest?.notes ? `_written ${digest.day}_\n${digest.notes}` : "";
  download(`tone-trainer${who}-digest-${stamp}.md`, renderDigest(facts, { learner: user ?? undefined, notes }), "text/markdown");

  if (!user) {
    els.exportNote.textContent = "Log in to get coach notes written by the tutor in your digest.";
    return;
  }
  if (digest?.day === stamp) return;
  els.exportNote.textContent = "Asking the tutor for fresh coach notes…";
  try {
    await sync();
    await api("POST", "api/digest");
    els.exportNote.textContent = "Fresh coach notes are being written. Export again in a minute to include them.";
    setTimeout(refreshDigest, 60_000);
  } catch (e) {
    els.exportNote.textContent = `Couldn't start new coach notes: ${e.message}`;
  }
}

async function refreshDigest() {
  if (!user) return;
  try {
    digest = (await api("GET", "api/digest")).digest;
    if (digest?.day === localDay()) els.exportNote.textContent = `Coach notes updated (${digest.day}).`;
  } catch {}
}

// ---- events ------------------------------------------------------------------------

const inField = (e) => e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;

document.addEventListener("pointerdown", (e) => { if (!inField(e)) markActive(); });

document.addEventListener("keydown", (e) => {
  if (inField(e) || !current || e.metaKey || e.ctrlKey || e.altKey) return;
  markActive();
  if (e.key >= "1" && e.key <= "6" && !checked) {
    const i = guesses.findIndex((g) => g == null);
    if (i !== -1) pick(i, Number(e.key));
  } else if (e.key === "Backspace" && !checked) {
    const i = guesses.findLastIndex((g) => g != null);
    if (i !== -1) { guesses[i] = null; renderWord(); }
  } else if (e.key === " ") {
    e.preventDefault();
    play();
  } else if (e.key === "Enter") {
    e.preventDefault();
    onAction();
  }
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    timer.pause(Date.now());
    tick();
    sync({ keepalive: true });
  }
});
window.addEventListener("pagehide", () => {
  timer.pause(Date.now());
  tick();
  sync({ keepalive: true });
});

els.play.onclick = play;
els.action.onclick = onAction;
els.authForm.addEventListener("submit", (e) => {
  e.preventDefault();
  authenticate(e.submitter?.value === "signup" ? "signup" : "login");
});
els.account.querySelector(".logout").onclick = logOut;
els.chatForm.addEventListener("submit", (e) => {
  e.preventDefault();
  sendChat(els.chatInput.value);
});
els.chatInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    sendChat(els.chatInput.value);
  }
});
els.chatSuggestions.querySelectorAll(".chip").forEach((b) => (b.onclick = () => sendChat(b.textContent)));
els.chatClear.onclick = clearChat;
document.querySelectorAll("[data-export]").forEach((b) => (b.onclick = () => exportFile(b.dataset.export)));

// ---- start -----------------------------------------------------------------------

async function init() {
  if (getToken()) {
    try {
      user = (await api("GET", "api/me")).username;
      await loadFromServer();
      loadChat();
    } catch (e) {
      user = null;
      if (e instanceof ApiError && e.status === 401) setToken(null);
      loadGuest();
    }
  } else {
    loadGuest();
  }
  renderAccount();
  renderStats();
  renderClock();
  setInterval(tick, 1000);
  setInterval(() => sync(), SYNC_EVERY_MS);

  try {
    scheduler = createScheduler(await (await fetch("data/words.json")).json());
  } catch {
    els.gloss.textContent = "Couldn't load data/words.json. Run `npm run setup:audio`.";
    return;
  }
  els.play.disabled = false;
  showNextWord();
  els.hint.textContent = "Press Play (or Space) to hear the word, then pick both tones.";
}

init();
