import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchChartOfAccounts } from './accountingClient';

/**
 * Manors go-live hardening. Same fix as identityAuthClient's own
 * parseJsonOrThrow — see that file's statusPropagation test for context.
 * This is the client implicated in the production finding (an
 * unauthorized /accounting query retrying for ~9s before this fix).
 */
describe('accountingClient — error status propagation', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('a 403 response throws an Error carrying status: 403', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 403, json: async () => ({ error: 'Not authorized.' }) }),
    );
    await expect(fetchChartOfAccounts('org-1')).rejects.toMatchObject({ message: 'Not authorized.', status: 403 });
  });
});
