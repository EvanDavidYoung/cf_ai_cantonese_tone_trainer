// Cloudflare Workflow that writes learner digests (see worker/digest.js for the steps).
//   - Nightly, from the Cron Trigger in worker/index.js: no params, so it fans
//     out one instance per learner who answered in the last day.
//   - Per learner ({ userId }): started by that fan-out, by POST /api/digest, or
//     every DEFAULT_DIGEST_EVERY answers (worker/api.js).

import { WorkflowEntrypoint } from "cloudflare:workers";
import { D1Store } from "./d1-store.js";
import { runDigest, startNightlyDigests } from "./digest.js";

export class DigestWorkflow extends WorkflowEntrypoint {
  async run(event, step) {
    const store = new D1Store(this.env.DB);
    const userId = event.payload?.userId;
    if (Number.isInteger(userId)) return runDigest({ userId }, { store, ai: this.env.AI, step });
    return startNightlyDigests({ store, workflow: this.env.DIGEST, step });
  }
}
