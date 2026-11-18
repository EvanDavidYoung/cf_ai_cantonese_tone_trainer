// Practice-time tracking. Each user action credits up to `idleMs` of practice
// after it; if nothing happens for longer than that, the clock stops.

export const IDLE_MS = 30_000;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_ENTRY_MS = 86_400_000;

export function createPracticeTimer({ idleMs = IDLE_MS } = {}) {
  let total = 0; // committed ms
  let last = null; // timestamp of last activity, null when stopped
  let windowCommitted = 0; // ms already committed from the current activity window
  let unsynced = 0;

  const pending = (now) =>
    last == null ? 0 : Math.max(0, Math.min(now - last, idleMs) - windowCommitted);

  const commit = (now) => {
    const p = pending(now);
    total += p;
    unsynced += p;
    windowCommitted += p;
  };

  return {
    activity(now) {
      commit(now);
      last = now;
      windowCommitted = 0;
    },
    pause(now) {
      commit(now);
      last = null;
      windowCommitted = 0;
    },
    elapsed: (now) => total + pending(now),
    isActive: (now) => last != null && now - last < idleMs,
    /** Commit time up to `now` and return ms not yet handed out by a previous drain. */
    drain(now) {
      commit(now);
      const out = unsynced;
      unsynced = 0;
      return out;
    },
  };
}

/** { "YYYY-MM-DD": ms } -> new map with `ms` added to `day`. */
export function addPractice(days, day, ms) {
  if (!ms) return days;
  return { ...days, [day]: (days[day] ?? 0) + ms };
}

export function isValidPracticeEntry(e) {
  return (
    !!e &&
    typeof e.day === "string" &&
    DAY_RE.test(e.day) &&
    Number.isInteger(e.ms) &&
    e.ms > 0 &&
    e.ms <= MAX_ENTRY_MS
  );
}

export function localDay(date = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

export function formatDuration(ms) {
  const sec = Math.floor(ms / 1000);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = String(sec % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

export function practiceToCsv(days) {
  const rows = Object.keys(days)
    .sort()
    .map((d) => `${d},${Math.round(days[d] / 1000)},${(days[d] / 60_000).toFixed(1)}`);
  return ["day,seconds,minutes", ...rows].join("\n") + "\n";
}
