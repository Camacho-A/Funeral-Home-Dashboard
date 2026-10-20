import { after } from 'next/server';

/**
 * Runs work after the HTTP response has been sent (Next.js `after`), so a
 * slow side effect — rendering PDFs — never delays or fails the request
 * that triggered it. Outside a request (scripts, some tests) `after` is
 * unavailable, and the task simply starts immediately in the background.
 *
 * The task must handle its own errors; anything it throws is logged here
 * as a last resort, never rethrown into the request.
 */
export function runAfterResponse(label: string, task: () => Promise<unknown>): void {
  const guarded = async () => {
    try {
      await task();
    } catch (error) {
      console.error(`[after-response] ${label} failed:`, error instanceof Error ? error.message : error);
    }
  };
  try {
    after(guarded);
  } catch {
    void guarded();
  }
}
