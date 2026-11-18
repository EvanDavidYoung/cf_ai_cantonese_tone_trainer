import { test } from "node:test";
import assert from "node:assert/strict";
import { handleApi } from "../worker/api.js";
import { MemoryStore } from "../worker/memory-store.js";
import { hashPassword, verifyPassword } from "../worker/auth.js";

const attempt = (n = 0) => ({
  at: new Date(Date.UTC(2026, 10, 18, 12, n)).toISOString(),
  word: "電視",
  jyutping: "din6 si6",
  gloss: "television",
  actual: [6, 6],
  guessed: [6, 3],
});

// Fake Workers AI: records each call and echoes a canned reply.
function fakeAi(reply = "Tone 6 is low and level.") {
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

// Fake Workflow binding: records created instances, rejects duplicate ids like the real one.
function fakeWorkflow() {
  const created = [];
  return {
    created,
    async create(opts) {
      if (created.some((c) => c.id === opts.id)) throw new Error("instance already exists");
      created.push(opts);
      return { id: opts.id };
    },
  };
}

function client({ ai = fakeAi(), digest = fakeWorkflow(), digestEvery } = {}) {
  const store = new MemoryStore();
  const call = async (method, path, { body, token } = {}) => {
    const headers = {};
    if (body !== undefined) headers["content-type"] = "application/json";
    if (token) headers.authorization = `Bearer ${token}`;
    const req = new Request(`http://x${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const res = await handleApi(req, store, { ai, digest, digestEvery });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
  return { store, call, ai, digest };
}

async function signup(call, username = "a") {
  return (await call("POST", "/api/signup", { body: { username, password: "x" } })).body.token;
}

test("hashPassword / verifyPassword round-trip", async () => {
  const { hash, salt } = await hashPassword("pw");
  assert.equal(await verifyPassword("pw", hash, salt), true);
  assert.equal(await verifyPassword("nope", hash, salt), false);
});

test("signup returns a token that identifies the user", async () => {
  const { call } = client();
  const r = await call("POST", "/api/signup", { body: { username: "evan", password: "x" } });
  assert.equal(r.status, 201);
  assert.equal(r.body.username, "evan");
  const me = await call("GET", "/api/me", { token: r.body.token });
  assert.deepEqual(me, { status: 200, body: { username: "evan" } });
});

test("signup accepts any non-empty password, even one character", async () => {
  const { call } = client();
  const r = await call("POST", "/api/signup", { body: { username: "a", password: "1" } });
  assert.equal(r.status, 201);
});

test("signup rejects empty username or password, and duplicate usernames", async () => {
  const { call } = client();
  assert.equal((await call("POST", "/api/signup", { body: { username: "", password: "x" } })).status, 400);
  assert.equal((await call("POST", "/api/signup", { body: { username: "a", password: "" } })).status, 400);
  assert.equal((await call("POST", "/api/signup", { body: { username: "a", password: "x" } })).status, 201);
  assert.equal((await call("POST", "/api/signup", { body: { username: "a", password: "y" } })).status, 409);
});

test("login works with the right password and fails otherwise", async () => {
  const { call } = client();
  await call("POST", "/api/signup", { body: { username: "evan", password: "pw" } });
  const ok = await call("POST", "/api/login", { body: { username: "evan", password: "pw" } });
  assert.equal(ok.status, 200);
  assert.ok(ok.body.token);
  assert.equal((await call("POST", "/api/login", { body: { username: "evan", password: "no" } })).status, 401);
  assert.equal((await call("POST", "/api/login", { body: { username: "ghost", password: "pw" } })).status, 401);
});

test("logout invalidates the token", async () => {
  const { call } = client();
  const { body } = await call("POST", "/api/signup", { body: { username: "evan", password: "pw" } });
  assert.equal((await call("POST", "/api/logout", { token: body.token })).status, 204);
  assert.equal((await call("GET", "/api/me", { token: body.token })).status, 401);
});

test("attempts require a valid token", async () => {
  const { call } = client();
  assert.equal((await call("GET", "/api/attempts")).status, 401);
  assert.equal((await call("GET", "/api/attempts", { token: "bogus" })).status, 401);
  assert.equal((await call("POST", "/api/attempts", { body: { attempts: [attempt()] } })).status, 401);
});

test("attempts are saved per user and returned in order", async () => {
  const { call } = client();
  const a = (await call("POST", "/api/signup", { body: { username: "a", password: "x" } })).body.token;
  const b = (await call("POST", "/api/signup", { body: { username: "b", password: "x" } })).body.token;

  const saved = await call("POST", "/api/attempts", { token: a, body: { attempts: [attempt(1), attempt(2)] } });
  assert.deepEqual(saved, { status: 201, body: { saved: 2 } });
  await call("POST", "/api/attempts", { token: a, body: { attempts: [attempt(3)] } });

  const listA = await call("GET", "/api/attempts", { token: a });
  assert.deepEqual(listA.body.attempts, [attempt(1), attempt(2), attempt(3)]);
  const listB = await call("GET", "/api/attempts", { token: b });
  assert.deepEqual(listB.body.attempts, []);
});

test("posting malformed attempts is rejected without saving anything", async () => {
  const { call } = client();
  const t = (await call("POST", "/api/signup", { body: { username: "a", password: "x" } })).body.token;
  const bad = { ...attempt(), guessed: [7, 1] };
  assert.equal((await call("POST", "/api/attempts", { token: t, body: { attempts: [attempt(), bad] } })).status, 400);
  assert.equal((await call("POST", "/api/attempts", { token: t, body: { nope: 1 } })).status, 400);
  assert.deepEqual((await call("GET", "/api/attempts", { token: t })).body.attempts, []);
});

test("unknown routes 404 and bad JSON 400", async () => {
  const { call } = client();
  assert.equal((await call("GET", "/api/nope")).status, 404);
  const res = await handleApi(
    new Request("http://x/api/login", { method: "POST", body: "{not json" }),
    new MemoryStore(),
  );
  assert.equal(res.status, 400);
});

test("practice time requires login and accumulates per day per user", async () => {
  const { call } = client();
  assert.equal((await call("GET", "/api/practice")).status, 401);
  const a = (await call("POST", "/api/signup", { body: { username: "a", password: "x" } })).body.token;
  const b = (await call("POST", "/api/signup", { body: { username: "b", password: "x" } })).body.token;

  const r = await call("POST", "/api/practice", {
    token: a,
    body: { entries: [{ day: "2026-11-18", ms: 1000 }, { day: "2026-11-17", ms: 500 }] },
  });
  assert.equal(r.status, 201);
  await call("POST", "/api/practice", { token: a, body: { entries: [{ day: "2026-11-18", ms: 2000 }] } });

  const got = await call("GET", "/api/practice", { token: a });
  assert.deepEqual(got.body, { days: { "2026-11-17": 500, "2026-11-18": 3000 } });
  assert.deepEqual((await call("GET", "/api/practice", { token: b })).body, { days: {} });
});

test("malformed practice entries are rejected", async () => {
  const { call } = client();
  const t = (await call("POST", "/api/signup", { body: { username: "a", password: "x" } })).body.token;
  const post = (body) => call("POST", "/api/practice", { token: t, body });
  assert.equal((await post({ entries: [{ day: "bad", ms: 1 }] })).status, 400);
  assert.equal((await post({ entries: [{ day: "2026-11-18", ms: -5 }] })).status, 400);
  assert.equal((await post({})).status, 400);
  assert.deepEqual((await call("GET", "/api/practice", { token: t })).body, { days: {} });
});

test("chat requires login", async () => {
  const { call } = client();
  assert.equal((await call("POST", "/api/chat", { body: { message: "hi" } })).status, 401);
  assert.equal((await call("GET", "/api/chat")).status, 401);
});

test("chat sends the learner's data to the model and stores the conversation", async () => {
  const { call, ai } = client();
  const t = (await call("POST", "/api/signup", { body: { username: "a", password: "x" } })).body.token;
  await call("POST", "/api/attempts", { token: t, body: { attempts: [attempt(1)] } });

  const r = await call("POST", "/api/chat", { token: t, body: { message: "What are my weak tones?" } });
  assert.deepEqual(r, { status: 200, body: { reply: "Tone 6 is low and level." } });

  const { model, input } = ai.calls[0];
  assert.match(model, /llama-3\.3/);
  assert.equal(input.messages[0].role, "system");
  assert.match(input.messages[0].content, /tone 6 heard as tone 3: 1 time/);
  assert.deepEqual(input.messages.at(-1), { role: "user", content: "What are my weak tones?" });

  const hist = await call("GET", "/api/chat", { token: t });
  assert.deepEqual(hist.body.messages.map((m) => [m.role, m.content]), [
    ["user", "What are my weak tones?"],
    ["assistant", "Tone 6 is low and level."],
  ]);

  // Second turn includes the first exchange as context.
  await call("POST", "/api/chat", { token: t, body: { message: "And how do I fix that?" } });
  const second = ai.calls[1].input.messages.map((m) => m.role);
  assert.deepEqual(second, ["system", "user", "assistant", "user"]);
});

test("chat keeps conversations separate per user", async () => {
  const { call } = client();
  const a = (await call("POST", "/api/signup", { body: { username: "a", password: "x" } })).body.token;
  const b = (await call("POST", "/api/signup", { body: { username: "b", password: "x" } })).body.token;
  await call("POST", "/api/chat", { token: a, body: { message: "hi" } });
  assert.deepEqual((await call("GET", "/api/chat", { token: b })).body.messages, []);
});

test("chat rejects empty or huge messages", async () => {
  const { call } = client();
  const t = (await call("POST", "/api/signup", { body: { username: "a", password: "x" } })).body.token;
  assert.equal((await call("POST", "/api/chat", { token: t, body: { message: "  " } })).status, 400);
  assert.equal((await call("POST", "/api/chat", { token: t, body: { message: "x".repeat(2001) } })).status, 400);
});

test("a model failure returns 502 and stores nothing", async () => {
  const { call } = client({ ai: fakeAi(new Error("boom")) });
  const t = (await call("POST", "/api/signup", { body: { username: "a", password: "x" } })).body.token;
  assert.equal((await call("POST", "/api/chat", { token: t, body: { message: "hi" } })).status, 502);
  assert.deepEqual((await call("GET", "/api/chat", { token: t })).body.messages, []);
});

test("DELETE /api/chat clears the conversation", async () => {
  const { call } = client();
  const t = (await call("POST", "/api/signup", { body: { username: "a", password: "x" } })).body.token;
  await call("POST", "/api/chat", { token: t, body: { message: "hi" } });
  assert.equal((await call("DELETE", "/api/chat", { token: t })).status, 204);
  assert.deepEqual((await call("GET", "/api/chat", { token: t })).body.messages, []);
});

test("chat is rate limited per user per hour", async () => {
  const ai = fakeAi();
  const store = new MemoryStore();
  const req = (method, path, body, token) =>
    handleApi(
      new Request(`http://x${path}`, {
        method,
        headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: body && JSON.stringify(body),
      }),
      store,
      { ai, chatLimitPerHour: 3 },
    );
  const t = (await (await req("POST", "/api/signup", { username: "a", password: "x" })).json()).token;
  for (let i = 0; i < 3; i++) assert.equal((await req("POST", "/api/chat", { message: "hi" }, t)).status, 200);
  const blocked = await req("POST", "/api/chat", { message: "hi" }, t);
  assert.equal(blocked.status, 429);
  assert.equal(ai.calls.length, 3);
});

