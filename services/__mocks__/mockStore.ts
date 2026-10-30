/**
 * Local-development mock store (2026-10).
 *
 * Every `services/__mocks__/*Fixtures.ts` collection is a plain in-memory
 * array that the services' `dataAdapterMode === 'mock'` branches read and
 * mutate in place. That is only coherent while every caller shares ONE
 * module instance — and `next dev` does not guarantee that: the Server
 * Action that signs a user in and the Server Component render that follows
 * it can evaluate `services/__mocks__/identityFixtures.ts` in different
 * module graphs (different bundler layers, HMR re-evaluation). A session
 * pushed by the login action was then invisible to the portal layout, so
 * identity login over mock data always bounced back with
 * `session_not_found`.
 *
 * `mockCollection(key, init)` anchors each collection on `globalThis`, so
 * every module instance in the same process gets the SAME array (or Map):
 * the first evaluation creates it from `init()`, every later evaluation
 * reuses it. Fixture semantics are otherwise unchanged — callers still
 * receive a plain, mutable array.
 *
 * Scope and safety:
 * - It is only ever reached through the fixture modules, which only the
 *   services' MOCK branches read. Wix data mode never touches it, and it
 *   never persists anything to disk or the network.
 * - It lives for the lifetime of the process: restart `npm run dev` to get
 *   pristine fixtures back (e.g. after editing a fixture file — a hot
 *   reload intentionally keeps the existing data).
 * - Vitest runs each test FILE in its own isolated worker (vitest's default
 *   `isolate: true`), so nothing leaks between test files. Within one file,
 *   state persists across `vi.resetModules()` exactly as it does across
 *   Next.js module instances — tests that mutate a fixture already snapshot
 *   and restore it, and `resetMockStore()` below is available for a test
 *   that wants a fresh store.
 */

const STORE_KEY = Symbol.for('solis.mockStore.v1');

type MockStoreRegistry = Map<string, unknown>;

function registry(): MockStoreRegistry {
  const holder = globalThis as typeof globalThis & { [STORE_KEY]?: MockStoreRegistry };
  if (!holder[STORE_KEY]) {
    holder[STORE_KEY] = new Map();
  }
  return holder[STORE_KEY];
}

/** Returns the process-wide instance for `key`, creating it with `init()`
    the first time. `init` must build a fresh value (never return a shared
    module-level object) so `resetMockStore()` really yields pristine data. */
export function mockCollection<T>(key: string, init: () => T): T {
  const store = registry();
  if (!store.has(key)) {
    store.set(key, restoreSandboxCollection(key) ?? init());
    if (isSandboxBrowser()) watchSandboxPageExit();
  }
  return store.get(key) as T;
}

/**
 * SOLIS sandbox (2026-10) — browser only. In mock mode the browser keeps
 * its own copy of the cases and tasks it edits, which a page refresh used
 * to throw away. In the sandbox (lib/sandbox.ts) the collections staff
 * actually change are saved to this browser's localStorage when the page
 * is left or hidden, and restored on the next load. Scoped to the
 * deployment's commit, so a new sandbox build starts from fresh fixtures.
 * Nothing here runs on the server, outside the sandbox, or in tests.
 */
const SANDBOX_PERSISTED_COLLECTIONS: readonly string[] = ['caseFixtures', 'taskFixtures', 'caseLogFixtures', 'activityEventFixtures'];

function isSandboxBrowser(): boolean {
  return typeof window !== 'undefined' && process.env.NEXT_PUBLIC_SOLIS_SANDBOX === 'true';
}

function sandboxStorageKey(key: string): string {
  return `solis.sandbox.${process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ?? 'local'}.${key}`;
}

function restoreSandboxCollection(key: string): unknown {
  if (!isSandboxBrowser() || !SANDBOX_PERSISTED_COLLECTIONS.includes(key)) return undefined;
  try {
    const saved = window.localStorage.getItem(sandboxStorageKey(key));
    const parsed: unknown = saved ? JSON.parse(saved) : undefined;
    return Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

// Process-wide like the store itself, so every module instance agrees.
const SANDBOX_STATE_KEY = Symbol.for('solis.sandbox.persistence.v1');
function sandboxState(): { watching: boolean; resetting: boolean } {
  const holder = globalThis as typeof globalThis & { [SANDBOX_STATE_KEY]?: { watching: boolean; resetting: boolean } };
  holder[SANDBOX_STATE_KEY] ??= { watching: false, resetting: false };
  return holder[SANDBOX_STATE_KEY];
}

function saveSandboxCollections(): void {
  if (!isSandboxBrowser() || sandboxState().resetting) return;
  const store = registry();
  for (const key of SANDBOX_PERSISTED_COLLECTIONS) {
    if (!store.has(key)) continue;
    try {
      window.localStorage.setItem(sandboxStorageKey(key), JSON.stringify(store.get(key)));
    } catch {
      // Storage full or blocked: the sandbox simply forgets on refresh.
    }
  }
}

function watchSandboxPageExit(): void {
  if (sandboxState().watching) return;
  sandboxState().watching = true;
  window.addEventListener('pagehide', saveSandboxCollections);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') saveSandboxCollections();
  });
}

/** The sandbox banner's "Reset fictional data": forget this browser's saved copy. */
export function resetSandboxBrowserData(): void {
  if (!isSandboxBrowser()) return;
  sandboxState().resetting = true;
  try {
    for (let i = window.localStorage.length - 1; i >= 0; i--) {
      const name = window.localStorage.key(i);
      if (name?.startsWith('solis.sandbox.')) window.localStorage.removeItem(name);
    }
  } catch {
    // Nothing saved to clear.
  }
}

/** Drops every stored collection (or just `keys`). The NEXT evaluation of a
    fixture module (e.g. after `vi.resetModules()`) re-creates it from its
    initializer; module bindings already imported keep pointing at the old
    instance. Test-only convenience — never called by application code. */
export function resetMockStore(keys?: readonly string[]): void {
  const store = registry();
  if (!keys) {
    store.clear();
    return;
  }
  for (const key of keys) store.delete(key);
}

/** Whether `key` currently exists in the store — used by tests. */
export function hasMockCollection(key: string): boolean {
  return registry().has(key);
}
