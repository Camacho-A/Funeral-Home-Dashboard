import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { mockOrganizationFixtures } from './__mocks__/authFixtures';
import { organizationLocationFixtures, onboardingSessionFixtures } from './__mocks__/onboardingFixtures';
import { DEFAULT_ORGANIZATION_ID } from './__mocks__/organizationIds';

let idCounter = 0;
function idFactory(): string {
  idCounter += 1;
  return `migration-test-id-${idCounter}`;
}

let lengths: { org: number; location: number; session: number };
let manorsSnapshot: (typeof mockOrganizationFixtures)[number];
let manorsIndex: number;

beforeEach(() => {
  idCounter = 0;
  lengths = {
    org: mockOrganizationFixtures.length,
    location: organizationLocationFixtures.length,
    session: onboardingSessionFixtures.length,
  };
  // Manor's own row is mutated *in place* by updateOrganization (an index
  // within the pre-existing fixture array, not appended) — truncating the
  // array length back afterward (as done for every push-only mutation
  // elsewhere in this codebase's tests) would miss reverting that. Snapshot
  // and restore it explicitly by index instead.
  manorsIndex = mockOrganizationFixtures.findIndex((o) => o.id === DEFAULT_ORGANIZATION_ID);
  manorsSnapshot = { ...mockOrganizationFixtures[manorsIndex] };
});

afterEach(() => {
  mockOrganizationFixtures.length = lengths.org;
  mockOrganizationFixtures[manorsIndex] = manorsSnapshot;
  organizationLocationFixtures.length = lengths.location;
  onboardingSessionFixtures.length = lengths.session;
});

const MANORS_INPUT = {
  organizationId: DEFAULT_ORGANIZATION_ID,
  legalName: "Manor's Cremation Services, LLC",
  displayName: "Manor's Cremation",
  primaryEmail: 'staff@managedcremations.test',
  primaryPhone: '(555) 201-4432',
  timezone: 'America/Chicago',
  defaultCurrency: 'usd',
  primaryLocation: {
    name: "Manor's Cremation — Main Office",
    addressLine1: '100 Memorial Drive',
    city: 'Springfield',
    state: 'IL',
    postalCode: '62701',
    country: 'US',
    phone: '(555) 201-4432',
  },
  actorUserId: 'platform-admin-1',
};

describe('migrateExistingOrganization — Manor\'s Cremation (already-existing tenant)', () => {
  it('does not duplicate the organization row — backfills the existing one instead', async () => {
    const { migrateExistingOrganization } = await import('./organizationProvisioningService');
    const before = mockOrganizationFixtures.length;

    const report = await migrateExistingOrganization(MANORS_INPUT, idFactory, 'mock');

    expect(report.organization.created).toBe(false);
    expect(mockOrganizationFixtures.length).toBe(before); // no new row inserted
    expect(mockOrganizationFixtures.filter((o) => o.id === DEFAULT_ORGANIZATION_ID)).toHaveLength(1);
  });

  it('backfills only the fields Manor\'s row is currently missing', async () => {
    const { migrateExistingOrganization, getOrganization } = await import('./organizationProvisioningService');
    const before = await getOrganization(DEFAULT_ORGANIZATION_ID, 'mock');
    expect(before?.slug).toBeUndefined(); // confirms the pre-migration state this test exercises

    const report = await migrateExistingOrganization(MANORS_INPUT, idFactory, 'mock');
    expect(report.organization.backfilledFields).toEqual(
      expect.arrayContaining(['legalName', 'slug', 'status', 'timezone', 'defaultCurrency', 'primaryEmail', 'primaryPhone']),
    );

    const after = await getOrganization(DEFAULT_ORGANIZATION_ID, 'mock');
    expect(after?.slug).toBe('manors-cremation');
    expect(after?.status).toBe('active');
    expect(after?.name).toBe("Manor's Cremation"); // untouched — already had a value
    expect(after?.isActive).toBe(true); // untouched — already true
  });

  it('never overwrites a field that already has a value', async () => {
    const { migrateExistingOrganization } = await import('./organizationProvisioningService');
    await migrateExistingOrganization(MANORS_INPUT, idFactory, 'mock');
    // Second run with deliberately different (wrong) input values — none of
    // the already-backfilled fields should change.
    const report = await migrateExistingOrganization(
      { ...MANORS_INPUT, legalName: 'Some Other Name', timezone: 'America/Los_Angeles' },
      idFactory,
      'mock',
    );
    expect(report.organization.backfilledFields).toEqual([]);

    const { getOrganization } = await import('./organizationProvisioningService');
    const org = await getOrganization(DEFAULT_ORGANIZATION_ID, 'mock');
    expect(org?.legalName).not.toBe('Some Other Name');
    expect(org?.timezone).not.toBe('America/Los_Angeles');
  });

  it('finds Manor\'s already-seeded primary location, workflow, catalog, and Clover integration rather than creating new ones', async () => {
    const { migrateExistingOrganization } = await import('./organizationProvisioningService');
    const locationsBefore = organizationLocationFixtures.filter((l) => l.organizationId === DEFAULT_ORGANIZATION_ID).length;

    const report = await migrateExistingOrganization(MANORS_INPUT, idFactory, 'mock');

    expect(report.primaryLocation.created).toBe(false);
    expect(organizationLocationFixtures.filter((l) => l.organizationId === DEFAULT_ORGANIZATION_ID)).toHaveLength(locationsBefore);
    expect(report.workflowTemplate).toEqual({ id: expect.any(String), found: true });
    expect(report.serviceCatalog.count).toBeGreaterThan(0);
    expect(report.paymentIntegration).toEqual({ id: expect.any(String), found: true });
  });

  it('is safe to run more than once — a second run reports everything already linked, nothing newly created', async () => {
    const { migrateExistingOrganization } = await import('./organizationProvisioningService');
    await migrateExistingOrganization(MANORS_INPUT, idFactory, 'mock');
    const second = await migrateExistingOrganization(MANORS_INPUT, idFactory, 'mock');

    expect(second.organization.created).toBe(false);
    expect(second.primaryLocation.created).toBe(false);
    expect(second.onboardingSession.created).toBe(false);
  });
});

