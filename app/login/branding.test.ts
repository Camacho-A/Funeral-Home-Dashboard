import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Sign-in branding resolution (2026-10). These tests exist to prove the
 * login screen's logo is DYNAMIC — read from the resolved organization's
 * own branding configuration — and not a hardcoded tenant asset. Swapping
 * the hostname must swap the branding, and an unrecognised hostname must
 * produce no organization at all.
 */

const headersMock = vi.fn();
vi.mock('next/headers', () => ({ headers: () => headersMock() }));

const getForOrganization = vi.fn();
vi.mock('@/services/organizationsService', () => ({
  getForOrganization: (...args: unknown[]) => getForOrganization(...args),
}));

const getBranding = vi.fn();
vi.mock('@/services/organizationProvisioningService', () => ({
  getBranding: (...args: unknown[]) => getBranding(...args),
}));

function withHost(host: string | null) {
  headersMock.mockResolvedValue({ get: (key: string) => (key === 'host' ? host : null) });
}

/** Two real tenants, each with its own name and its own logo. */
const ORGANIZATIONS: Record<string, { id: string; name: string; isActive: boolean }> = {
  'managed-cremations': { id: 'managed-cremations', name: 'MANORS CREMATION', isActive: true },
  'gus-camacho-jr': { id: 'gus-camacho-jr', name: 'Gus Camacho Jr. Funeral Home', isActive: true },
};
const LOGOS: Record<string, string> = {
  'managed-cremations': 'https://blob.example.com/manors.png',
  'gus-camacho-jr': 'https://blob.example.com/gus.png',
};

async function loadLoginOrganization() {
  // Imported per-test: the module reads env at call time, but Vitest
  // caches modules, so a fresh import keeps each case independent.
  const mod = await import('./branding');
  return mod.loadLoginOrganization();
}

describe('loadLoginOrganization', () => {
  beforeEach(() => {
    vi.resetModules();
    getForOrganization.mockImplementation(async (id: string) => ORGANIZATIONS[id] ?? null);
    getBranding.mockImplementation(async (id: string) => ({
      organizationId: id,
      logoUrl: LOGOS[id] ?? null,
      signInLogoUrl: null,
      primaryColor: null,
      secondaryColor: null,
      accentColor: null,
      emailFromName: null,
      documentFooter: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }));
    process.env.LOGIN_ORGANIZATION_HOSTS =
      'solis.manorscremation.com=managed-cremations,gus.example.com=gus-camacho-jr';
    delete process.env.LOGIN_ORGANIZATION_ID;
  });

  afterEach(() => {
    delete process.env.LOGIN_ORGANIZATION_HOSTS;
    delete process.env.LOGIN_ORGANIZATION_ID;
    vi.clearAllMocks();
  });

  it("serves Manors' own branding on the Manors hostname", async () => {
    withHost('solis.manorscremation.com');
    expect(await loadLoginOrganization()).toEqual({
      name: 'MANORS CREMATION',
      logoUrl: 'https://blob.example.com/manors.png',
    });
  });

  it('serves a DIFFERENT organization its own branding on its own hostname', async () => {
    // The point of the whole exercise: same deployment, same component,
    // different tenant — nothing about Manors is baked in.
    withHost('gus.example.com');
    expect(await loadLoginOrganization()).toEqual({
      name: 'Gus Camacho Jr. Funeral Home',
      logoUrl: 'https://blob.example.com/gus.png',
    });
  });

  it('shows no organization at all on an unmapped hostname', async () => {
    withHost('app.solis.example');
    expect(await loadLoginOrganization()).toBeNull();
    // Nothing was even looked up — an unknown host must not probe tenants.
    expect(getForOrganization).not.toHaveBeenCalled();
    expect(getBranding).not.toHaveBeenCalled();
  });

  it('never defaults to a tenant when nothing is configured', async () => {
    delete process.env.LOGIN_ORGANIZATION_HOSTS;
    withHost('solis.manorscremation.com');
    expect(await loadLoginOrganization()).toBeNull();
  });

  it('prefers an explicitly configured sign-in logo over the sidebar mark', async () => {
    getBranding.mockResolvedValueOnce({
      organizationId: 'managed-cremations',
      logoUrl: 'https://blob.example.com/mark.png',
      signInLogoUrl: 'https://blob.example.com/signin.png',
      primaryColor: null,
      secondaryColor: null,
      accentColor: null,
      emailFromName: null,
      documentFooter: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    withHost('solis.manorscremation.com');
    expect((await loadLoginOrganization())?.logoUrl).toBe('https://blob.example.com/signin.png');
  });

  it('identifies the workspace even when the organization has uploaded no logo', async () => {
    getBranding.mockResolvedValueOnce(null);
    withHost('gus.example.com');
    expect(await loadLoginOrganization()).toEqual({ name: 'Gus Camacho Jr. Funeral Home', logoUrl: null });
  });

  it('shows nothing for a suspended organization', async () => {
    getForOrganization.mockResolvedValueOnce({ id: 'gus-camacho-jr', name: 'Gus Camacho Jr.', isActive: false });
    withHost('gus.example.com');
    expect(await loadLoginOrganization()).toBeNull();
  });

  it('never lets a branding failure block the sign-in form', async () => {
    getBranding.mockRejectedValueOnce(new Error('Wix is down'));
    withHost('solis.manorscremation.com');
    expect(await loadLoginOrganization()).toBeNull();
  });
});
