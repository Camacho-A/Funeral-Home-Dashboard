import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchMyPermissions } from './identityAuthClient';

/**
 * Manors go-live hardening. `parseJsonOrThrow` attaches the response's
 * HTTP status to the thrown Error so app/providers.tsx's shared
 * QueryClient retry policy (see app/providers.test.ts) can recognize an
 * authorization failure and skip retrying it. This test proves that
 * attachment happens, independent of any specific query hook.
 */
describe('identityAuthClient — error status propagation', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('a 403 response throws an Error carrying status: 403', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 403, json: async () => ({ error: 'Not authorized.' }) }),
    );
    await expect(fetchMyPermissions('org-1')).rejects.toMatchObject({ message: 'Not authorized.', status: 403 });
  });
});
