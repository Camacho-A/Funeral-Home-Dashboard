import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fetchManorsCaseNumberManageMigrationStatus,
  executeManorsCaseNumberManageMigration,
  isManorsRbacMigrationOrganization,
} from './manorsRbacMigrationClient';

/** Safe onboarding (2026-10): the Manors-only migration is inert for any
    other organization — no request is ever made for Gus. */
afterEach(() => vi.unstubAllGlobals());

describe('manorsRbacMigrationClient', () => {
  it('only Manors is a migration organization', () => {
    expect(isManorsRbacMigrationOrganization('managed-cremations')).toBe(true);
    expect(isManorsRbacMigrationOrganization('gus-camacho-jr')).toBe(false);
    expect(isManorsRbacMigrationOrganization('')).toBe(false);
  });

  it('status for Gus is "not applicable" without any request', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    await expect(fetchManorsCaseNumberManageMigrationStatus('gus-camacho-jr')).resolves.toEqual({
      organizationId: 'gus-camacho-jr',
      applicable: false,
      needsMigration: false,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('execute for Gus is refused without any request', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    await expect(executeManorsCaseNumberManageMigration('gus-camacho-jr')).rejects.toThrow(/only available for the Manors organization/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('Manors still calls the route', async () => {
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ organizationId: 'managed-cremations', applicable: true, needsMigration: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);
    const status = await fetchManorsCaseNumberManageMigrationStatus('managed-cremations');
    expect(status.applicable).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
