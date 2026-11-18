// HTTP API, independent of storage. `store` is a D1Store in production and a
// MemoryStore in tests; both implement the same methods.

import { hashPassword, verifyPassword, newToken } from "./auth.js";
import { isValidAttempt } from "../public/src/history.js";
import { isValidPracticeEntry, localDay } from "../public/src/practice.js";
import { TUTOR_MODEL, learnerSummary, buildMessages } from "./tutor.js";
import { digestInstanceId } from "./digest.js";

const MAX_ATTEMPTS_PER_POST = 5000;
const MAX_PRACTICE_ENTRIES = 1000;
const MAX_CHAT_CHARS = 2000;
const CHAT_HISTORY_LIMIT = 50;
const DEFAULT_CHAT_LIMIT_PER_HOUR = 30;
// A digest also starts every time a learner's total answers crosses a multiple of this.
const DEFAULT_DIGEST_EVERY = 50;
const MANUAL_DIGEST_WINDOW_MS = 10 * 60_000;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const error = (status, message) => json({ error: message }, status);

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    throw new HttpError(400, "Invalid JSON");
  }
}

function credentials(body) {
  const username = typeof body?.username === "string" ? body.username.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  if (!username || !password) throw new HttpError(400, "Username and password are required");
  return { username, password };
}

function bearer(request) {
  const m = /^Bearer (\S+)$/.exec(request.headers.get("authorization") ?? "");
  return m ? m[1] : null;
}

async function requireUser(request, store) {
  const token = bearer(request);
  const user = token && (await store.getSessionUser(token));
  if (!user) throw new HttpError(401, "Not logged in");
  return user;
}

async function startSession(store, user) {
  const token = newToken();
  await store.createSession(token, user.id);
  return { token, username: user.username };
}

