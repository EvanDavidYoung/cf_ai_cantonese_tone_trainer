// Cloudflare Worker entry. Deployed at tools.evanyoung.dev/tone-trainer/ (a
// route on the tools subdomain), so requests arrive with that prefix; it is
// stripped before serving assets or the API. Locally (wrangler dev) the app is
// served from the root, which also works.

import { handleApi } from "./api.js";
import { D1Store } from "./d1-store.js";
import { BASE } from "./config.js";

// Workflow classes must be named exports of the main module. Don't add other
// named exports: Workers treats them as entrypoints too.
export { DigestWorkflow } from "./digest-workflow.js";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === BASE) {
      url.pathname = BASE + "/";
      return Response.redirect(url.toString(), 301);
    }
    if (url.pathname.startsWith(BASE + "/")) url.pathname = url.pathname.slice(BASE.length);

    const inner = new Request(url.toString(), request);
    if (url.pathname.startsWith("/api/")) {
      return handleApi(inner, new D1Store(env.DB), { ai: env.AI, digest: env.DIGEST });
    }
    return env.ASSETS.fetch(inner);
  },

  // Nightly Cron Trigger (wrangler.jsonc "triggers"). Starts the digest
  // Workflow with no params, which fans out one instance per active learner.
  // (Workflow "schedules" would do this directly but need a paid plan.)
  async scheduled(controller, env, ctx) {
    const day = new Date(controller.scheduledTime).toISOString().slice(0, 10);
    ctx.waitUntil(
      env.DIGEST.create({ id: `nightly-${day}`, params: {} }).catch((e) => console.error("nightly digest not started", e)),
    );
  },
};
