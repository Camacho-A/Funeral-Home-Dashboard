/**
 * The dependency-free face of request-scoped memoization (performance
 * phase 1, 2026-10). Modules that are also bundled for the browser —
 * lib/wixDataApi.ts and the services that import it run client-side in
 * mock mode — call these functions; the server-only implementation
 * (lib/requestScope.ts, which needs `next/headers`) registers itself when
 * it is loaded on the server (lib/auth/session.ts imports it).
 *
 * Unregistered — in the browser, or on a server path that never loaded the
 * implementation — every call computes directly with no memoization, which
 * is always correct, only without the deduplication.
 */
export type RequestMemoImplementation = {
  memo<T>(key: string, compute: () => Promise<T>): Promise<T>;
  invalidate(prefix: string): Promise<void>;
};

let implementation: RequestMemoImplementation | null = null;

export function registerRequestMemo(next: RequestMemoImplementation): void {
  implementation = next;
}

export function isRequestMemoRegistered(): boolean {
  return implementation !== null;
}

export function requestScopedMemo<T>(key: string, compute: () => Promise<T>): Promise<T> {
  return implementation ? implementation.memo(key, compute) : compute();
}

export async function invalidateRequestScoped(prefix: string): Promise<void> {
  if (implementation) await implementation.invalidate(prefix);
}
