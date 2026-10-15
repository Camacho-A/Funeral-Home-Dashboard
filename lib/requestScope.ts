import { headers } from 'next/headers';
import { registerRequestMemo } from './requestMemo';

/**
 * Request-scoped memoization (performance phase 1, 2026-10) — the
 * server-only implementation behind lib/requestMemo.ts, which is what
 * callers import. Loading this module registers it.
 *
 * Deduplicates identical backend reads made more than once while serving
 * ONE request — e.g. two permission checks in the same Route Handler that
 * both resolve the same role, or a notification fan-out that resolves the
 * same role once per recipient. Nothing here is ever shared between two
 * requests, so it cannot carry one user's (or one organization's) state
 * into another request, and a role, membership or session change is seen
 * by the very next request — the guarantee services/permissionService.ts
 * documents for why its old cross-request cache was removed.
 *
 * The scope key is the request's own Headers object as returned by
 * `await headers()`. Next.js resolves that to the same underlying object
 * for every call within one request (next/dist/server/request/headers.js
 * caches the promise per underlying headers object) and a different one
 * for every other request; the WeakMap lets the entry be collected with
 * the request. Outside a request (unit tests, scripts) `headers()` throws,
 * and the value is computed directly with no memoization — so the worst
 * case of any change in that Next.js behaviour is "no deduplication",
 * never "shared between requests".
 *
 * Callers must include every input that affects the result (organization
 * id, role key, data adapter mode, …) in `key`. A rejected promise is
 * evicted at once so a failed read is retried rather than remembered.
 */
const scopes = new WeakMap<object, Map<string, Promise<unknown>>>();

async function currentScope(): Promise<Map<string, Promise<unknown>> | null> {
  let scopeKey: object;
  try {
    scopeKey = await headers();
  } catch {
    return null;
  }
  let scope = scopes.get(scopeKey);
  if (!scope) {
    scope = new Map();
    scopes.set(scopeKey, scope);
  }
  return scope;
}

export async function requestScopedMemo<T>(key: string, compute: () => Promise<T>): Promise<T> {
  const scope = await currentScope();
  if (!scope) return compute();

  const existing = scope.get(key) as Promise<T> | undefined;
  if (existing) return existing;

  const pending = compute();
  scope.set(key, pending);
  pending.catch(() => {
    if (scope.get(key) === pending) scope.delete(key);
  });
  return pending;
}

/** Drops every memoized entry whose key starts with `prefix` in the
    current request — for a request that changes the data it already read
    (e.g. a role edit followed by a permission re-check). No-op outside a
    request. */
export async function invalidateRequestScoped(prefix: string): Promise<void> {
  const scope = await currentScope();
  if (!scope) return;
  for (const key of [...scope.keys()]) {
    if (key.startsWith(prefix)) scope.delete(key);
  }
}

registerRequestMemo({ memo: requestScopedMemo, invalidate: invalidateRequestScoped });