const routes = {
  "POST /api/signup": async (request, store) => {
    const { username, password } = credentials(await readJson(request));
    const { hash, salt } = await hashPassword(password);
    const id = await store.createUser(username, hash, salt);
    if (id == null) throw new HttpError(409, "That username is taken");
    return json(await startSession(store, { id, username }), 201);
  },

  "POST /api/login": async (request, store) => {
    const { username, password } = credentials(await readJson(request));
    const user = await store.getUserByName(username);
    if (!user || !(await verifyPassword(password, user.password_hash, user.salt))) {
      throw new HttpError(401, "Wrong username or password");
    }
    return json(await startSession(store, user));
  },

  "POST /api/logout": async (request, store) => {
    const token = bearer(request);
    if (token) await store.deleteSession(token);
    return new Response(null, { status: 204 });
  },

  "GET /api/me": async (request, store) => {
    const user = await requireUser(request, store);
    return json({ username: user.username });
  },

  "GET /api/attempts": async (request, store) => {
    const user = await requireUser(request, store);
    return json({ attempts: await store.listAttempts(user.id) });
  },

  "POST /api/attempts": async (request, store, { digest, digestEvery = DEFAULT_DIGEST_EVERY }) => {
    const user = await requireUser(request, store);
    const body = await readJson(request);
    const attempts = body?.attempts;
    if (!Array.isArray(attempts) || attempts.length > MAX_ATTEMPTS_PER_POST || !attempts.every(isValidAttempt)) {
      throw new HttpError(400, "Expected { attempts: [...] } with valid attempts");
    }
    await store.addAttempts(user.id, attempts);
    if (digest) {
      const total = await store.countAttempts(user.id);
      const bucket = Math.floor(total / digestEvery);
      if (bucket > Math.floor((total - attempts.length) / digestEvery)) {
        try {
          await digest.create({ id: digestInstanceId(user.id, "answers", bucket), params: { userId: user.id } });
        } catch (e) {
          console.warn("digest not started", e?.message); // never fail the save over this
        }
      }
    }
    return json({ saved: attempts.length }, 201);
  },

  "GET /api/practice": async (request, store) => {
    const user = await requireUser(request, store);
    return json({ days: await store.listPractice(user.id) });
  },

  "POST /api/practice": async (request, store) => {
    const user = await requireUser(request, store);
    const entries = (await readJson(request))?.entries;
    if (!Array.isArray(entries) || entries.length > MAX_PRACTICE_ENTRIES || !entries.every(isValidPracticeEntry)) {
      throw new HttpError(400, "Expected { entries: [{ day: 'YYYY-MM-DD', ms }] }");
    }
    await store.addPractice(user.id, entries);
    return json({ saved: entries.length }, 201);
  },

  "GET /api/chat": async (request, store) => {
    const user = await requireUser(request, store);
    return json({ messages: await store.listChat(user.id, CHAT_HISTORY_LIMIT) });
  },

  "POST /api/chat": async (request, store, { ai, chatLimitPerHour = DEFAULT_CHAT_LIMIT_PER_HOUR }) => {
    const user = await requireUser(request, store);
    // Every message costs Workers AI usage, and anyone can sign up: cap it.
    const since = new Date(Date.now() - 3_600_000).toISOString();
    if ((await store.countChatSince(user.id, since)) >= chatLimitPerHour) {
      throw new HttpError(429, `You've hit the tutor limit (${chatLimitPerHour} messages an hour). Keep practising and try again soon.`);
    }
    const body = await readJson(request);
    const message = typeof body?.message === "string" ? body.message.trim() : "";
    if (!message || message.length > MAX_CHAT_CHARS) {
      throw new HttpError(400, `Message must be 1-${MAX_CHAT_CHARS} characters`);
    }
    // The client may send its local date so "today" matches the learner's timezone.
    const today = /^\d{4}-\d{2}-\d{2}$/.test(body?.today ?? "") ? body.today : localDay();
    const [history, practice, past, memory] = await Promise.all([
      store.listAttempts(user.id),
      store.listPractice(user.id),
      store.listChat(user.id, CHAT_HISTORY_LIMIT),
      store.latestDigest(user.id),
    ]);
    const messages = buildMessages({ summary: learnerSummary(history, practice, today), memory, past, message });

    let reply;
    try {
      const out = await ai.run(TUTOR_MODEL, { messages, max_tokens: 700, temperature: 0.6 });
      reply = String(out?.response ?? "").trim();
    } catch (e) {
      console.error("AI error", e);
      throw new HttpError(502, "The tutor is unavailable right now. Try again in a moment.");
    }
    if (!reply) throw new HttpError(502, "The tutor returned an empty reply. Try again.");

    await store.addChat(user.id, [
      { role: "user", content: message },
      { role: "assistant", content: reply },
    ]);
    return json({ reply });
  },

  "GET /api/digest": async (request, store) => {
    const user = await requireUser(request, store);
    return json({ digest: await store.latestDigest(user.id) });
  },

  // Start a digest now (normally nightly, or every DEFAULT_DIGEST_EVERY answers).
  "POST /api/digest": async (request, store, { digest }) => {
    const user = await requireUser(request, store);
    if (!digest) throw new HttpError(503, "Digests are not available here");
    const id = digestInstanceId(user.id, "manual", Math.floor(Date.now() / MANUAL_DIGEST_WINDOW_MS));
    try {
      await digest.create({ id, params: { userId: user.id } });
    } catch (e) {
      if (!/already.?exists/i.test(String(e?.message))) {
        console.error("digest create failed", e);
        throw new HttpError(502, "Couldn't start the digest. Try again in a moment.");
      }
      return json({ id, alreadyRunning: true }, 202);
    }
    return json({ id }, 202);
  },

  "DELETE /api/chat": async (request, store) => {
    const user = await requireUser(request, store);
    await store.clearChat(user.id);
    return new Response(null, { status: 204 });
  },
};

export async function handleApi(request, store, deps = {}) {
  const { pathname } = new URL(request.url);
  const handler = routes[`${request.method} ${pathname}`];
  if (!handler) return error(404, "Not found");
  try {
    return await handler(request, store, deps);
  } catch (e) {
    if (e instanceof HttpError) return error(e.status, e.message);
    console.error(e);
    return error(500, "Server error");
  }
}
