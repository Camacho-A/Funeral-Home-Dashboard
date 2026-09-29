import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import {
  mockOrganizationFixtures,
  mockDefaultUser,
  mockMultiOrgUser,
  mockManagerUser,
  mockOfficeStaffUser,
  mockAccountingUser,
  mockReadOnlyUser,
  mockDispatchUser,
} from '@/services/__mocks__/authFixtures';
import { organizationLocationFixtures } from '@/services/__mocks__/onboardingFixtures';
import { organizationRolePermissionOverrideFixtures } from '@/services/__mocks__/rbacFixtures';
import { DEFAULT_ORGANIZATION_ID, SECOND_MOCK_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';

/**
 * Settings → Organization Profile (2026-09). Every test runs under
 * `DATA_ADAPTER=mock` — `organizationProvisioningService.ts`'s
 * `getOrganization`/`updateOrganization`/`getPrimaryLocation`/
 * `updatePrimaryLocation` all have real mock-mode branches against these
 * exact fixtures, and mock-mode RBAC resolution reads role/permission
 * fixtures directly with no `queryWixDataItems` involved at all (see
 * `app/api/organization/case-sequence/route.test.ts`'s own comment) — so
 * no Wix mocking is needed anywhere in this file. Synthetic data only.
 */

let mockSession: { user: typeof mockDefaultUser } | null = { user: mockDefaultUser };
vi.mock('@/lib/auth/session', () => ({
  getSession: async () => mockSession,
}));

const { GET, PATCH } = await import('./route');

function getRequest(organizationId: string | null) {
  const params = new URLSearchParams();
  if (organizationId) params.set('organizationId', organizationId);
  return GET(new Request(`http://localhost/api/organization/profile?${params.toString()}`));
}

const SAME_ORIGIN_HEADERS = { origin: 'http://localhost', host: 'localhost', 'Content-Type': 'application/json' };

function patchRequest(body: unknown, headers: Record<string, string> = SAME_ORIGIN_HEADERS) {
  return PATCH(new Request('http://localhost/api/organization/profile', { method: 'PATCH', headers, body: JSON.stringify(body) }));
}

const VALID_ORG_PATCH = {
  name: 'MANORS CREMATION SERVICES',
  legalName: "MANORS CREMATION SERVICES, LLC",
  primaryEmail: 'contact@manorscremation.com',
  primaryPhone: '954-884-5770',
  website: 'https://manorscremation.com',
};

const VALID_LOCATION_PATCH = {
  name: 'Main Office',
  locationType: 'office',
  addressLine1: '481 E Commercial Blvd',
  addressLine2: '',
  city: 'Oakland Park',
  state: 'FL',
  postalCode: '33334',
  country: 'US',
  phone: '954-884-5770',
  email: 'contact@manorscremation.com',
};

let orgSnapshot: typeof mockOrganizationFixtures;
let locationSnapshot: typeof organizationLocationFixtures;
let overrideSnapshot: typeof organizationRolePermissionOverrideFixtures;

beforeEach(() => {
  process.env.DATA_ADAPTER = 'mock';
  mockSession = { user: mockDefaultUser };
  orgSnapshot = [...mockOrganizationFixtures];
  locationSnapshot = [...organizationLocationFixtures];
  overrideSnapshot = [...organizationRolePermissionOverrideFixtures];
});

afterEach(() => {
  delete process.env.DATA_ADAPTER;
  mockOrganizationFixtures.splice(0, mockOrganizationFixtures.length, ...orgSnapshot);
  organizationLocationFixtures.splice(0, organizationLocationFixtures.length, ...locationSnapshot);
  organizationRolePermissionOverrideFixtures.splice(0, organizationRolePermissionOverrideFixtures.length, ...overrideSnapshot);
});

describe('GET /api/organization/profile', () => {
  it('1. an authorized Administrator can read Organization Profile', async () => {
    const response = await getRequest(DEFAULT_ORGANIZATION_ID);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.organization).toBeDefined();
    expect(body.location).toBeDefined();
  });

  it('returns 401 with no session', async () => {
    mockSession = null;
    expect((await getRequest(DEFAULT_ORGANIZATION_ID)).status).toBe(401);
  });

  it('4/9. Office Staff cannot read (and, via the same gate, cannot update)', async () => {
    mockSession = { user: mockOfficeStaffUser };
    expect((await getRequest(DEFAULT_ORGANIZATION_ID)).status).toBe(403);
  });

  it('5. Read Only cannot read', async () => {
    mockSession = { user: mockReadOnlyUser };
    expect((await getRequest(DEFAULT_ORGANIZATION_ID)).status).toBe(403);
  });

  it('6. Dispatch cannot read', async () => {
    mockSession = { user: mockDispatchUser };
    expect((await getRequest(DEFAULT_ORGANIZATION_ID)).status).toBe(403);
  });

  it('7. Accounting cannot read by default (no organization.manage grant)', async () => {
    mockSession = { user: mockAccountingUser };
    expect((await getRequest(DEFAULT_ORGANIZATION_ID)).status).toBe(403);
  });

  it('Manager cannot read (organization.manage is administrator-only by default)', async () => {
    mockSession = { user: mockManagerUser };
    expect((await getRequest(DEFAULT_ORGANIZATION_ID)).status).toBe(403);
  });

  it('9/10/11. cross-organization read is rejected — a caller\'s own membership is the only thing that grants access, never a client-supplied organizationId', async () => {
    // mockMultiOrgUser holds a real membership on DEFAULT_ORGANIZATION_ID
    // (role 'staff' -> officeStaff, no organization.manage) — proves both
    // "wrong org" and "no permission even if org matched" in one pass
    // depending on which id is requested.
    mockSession = { user: mockMultiOrgUser };
    expect((await getRequest(SECOND_MOCK_ORGANIZATION_ID)).status).toBe(403);
  });

  it('19. never returns a technical/configuration field', async () => {
    const response = await getRequest(DEFAULT_ORGANIZATION_ID);
    const raw = JSON.stringify(await response.json());
    for (const field of ['slug', 'status', 'enabledModules', 'familyPortalEnabled', 'signatureRequestsEnabled', 'requireMfa', 'defaultCurrency', 'timezone', 'organizationId', 'isPrimary', 'isActive', 'createdAt']) {
      expect(raw).not.toContain(field);
    }
  });

  it('23. a missing primary location is reported clearly, not silently created', async () => {
    organizationLocationFixtures.splice(0, organizationLocationFixtures.length);
    const response = await getRequest(DEFAULT_ORGANIZATION_ID);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.location).toBeNull();
  });
});