// ---- learner digest -------------------------------------------------------------

test("GET /api/digest is null until a digest exists, then returns the latest", async () => {
  const { call, store } = client();
  const t = await signup(call);
  assert.equal((await call("GET", "/api/digest")).status, 401);
  assert.deepEqual((await call("GET", "/api/digest", { token: t })).body, { digest: null });
  await store.addDigest(1, { day: "2026-11-17", markdown: "# old", notes: "", weights: { 1: 0.5 } });
  await store.addDigest(1, { day: "2026-11-18", markdown: "# new", notes: "- n", weights: { 6: 0.7 } });
  const d = (await call("GET", "/api/digest", { token: t })).body.digest;
  assert.equal(d.day, "2026-11-18");
  assert.equal(d.markdown, "# new");
  assert.deepEqual(d.weights, { 6: 0.7 });
  assert.equal(typeof d.createdAt, "string");
});

test("POST /api/digest starts a digest workflow for the user (once per 10 minutes)", async () => {
  const { call, digest } = client();
  const t = await signup(call);
  const r = await call("POST", "/api/digest", { token: t });
  assert.equal(r.status, 202);
  assert.equal(digest.created.length, 1);
  assert.deepEqual(digest.created[0].params, { userId: 1 });
  assert.match(digest.created[0].id, /^u1-manual-\d+$/);
  const again = await call("POST", "/api/digest", { token: t });
  assert.equal(again.status, 202);
  assert.equal(again.body.alreadyRunning, true);
  assert.equal(digest.created.length, 1);
});

