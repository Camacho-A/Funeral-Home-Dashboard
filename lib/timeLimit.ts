/**
 * A hard time limit for work that waits on something outside Solis
 * (2026-11). Node's own fetch waits up to 300 seconds for a reply — exactly
 * Vercel's function limit — so one service that never answers used to hold
 * a request, or the background work after it, until the function was
 * killed, with nothing logged.
 *
 * Rejects with `message` once `ms` passes, calling `onTimeout` first (to
 * kill a browser, abort a request, …). The work itself is not cancelled
 * by this; `onTimeout` is where that happens.
 */
export class TimeLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TimeLimitError';
  }
}

export function withTimeout<T>(work: Promise<T>, ms: number, onTimeout: () => void = () => {}, message?: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      try {
        onTimeout();
      } finally {
        reject(new TimeLimitError(message ?? `Gave up after ${Math.round(ms / 1000)} seconds with no answer.`));
      }
    }, ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}
