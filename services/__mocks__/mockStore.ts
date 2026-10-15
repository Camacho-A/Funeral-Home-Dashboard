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
    store.set(key, init());
  }
  return store.get(key) as T;
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