describe('migrateExistingOrganization — a genuinely new pre-existing tenant (no prior rows at all)', () => {
  const FRESH_ORG_ID = 'legacy-tenant-not-yet-onboarded';

  it('creates the organization, location, and a completed onboarding session', async () => {
    const { migrateExistingOrganization } = await import('./organizationProvisioningService');
    const report = await migrateExistingOrganization(
      {
        organizationId: FRESH_ORG_ID,
        legalName: 'Legacy Tenant LLC',
        displayName: 'Legacy Tenant',
        primaryEmail: 'staff@legacytenant.test',
        primaryPhone: '(555) 999-8888',
        timezone: 'America/Denver',
        defaultCurrency: 'usd',
        primaryLocation: { name: 'Main', addressLine1: '1 St', city: 'City', state: 'CO', postalCode: '80202', country: 'US', phone: '(555) 999-8888' },
        actorUserId: 'platform-admin-1',
      },
      idFactory,
      'mock',
    );

    expect(report.organization.created).toBe(true);
    expect(report.primaryLocation.created).toBe(true);
    expect(report.onboardingSession.created).toBe(true);
    expect(report.workflowTemplate).toEqual({ found: false });
    expect(report.serviceCatalog.count).toBe(0);
    expect(report.paymentIntegration).toEqual({ found: false });

    const org = mockOrganizationFixtures.find((o) => o.id === FRESH_ORG_ID);
    expect(org?.status).toBe('active');
    expect(org?.isActive).toBe(true);
  });

  it('is idempotent for a genuinely fresh organization too — a second call never duplicates records', async () => {
    const { migrateExistingOrganization } = await import('./organizationProvisioningService');
    const input = {
      organizationId: FRESH_ORG_ID,
      legalName: 'Legacy Tenant LLC',
      displayName: 'Legacy Tenant',
      primaryEmail: 'staff@legacytenant.test',
      primaryPhone: '(555) 999-8888',
      timezone: 'America/Denver',
      defaultCurrency: 'usd',
      primaryLocation: { name: 'Main', addressLine1: '1 St', city: 'City', state: 'CO', postalCode: '80202', country: 'US', phone: '(555) 999-8888' },
      actorUserId: 'platform-admin-1',
    };
    await migrateExistingOrganization(input, idFactory, 'mock');
    const second = await migrateExistingOrganization(input, idFactory, 'mock');

    expect(second.organization.created).toBe(false);
    expect(second.primaryLocation.created).toBe(false);
    expect(second.onboardingSession.created).toBe(false);
    expect(mockOrganizationFixtures.filter((o) => o.id === FRESH_ORG_ID)).toHaveLength(1);
    expect(organizationLocationFixtures.filter((l) => l.organizationId === FRESH_ORG_ID)).toHaveLength(1);
    expect(onboardingSessionFixtures.filter((s) => s.organizationId === FRESH_ORG_ID)).toHaveLength(1);
  });
});
