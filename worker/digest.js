// The learner-digest Workflow's steps, kept free of the Workers runtime so they
// run under node --test. `step` is a Workflows WorkflowStep (or a fake in tests):
// each step.do result is persisted, and a failed step is retried on its own.

import { digestFacts, renderDigest } from "../public/src/digest.js";
import { localDay } from "../public/src/practice.js";
import { TUTOR_MODEL } from "./tutor.js";

const DAY_MS = 86_400_000;

/** Workflow instance ids are unique per Workflow, so a fixed id makes a trigger idempotent. */
export const digestInstanceId = (userId, reason, key) => `u${userId}-${reason}-${key}`;

const COACH_STEP = { retries: { limit: 3, delay: "10 seconds", backoff: "exponential" }, timeout: "2 minutes" };

export function coachMessages(facts, previousNotes = "") {
  const data = renderDigest(facts, {});
  return [
    {
      role: "system",
      content:
        "You are a Cantonese tone coach writing a short progress note for a learner's long-term record. " +
        "Use only the data given. Compare the last 7 days with the 7 days before when there is data for both. " +
        "Write 3-5 Markdown bullet points, under 120 words total: what improved or slipped (with numbers), " +
        "the most persistent confusion, and one concrete thing to practise next. No greeting, no heading.",
    },
    {
      role: "user",
      content: `${data}\nPrevious coach notes:\n${previousNotes?.trim() || "none"}`,
    },
  ];
}

/**
 * One learner's digest: load -> coach notes (Llama) -> save digest + focus weights.
 * @param {{userId: number}} params
 */
export async function runDigest({ userId }, { store, ai, step, now = () => new Date() }) {
  const loaded = await step.do("load learner data", async () => {
    const [user, history, practice, previous] = await Promise.all([
      store.getUserById(userId),
      store.listAttempts(userId),
      store.listPractice(userId),
      store.latestDigest(userId),
    ]);
    if (!user || !history.length) return null;
    const at = now();
    return {
      learner: user.username,
      facts: digestFacts(history, practice, { now: at, today: localDay(at) }),
      previousNotes: previous?.notes ?? "",
    };
  });
  if (!loaded) return { saved: false };

  let notes = "";
  try {
    notes = await step.do("write coach notes", COACH_STEP, async () => {
      const out = await ai.run(TUTOR_MODEL, {
        messages: coachMessages(loaded.facts, loaded.previousNotes),
        max_tokens: 300,
        temperature: 0.3,
      });
      const text = String(out?.response ?? "").trim();
      if (!text) throw new Error("empty coach notes");
      return text;
    });
  } catch (e) {
    // Retries exhausted: the numbers are still worth saving without the prose.
    console.error("digest coach notes failed", e);
  }

  await step.do("save digest and focus weights", async () => {
    await store.addDigest(userId, {
      day: loaded.facts.asOf,
      markdown: renderDigest(loaded.facts, { learner: loaded.learner, notes }),
      notes,
      weights: loaded.facts.weights,
    });
  });
  return { saved: true };
}

/** Scheduled (nightly) run: start one digest instance per learner who answered in the last day. */
export async function startNightlyDigests({ store, workflow, step, now = () => new Date() }) {
  const { userIds, day } = await step.do("find active learners", async () => {
    const at = now();
    return {
      userIds: await store.listActiveUserIdsSince(new Date(at.getTime() - DAY_MS).toISOString()),
      day: localDay(at),
    };
  });
  return step.do("start digests", async () => {
    let started = 0;
    for (const userId of userIds) {
      try {
        await workflow.create({ id: digestInstanceId(userId, "nightly", day), params: { userId } });
        started++;
      } catch (e) {
        // Already started (a retry of this step) or a transient error: skip this learner tonight.
        console.warn("digest not started", userId, e?.message);
      }
    }
    return { started };
  });
}
