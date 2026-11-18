// Maps "cloudflare:workers" to a local stub (it only exists inside the Workers runtime).
import { registerHooks } from "node:module";

const stub = new URL("./stubs/cloudflare-workers.mjs", import.meta.url).href;
registerHooks({
  resolve(specifier, context, next) {
    return specifier === "cloudflare:workers" ? { url: stub, shortCircuit: true } : next(specifier, context);
  },
});