describe('PATCH /api/organization/profile — organization section', () => {
  it('2. an authorized Administrator can update allowed Organization fields', async () => {
    const response = await patchRequest({ organizationId: DEFAULT_ORGANIZATION_ID, organization: VALID_ORG_PATCH });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.organization.name).toBe('MANORS CREMATION SERVICES');
    expect(body.organization.primaryEmail).toBe('contact@manorscremation.com');
  });

  it('rejects a cross-site request (CSRF)', async () => {
    const response = await patchRequest(
      { organizationId: DEFAULT_ORGANIZATION_ID, organization: VALID_ORG_PATCH },
      { origin: 'https://evil.example.com', host: 'localhost', 'Content-Type': 'application/json' },
    );
    expect(response.status).toBe(403);
  });

  it('4. Office Staff cannot update', async () => {
    mockSession = { user: mockOfficeStaffUser };
    expect((await patchRequest({ organizationId: DEFAULT_ORGANIZATION_ID, organization: VALID_ORG_PATCH })).status).toBe(403);
  });

  it('5. Read Only cannot update', async () => {
    mockSession = { user: mockReadOnlyUser };
    expect((await patchRequest({ organizationId: DEFAULT_ORGANIZATION_ID, organization: VALID_ORG_PATCH })).status).toBe(403);
  });

  it('6. Dispatch cannot update', async () => {
    mockSession = { user: mockDispatchUser };
    expect((await patchRequest({ organizationId: DEFAULT_ORGANIZATION_ID, organization: VALID_ORG_PATCH })).status).toBe(403);
  });

  it('7. Accounting cannot update by default', async () => {
    mockSession = { user: mockAccountingUser };
    expect((await patchRequest({ organizationId: DEFAULT_ORGANIZATION_ID, organization: VALID_ORG_PATCH })).status).toBe(403);
  });

  it('8/11. an organization-level GRANT override lets Office Staff manage the profile', async () => {
    organizationRolePermissionOverrideFixtures.push({
      id: 'ov-grant-1',
      organizationId: DEFAULT_ORGANIZATION_ID,
      roleKey: 'officeStaff',
      permissionKey: 'organization.manage',
      action: 'grant',
      reason: 'test',
      createdAt: '2026-01-01T00:00:00.000Z',
      createdBy: 'mock-user-dana',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    mockSession = { user: mockOfficeStaffUser };
    const response = await patchRequest({ organizationId: DEFAULT_ORGANIZATION_ID, organization: VALID_ORG_PATCH });
    expect(response.status).toBe(200);
  });

  it('8/11. an organization-level REVOKE override removes Administrator\'s own access', async () => {
    organizationRolePermissionOverrideFixtures.push({
      id: 'ov-revoke-1',
      organizationId: DEFAULT_ORGANIZATION_ID,
      roleKey: 'administrator',
      permissionKey: 'organization.manage',
      action: 'revoke',
      reason: 'test',
      createdAt: '2026-01-01T00:00:00.000Z',
      createdBy: 'mock-user-dana',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    const response = await patchRequest({ organizationId: DEFAULT_ORGANIZATION_ID, organization: VALID_ORG_PATCH });
    expect(response.status).toBe(403);
  });

  it('9/10/11. cross-organization update is rejected', async () => {
    mockSession = { user: mockMultiOrgUser };
    const response = await patchRequest({ organizationId: SECOND_MOCK_ORGANIZATION_ID, organization: VALID_ORG_PATCH });
    expect(response.status).toBe(403);
    // The organization this caller does NOT belong to is left completely untouched.
    const secondOrg = mockOrganizationFixtures.find((o) => o.id === SECOND_MOCK_ORGANIZATION_ID);
    expect(secondOrg?.name).toBe('Evergreen Memorial Group');
  });

  it('12/16/17/18/19/20. an update to Organization never disturbs slug/status/enabledModules/requireMfa/familyPortalEnabled/signatureRequestsEnabled/timezone/defaultCurrency', async () => {
    const before = mockOrganizationFixtures.find((o) => o.id === DEFAULT_ORGANIZATION_ID)!;
    mockOrganizationFixtures[mockOrganizationFixtures.findIndex((o) => o.id === DEFAULT_ORGANIZATION_ID)] = {
      ...before,
      slug: 'manors-cremation',
      status: 'active',
      timezone: 'America/Chicago',
      defaultCurrency: 'usd',
      requireMfa: true,
      enabledModules: ['inventory'],
      familyPortalEnabled: false,
      signatureRequestsEnabled: false,
    };

    await patchRequest({ organizationId: DEFAULT_ORGANIZATION_ID, organization: VALID_ORG_PATCH });

    const after = mockOrganizationFixtures.find((o) => o.id === DEFAULT_ORGANIZATION_ID)!;
    expect(after.slug).toBe('manors-cremation');
    expect(after.status).toBe('active');
    expect(after.timezone).toBe('America/Chicago');
    expect(after.defaultCurrency).toBe('usd');
    expect(after.requireMfa).toBe(true);
    expect(after.enabledModules).toEqual(['inventory']);
    expect(after.familyPortalEnabled).toBe(false);
    expect(after.signatureRequestsEnabled).toBe(false);
  });

  it('24. rejects an invalid email', async () => {
    const response = await patchRequest({ organizationId: DEFAULT_ORGANIZATION_ID, organization: { ...VALID_ORG_PATCH, primaryEmail: 'not-an-email' } });
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.fieldErrors).toContainEqual(expect.objectContaining({ field: 'primaryEmail' }));
  });

  it('25. rejects an invalid website', async () => {
    const response = await patchRequest({ organizationId: DEFAULT_ORGANIZATION_ID, organization: { ...VALID_ORG_PATCH, website: 'not a url' } });
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.fieldErrors).toContainEqual(expect.objectContaining({ field: 'website' }));
  });

  it('rejects a missing/blank required name', async () => {
    const response = await patchRequest({ organizationId: DEFAULT_ORGANIZATION_ID, organization: { ...VALID_ORG_PATCH, name: '' } });
    expect(response.status).toBe(400);
  });

  it('29/30/31. ALL-CAPS normalization applies to name/legalName, never to email/website/phone', async () => {
    const response = await patchRequest({
      organizationId: DEFAULT_ORGANIZATION_ID,
      organization: { name: 'manors cremation services', legalName: 'manors llc', primaryEmail: 'Contact@ManorsCremation.com', website: 'https://ManorsCremation.com', primaryPhone: '954-884-5770' },
    });
    const body = await response.json();
    expect(body.organization.name).toBe('MANORS CREMATION SERVICES');
    expect(body.organization.legalName).toBe('MANORS LLC');
    expect(body.organization.primaryEmail).toBe('Contact@ManorsCremation.com');
    expect(body.organization.website).toBe('https://ManorsCremation.com');
    expect(body.organization.primaryPhone).toBe('954-884-5770');
  });

  it('33. a successful save returns the fresh, persisted values', async () => {
    const response = await patchRequest({ organizationId: DEFAULT_ORGANIZATION_ID, organization: VALID_ORG_PATCH });
    const body = await response.json();
    const persisted = mockOrganizationFixtures.find((o) => o.id === DEFAULT_ORGANIZATION_ID);
    expect(body.organization.name).toBe(persisted?.name);
  });
});

describe('PATCH /api/organization/profile — primary location section', () => {
  it('3. an authorized Administrator can update allowed primary Location fields', async () => {
    const response = await patchRequest({ organizationId: DEFAULT_ORGANIZATION_ID, location: VALID_LOCATION_PATCH });
    expect(response.status).toBe(200);
    const body = await response.json();
    // Uppercased by the ALL-CAPS normalization — see the dedicated
    // normalization test further below for the policy itself.
    expect(body.location.addressLine1).toBe('481 E COMMERCIAL BLVD');
    expect(body.location.city).toBe('OAKLAND PARK');
  });

  it('4. Office Staff cannot update the location', async () => {
    mockSession = { user: mockOfficeStaffUser };
    expect((await patchRequest({ organizationId: DEFAULT_ORGANIZATION_ID, location: VALID_LOCATION_PATCH })).status).toBe(403);
  });

  it('13/21/22/23. an update to the location never disturbs id/organizationId/isPrimary/isActive/createdAt', async () => {
    const beforeIndex = organizationLocationFixtures.findIndex((l) => l.organizationId === DEFAULT_ORGANIZATION_ID && l.isPrimary);
    const before = organizationLocationFixtures[beforeIndex];

    await patchRequest({ organizationId: DEFAULT_ORGANIZATION_ID, location: VALID_LOCATION_PATCH });

    const after = organizationLocationFixtures[beforeIndex];
    expect(after.id).toBe(before.id);
    expect(after.organizationId).toBe(before.organizationId);
    expect(after.isPrimary).toBe(true);
    expect(after.isActive).toBe(before.isActive);
    expect(after.createdAt).toBe(before.createdAt);
  });

  it('23/28. a missing primary location returns a clear administrative error and creates nothing', async () => {
    organizationLocationFixtures.splice(0, organizationLocationFixtures.length);

    const response = await patchRequest({ organizationId: DEFAULT_ORGANIZATION_ID, location: VALID_LOCATION_PATCH });
    expect(response.status).toBe(404);
    expect(organizationLocationFixtures.length).toBe(0); // still 0 — nothing was created
  });

  it('26. rejects a missing required address field', async () => {
    const response = await patchRequest({ organizationId: DEFAULT_ORGANIZATION_ID, location: { ...VALID_LOCATION_PATCH, city: '' } });
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.fieldErrors).toContainEqual(expect.objectContaining({ field: 'city' }));
  });

  it('27. rejects an invalid locationType', async () => {
    const response = await patchRequest({ organizationId: DEFAULT_ORGANIZATION_ID, location: { ...VALID_LOCATION_PATCH, locationType: 'headquarters' } });
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.fieldErrors).toContainEqual(expect.objectContaining({ field: 'locationType' }));
  });

  it('29/32. ALL-CAPS normalization applies to address fields, never to locationType/phone/email', async () => {
    const response = await patchRequest({
      organizationId: DEFAULT_ORGANIZATION_ID,
      location: { ...VALID_LOCATION_PATCH, name: 'main office', addressLine1: '481 e commercial blvd', city: 'oakland park' },
    });
    const body = await response.json();
    expect(body.location.name).toBe('MAIN OFFICE');
    expect(body.location.addressLine1).toBe('481 E COMMERCIAL BLVD');
    expect(body.location.city).toBe('OAKLAND PARK');
    expect(body.location.locationType).toBe('office');
    expect(body.location.phone).toBe('954-884-5770');
    expect(body.location.email).toBe('contact@manorscremation.com');
  });

  it('9/10. cross-organization location update is rejected, and never touches another organization\'s location', async () => {
    mockSession = { user: mockMultiOrgUser };
    const response = await patchRequest({ organizationId: SECOND_MOCK_ORGANIZATION_ID, location: VALID_LOCATION_PATCH });
    expect(response.status).toBe(403);
  });
});
