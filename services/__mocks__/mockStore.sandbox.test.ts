// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

class MemoryStorage {
  private items = new Map<string, string>();
  get length() { return this.items.size; }
  key(i: number) { return [...this.items.keys()][i] ?? null; }
  getItem(k: string) { return this.items.get(k) ?? null; }
  setItem(k: string, v: string) { this.items.set(k, String(v)); }
  removeItem(k: string) { this.items.delete(k); }
  clear() { this.items.clear(); }
}

beforeEach(() => {
  Object.defineProperty(window, 'localStorage', { value: new MemoryStorage(), configurable: true });
});

/**
 * SOLIS sandbox (2026-10): in the browser, the collections staff edit
 * survive a page refresh — only in the sandbox.
 */

async function freshStore() {
  vi.resetModules();
  (globalThis as Record<symbol, unknown>)[Symbol.for('solis.mockStore.v1')] = undefined;
  const state = (globalThis as Record<symbol, { resetting: boolean } | undefined>)[Symbol.for('solis.sandbox.persistence.v1')];
  if (state) state.resetting = false; // a reload starts a new page
  return import('./mockStore');
}

afterEach(() => {
  vi.unstubAllEnvs();
  window.localStorage.clear();
});

describe('sandbox browser persistence', () => {
  it('saves edited collections when the page is left and restores them on the next load', async () => {
    vi.stubEnv('NEXT_PUBLIC_SOLIS_SANDBOX', 'true');
    let store = await freshStore();
    const tasks = store.mockCollection('taskFixtures', () => [{ id: 't1', assigneeStaffId: 'staff-priya' }]);
    tasks[0] = { id: 't1', assigneeStaffId: 'staff-dana' };
    window.dispatchEvent(new Event('pagehide'));

    store = await freshStore();
    expect(store.mockCollection('taskFixtures', () => [{ id: 't1', assigneeStaffId: 'staff-priya' }])).toEqual([{ id: 't1', assigneeStaffId: 'staff-dana' }]);
  });

  it('only the collections staff edit are kept; everything else starts fresh', async () => {
    vi.stubEnv('NEXT_PUBLIC_SOLIS_SANDBOX', 'true');
    let store = await freshStore();
    store.mockCollection('rolePermissionFixtures', () => [1])[0] = 2;
    window.dispatchEvent(new Event('pagehide'));
    store = await freshStore();
    expect(store.mockCollection('rolePermissionFixtures', () => [1])).toEqual([1]);
  });

  it('"Reset fictional data" forgets the saved copy', async () => {
    vi.stubEnv('NEXT_PUBLIC_SOLIS_SANDBOX', 'true');
    let store = await freshStore();
    store.mockCollection('taskFixtures', () => ['fresh'])[0] = 'edited';
    window.dispatchEvent(new Event('pagehide'));
    store.resetSandboxBrowserData();
    window.dispatchEvent(new Event('pagehide'));
    store = await freshStore();
    expect(store.mockCollection('taskFixtures', () => ['fresh'])).toEqual(['fresh']);
  });

  it('outside the sandbox nothing is saved', async () => {
    vi.stubEnv('NEXT_PUBLIC_SOLIS_SANDBOX', '');
    const store = await freshStore();
    store.mockCollection('taskFixtures', () => ['fresh'])[0] = 'edited';
    window.dispatchEvent(new Event('pagehide'));
    expect(window.localStorage.length).toBe(0);
  });
});