test("POST /api/digest is 503 without a workflow binding", async () => {
  const { call } = client({ digest: null });
  const t = await signup(call);
  assert.equal((await call("POST", "/api/digest", { token: t })).status, 503);
});

test("saving attempts starts a digest each time the total crosses a multiple of digestEvery", async () => {
  const { call, digest } = client({ digestEvery: 3 });
  const t = await signup(call);
  const post = (n) => call("POST", "/api/attempts", { token: t, body: { attempts: Array.from({ length: n }, (_, i) => attempt(i)) } });
  await post(2);
  assert.equal(digest.created.length, 0);
  await post(2); // 4 total: crossed 3
  assert.deepEqual(digest.created.map((c) => c.id), ["u1-answers-1"]);
  await post(1); // 5
  assert.equal(digest.created.length, 1);
  await post(7); // 12: crossed 6, 9, 12 -> one digest
  assert.deepEqual(digest.created.map((c) => c.id), ["u1-answers-1", "u1-answers-4"]);
});

test("saving attempts still succeeds if starting the digest fails", async () => {
  const failing = { async create() { throw new Error("boom"); } };
  const { call } = client({ digest: failing, digestEvery: 1 });
  const t = await signup(call);
  const r = await call("POST", "/api/attempts", { token: t, body: { attempts: [attempt()] } });
  assert.equal(r.status, 201);
});

test("the tutor sees the latest digest as long-term memory", async () => {
  const { call, store, ai } = client();
  const t = await signup(call);
  await store.addDigest(1, { day: "2026-11-11", markdown: "---\nv: 1\n---\n# Digest\nLAST WEEK 6→3", notes: "", weights: {} });
  await call("POST", "/api/chat", { token: t, body: { message: "how am I doing?" } });
  const system = ai.calls[0].input.messages[0].content;
  assert.match(system, /Long-term memory/);
  assert.match(system, /2026-11-11/);
  assert.match(system, /LAST WEEK 6→3/);
});
