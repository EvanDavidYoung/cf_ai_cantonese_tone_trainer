// Stand-in for the Workers runtime module so worker/index.js imports under node --test.
export class WorkflowEntrypoint {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }
}
