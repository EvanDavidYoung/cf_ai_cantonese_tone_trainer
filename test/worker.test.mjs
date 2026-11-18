import { test } from "node:test";
import assert from "node:assert/strict";
import worker, { DigestWorkflow } from "../worker/index.js";
import { BASE } from "../worker/config.js";

function env() {
  const seen = [];
  return {
    seen,
    ASSETS: { fetch: async (req) => (seen.push(new URL(req.url).pathname), new Response("asset")) },
    DB: {},
    AI: {},
  };
}

test("base path without a trailing slash redirects to the slash version", async () => {
  const res = await worker.fetch(new Request(`https://tools.evanyoung.dev${BASE}?x=1`), env());
  assert.equal(res.status, 301);
  assert.equal(res.headers.get("location"), `https://tools.evanyoung.dev${BASE}/?x=1`);
});

test("assets under the base path are served with the prefix stripped", async () => {
  const e = env();
  await worker.fetch(new Request(`https://tools.evanyoung.dev${BASE}/`), e);
  await worker.fetch(new Request(`https://tools.evanyoung.dev${BASE}/audio/x.mp3`), e);
  assert.deepEqual(e.seen, ["/", "/audio/x.mp3"]);
});

test("local dev at the root still works", async () => {
  const e = env();
  await worker.fetch(new Request("http://localhost:8080/styles.css"), e);
  assert.deepEqual(e.seen, ["/styles.css"]);
});

test("API calls under the base path reach the API, not the assets", async () => {
  const e = env();
  const res = await worker.fetch(new Request(`https://tools.evanyoung.dev${BASE}/api/me`), e);
  assert.equal(res.status, 401); // no token -> API answers before touching the DB
  assert.deepEqual(e.seen, []);
});

test("the digest Workflow class is exported for the Workflows runtime", () => {
  assert.equal(typeof DigestWorkflow, "function");
  assert.equal(typeof DigestWorkflow.prototype.run, "function");
});

test("the nightly cron starts the digest fan-out Workflow once per day", async () => {
  const created = [];
  const e = { ...env(), DIGEST: { async create(opts) { created.push(opts); return { id: opts.id }; } } };
  const waits = [];
  await worker.scheduled({ cron: "0 4 * * *", scheduledTime: Date.UTC(2026, 10, 18, 4) }, e, { waitUntil: (p) => waits.push(p) });
  await Promise.all(waits);
  assert.deepEqual(created, [{ id: "nightly-2026-11-18", params: {} }]);
});
