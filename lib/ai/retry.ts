// A 429 is backpressure, not a failure. Every caller of the AI layer needs this
// - the retriage script hit it first at 64 of 200 emails, then the task eval
// crashed outright simply because it ran while that script was working, since
// both draw on the same 200k tokens/min budget.
//
// Lives at the AI boundary rather than in each caller so a script written later
// cannot forget it.

const MAX_ATTEMPTS = 6;
const BACKOFF_CAP_MS = 30_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function withAiRetry<T>(fn: () => Promise<T>, label = "ai call"): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      const message = String(err?.message ?? err);
      const rateLimited = err?.status === 429 || /\b429\b|rate.?limit/i.test(message);
      if (!rateLimited || attempt >= MAX_ATTEMPTS - 1) throw err;

      // Honour the API's "try again in 1.24s" when present, but never wait less
      // than exponential backoff: a ~1s hint while the whole minute's budget is
      // spent just buys another rejection.
      const hinted = Number(/try again in ([\d.]+)\s*s/i.exec(message)?.[1]);
      const backoff = Math.min(2 ** attempt * 1000, BACKOFF_CAP_MS);
      const waitMs = Math.min(
        Math.max(Number.isFinite(hinted) ? hinted * 1000 + 250 : 0, backoff),
        BACKOFF_CAP_MS
      );
      console.warn(`[retry] rate limited on ${label}, waiting ${(waitMs / 1000).toFixed(1)}s (${attempt + 1}/${MAX_ATTEMPTS})`);
      await sleep(waitMs);
    }
  }
}
