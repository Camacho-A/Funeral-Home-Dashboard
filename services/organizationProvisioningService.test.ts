import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { mockOrganizationFixtures, mockMembershipFixtures } from './__mocks__/authFixtures';
import { workflowTemplateFixtures, STANDARD_CREMATION_WORKFLOW_TEMPLATE_ID } from './__mocks__/workflowTemplates';
import { serviceCatalogFixtures } from './__mocks__/pricingFixtures';
import { paymentIntegrationFixtures } from './__mocks__/paymentFixtures';
import {
  organizationLocationFixtures,
  onboardingSessionFixtures,
  organizationBrandingFixtures,
  onboardingAuditFixtures,
} from './__mocks__/onboardingFixtures';
import { roleFixtures, rolePermissionFixtures, organizationRoleFixtures, organizationRoleAuditEntryFixtures } from './__mocks__/rbacFixtures';
import { DEFAULT_ORGANIZATION_ID } from './__mocks__/organizationIds';

let idCounter = 0;
function idFactory(): string {
  idCounter += 1;
  return `test-id-${idCounter}`;
}

// Snapshot lengths of every array with pre-seeded fixture data (Manor's
// Cremation etc.) so afterEach can truncate back to exactly that,
// removing only what a test itself pushed — never clearing to 0, which
// would erase real seed data other tests/files depend on.
let lengths: Record<string, number>;

beforeEach(() => {
  idCounter = 0;
  lengths = {
    org: mockOrganizationFixtures.length,
    membership: mockMembershipFixtures.length,
    workflow: workflowTemplateFixtures.length,
    catalog: serviceCatalogFixtures.length,
    payment: paymentIntegrationFixtures.length,
    location: organizationLocationFixtures.length,
    session: onboardingSessionFixtures.length,
    branding: organizationBrandingFixtures.length,
    audit: onboardingAuditFixtures.length,
    role: roleFixtures.length,
    rolePermission: rolePermissionFixtures.length,
    organizationRole: organizationRoleFixtures.length,
    roleAudit: organizationRoleAuditEntryFixtures.length,
  };
});

afterEach(() => {
  mockOrganizationFixtures.length = lengths.org;
  mockMembershipFixtures.length = lengths.membership;
  workflowTemplateFixtures.length = lengths.workflow;
  serviceCatalogFixtures.length = lengths.catalog;
  paymentIntegrationFixtures.length = lengths.payment;
  organizationLocationFixtures.length = lengths.location;
  onboardingSessionFixtures.length = lengths.session;
  organizationBrandingFixtures.length = lengths.branding;
  onboardingAuditFixtures.length = lengths.audit;
  roleFixtures.length = lengths.role;
  rolePermissionFixtures.length = lengths.rolePermission;
  organizationRoleFixtures.length = lengths.organizationRole;
  organizationRoleAuditEntryFixtures.length = lengths.roleAudit;
});

describe('generateUniqueSlug', () => {
  it('normalizes the candidate name into a slug', async () => {
    const { generateUniqueSlug } = await import('./organizationProvisioningService');
    expect(await generateUniqueSlug('Smith Family Funeral Home', 'mock')).toBe('smith-family-funeral-home');
  });

  it('appends a numbered suffix on collision with an existing organization', async () => {
    const { generateUniqueSlug } = await import('./organizationProvisioningService');
    mockOrganizationFixtures.push({ id: idFactory(), name: 'Existing', isActive: true, slug: 'smith-family-funeral-home' });
    expect(await generateUniqueSlug('Smith Family Funeral Home', 'mock')).toBe('smith-family-funeral-home-2');
  });

  it('never returns a reserved slug, even with a colliding suffix appended', async () => {
    const { generateUniqueSlug } = await import('./organizationProvisioningService');
    const slug = await generateUniqueSlug('Admin', 'mock');
    expect(slug).not.toBe('admin');
    expect(slug).toBe('admin-org');
  });
});

describe('startOnboarding', () => {
  const INPUT = {
    idempotencyKey: 'start-key-1',
    legalName: 'Smith Family Funeral Home, LLC',
    displayName: 'Smith Family Funeral Home',
    primaryEmail: 'staff@smithfamily.test',
    primaryPhone: '(555) 000-1111',
    timezone: 'America/Chicago',
    defaultCurrency: 'usd',
    actorUserId: 'platform-admin-1',
    idFactory,
  };

  it('creates a new draft organization and an in_progress session', async () => {
    const { startOnboarding } = await import('./organizationProvisioningService');
    const { organization, session, isNew } = await startOnboarding(INPUT, 'mock');

    expect(isNew).toBe(true);
    expect(organization.status).toBe('onboarding'); // flipped from draft immediately after creation
    expect(organization.isActive).toBe(false);
    expect(organization.slug).toBe('smith-family-funeral-home');
    expect(session.status).toBe('in_progress');
    expect(session.currentStep).toBe('organization_profile');
    expect(session.organizationId).toBe(organization.id);
  });

  it('is idempotent: retrying with the same idempotencyKey returns the same organization and session, never a duplicate', async () => {
    const { startOnboarding } = await import('./organizationProvisioningService');
    const first = await startOnboarding(INPUT, 'mock');
    const second = await startOnboarding({ ...INPUT, idempotencyKey: INPUT.idempotencyKey }, 'mock');

    expect(second.isNew).toBe(false);
    expect(second.organization.id).toBe(first.organization.id);
    expect(second.session.id).toBe(first.session.id);
    expect(mockOrganizationFixtures.filter((o) => o.slug === 'smith-family-funeral-home')).toHaveLength(1);
  });

  it('creates a genuinely different organization for a different idempotencyKey', async () => {
    const { startOnboarding } = await import('./organizationProvisioningService');
    const first = await startOnboarding(INPUT, 'mock');
    const second = await startOnboarding({ ...INPUT, idempotencyKey: 'start-key-2', displayName: 'Different Name' }, 'mock');
    expect(second.organization.id).not.toBe(first.organization.id);
  });

  it('records an organization_created audit entry', async () => {
    const { startOnboarding, listOnboardingAudit } = await import('./organizationProvisioningService');
    const { organization } = await startOnboarding(INPUT, 'mock');
    const audit = await listOnboardingAudit(organization.id, 'mock');
    expect(audit.map((e) => e.action)).toContain('organization_created');
  });
});

describe('createPrimaryLocation', () => {
  it('creates a primary location for a new organization', async () => {
    const { createPrimaryLocation } = await import('./organizationProvisioningService');
    const orgId = idFactory();
    const { location, isNew } = await createPrimaryLocation(
      orgId,
      { name: 'Main Office', addressLine1: '1 Main St', city: 'Springfield', state: 'IL', postalCode: '62701', country: 'US', phone: '(555) 000-0000' },
      idFactory,
      'mock',
    );
    expect(isNew).toBe(true);
    expect(location.isPrimary).toBe(true);
    expect(location.organizationId).toBe(orgId);
  });

  it('is idempotent — a second call for the same organization returns the existing location, never a duplicate', async () => {
    const { createPrimaryLocation } = await import('./organizationProvisioningService');
    const orgId = idFactory();
    const input = { name: 'Main Office', addressLine1: '1 Main St', city: 'Springfield', state: 'IL', postalCode: '62701', country: 'US', phone: '(555) 000-0000' };
    const first = await createPrimaryLocation(orgId, input, idFactory, 'mock');
    const second = await createPrimaryLocation(orgId, { ...input, name: 'Different Name' }, idFactory, 'mock');

    expect(second.isNew).toBe(false);
    expect(second.location.id).toBe(first.location.id);
    expect(second.location.name).toBe('Main Office'); // unchanged by the second call's different input
    expect(organizationLocationFixtures.filter((l) => l.organizationId === orgId)).toHaveLength(1);
  });
});

describe('assignInitialAdministrator', () => {
  it('creates an administrator-role membership, never any other role', async () => {
    const { assignInitialAdministrator } = await import('./organizationProvisioningService');
    const orgId = idFactory();
    const { membership, isNew } = await assignInitialAdministrator(orgId, 'new-admin-user', idFactory, 'mock');
    expect(isNew).toBe(true);
    expect(membership.role).toBe('administrator');
    expect(membership.isActive).toBe(true);
  });

  it('is idempotent — a second call for the same (org, user) pair returns the existing membership', async () => {
    const { assignInitialAdministrator } = await import('./organizationProvisioningService');
    const orgId = idFactory();
    const first = await assignInitialAdministrator(orgId, 'new-admin-user', idFactory, 'mock');
    const second = await assignInitialAdministrator(orgId, 'new-admin-user', idFactory, 'mock');
    expect(second.isNew).toBe(false);
    expect(mockMembershipFixtures.filter((m) => m.organizationId === orgId && m.userId === 'new-admin-user')).toHaveLength(1);
    void first;
  });

  it('cross-organization isolation — assigning an administrator in one org never affects another org with the same userId', async () => {
    const { assignInitialAdministrator } = await import('./organizationProvisioningService');
    const orgA = idFactory();
    const orgB = idFactory();
    await assignInitialAdministrator(orgA, 'shared-user', idFactory, 'mock');
    const { isNew } = await assignInitialAdministrator(orgB, 'shared-user', idFactory, 'mock');
    expect(isNew).toBe(true); // org B has no membership yet, despite org A's existing one for the same user
  });
});

describe('provisionWorkflow', () => {
  it('creates a starter workflow for a new organization, organization-owned and independently versioned', async () => {
    const { provisionWorkflow } = await import('./organizationProvisioningService');
    const orgId = idFactory();
    const { template, isNew } = await provisionWorkflow(orgId, { mode: 'starter' }, idFactory, 'mock');
    expect(isNew).toBe(true);
    expect(template.organizationId).toBe(orgId);
    expect(template.versions).toHaveLength(1);
    expect(template.versions[0].version).toBe(1);
  });

  it('creates the minimal workflow when mode is minimal', async () => {
    const { provisionWorkflow } = await import('./organizationProvisioningService');
    const orgId = idFactory();
    const { template } = await provisionWorkflow(orgId, { mode: 'minimal' }, idFactory, 'mock');
    expect(template.versions[0].stages).toHaveLength(1);
  });

  it('clones an existing template\'s latest version by value, never by reference', async () => {
    const { provisionWorkflow } = await import('./organizationProvisioningService');
    const orgId = idFactory();
    const { template } = await provisionWorkflow(orgId, { mode: 'clone_existing', sourceTemplateId: STANDARD_CREMATION_WORKFLOW_TEMPLATE_ID }, idFactory, 'mock');

    const source = workflowTemplateFixtures.find((t) => t.id === STANDARD_CREMATION_WORKFLOW_TEMPLATE_ID)!;
    const sourceLatest = source.versions[source.versions.length - 1];

    expect(template.id).not.toBe(source.id); // a genuinely new template, never the same row
    expect(template.organizationId).toBe(orgId);
    expect(template.versions[0].stages).toEqual(sourceLatest.stages); // same content...
    expect(template.versions[0].stages).not.toBe(sourceLatest.stages); // ...but not the same array reference
  });

  it('never shares a mutable workflow instance between organizations — editing the clone never touches the source', async () => {
    const { provisionWorkflow } = await import('./organizationProvisioningService');
    const orgId = idFactory();
    const { template } = await provisionWorkflow(orgId, { mode: 'clone_existing', sourceTemplateId: STANDARD_CREMATION_WORKFLOW_TEMPLATE_ID }, idFactory, 'mock');

    template.versions[0].stages[0].label = 'Mutated Label';

    const source = workflowTemplateFixtures.find((t) => t.id === STANDARD_CREMATION_WORKFLOW_TEMPLATE_ID)!;
    expect(source.versions[source.versions.length - 1].stages[0].label).not.toBe('Mutated Label');
  });

  it('is idempotent — a second call for the same organization returns the existing workflow, never a duplicate', async () => {
    const { provisionWorkflow } = await import('./organizationProvisioningService');
    const orgId = idFactory();
    const first = await provisionWorkflow(orgId, { mode: 'starter' }, idFactory, 'mock');
    const second = await provisionWorkflow(orgId, { mode: 'minimal' }, idFactory, 'mock');
    expect(second.isNew).toBe(false);
    expect(second.template.id).toBe(first.template.id);
    expect(workflowTemplateFixtures.filter((t) => t.organizationId === orgId)).toHaveLength(1);
  });

  it('throws for clone_existing with no sourceTemplateId', async () => {
    const { provisionWorkflow } = await import('./organizationProvisioningService');
    await expect(provisionWorkflow(idFactory(), { mode: 'clone_existing' }, idFactory, 'mock')).rejects.toThrow();
  });
});

describe('provisionIntakeConfiguration', () => {
  it('returns the organization\'s own workflow intake', async () => {
    const { provisionWorkflow, provisionIntakeConfiguration } = await import('./organizationProvisioningService');
    const orgId = idFactory();
    await provisionWorkflow(orgId, { mode: 'starter' }, idFactory, 'mock');
    const intake = await provisionIntakeConfiguration(orgId, 'mock');
    expect(intake).not.toBeNull();
    expect(intake!.sections.length).toBeGreaterThan(0);
  });

  it('returns null when no workflow has been provisioned yet', async () => {
    const { provisionIntakeConfiguration } = await import('./organizationProvisioningService');
    expect(await provisionIntakeConfiguration(idFactory(), 'mock')).toBeNull();
  });
});

describe('filterRetiredIntakeFieldTypes', () => {
  it('strips any field carrying a retired payment-card fieldType, defensively', async () => {
    const { filterRetiredIntakeFieldTypes } = await import('./organizationProvisioningService');
    const filtered = filterRetiredIntakeFieldTypes({
      sections: [
        {
          key: 's',
          label: 'S',
          fields: [
            { key: 'a', label: 'A', fieldType: 'text' },
            { key: 'b', label: 'B', fieldType: 'creditCard' as never },
          ],
        },
      ],
    });
    expect(filtered.sections[0].fields.map((f) => f.key)).toEqual(['a']);
  });
});

describe('seedServiceCatalog', () => {
  it('seeds fresh, organization-owned rows for a new organization', async () => {
    const { seedServiceCatalog } = await import('./organizationProvisioningService');
    const orgId = idFactory();
    const { catalog, isNew } = await seedServiceCatalog(orgId, idFactory, 'mock');
    expect(isNew).toBe(true);
    expect(catalog.length).toBe(5);
    expect(catalog.every((c) => c.organizationId === orgId)).toBe(true);
  });

  it('never references another organization\'s catalog rows', async () => {
    const { seedServiceCatalog } = await import('./organizationProvisioningService');
    const orgId = idFactory();
    const { catalog } = await seedServiceCatalog(orgId, idFactory, 'mock');
    const manorsIds = serviceCatalogFixtures.filter((c) => c.organizationId === DEFAULT_ORGANIZATION_ID).map((c) => c.id);
    expect(catalog.some((c) => manorsIds.includes(c.id))).toBe(false);
  });

  it('is idempotent — a second call returns the existing catalog, never duplicating rows', async () => {
    const { seedServiceCatalog } = await import('./organizationProvisioningService');
    const orgId = idFactory();
    await seedServiceCatalog(orgId, idFactory, 'mock');
    const second = await seedServiceCatalog(orgId, idFactory, 'mock');
    expect(second.isNew).toBe(false);
    expect(serviceCatalogFixtures.filter((c) => c.organizationId === orgId)).toHaveLength(5);
  });
});

describe('createPaymentIntegrationPlaceholder', () => {
  it('creates a disabled Clover placeholder with only reference names, never secret values', async () => {
    const { createPaymentIntegrationPlaceholder } = await import('./organizationProvisioningService');
    const orgId = idFactory();
    const { integration, isNew } = await createPaymentIntegrationPlaceholder(
      orgId,
      'clover',
      { merchantIdReference: 'CLOVER_TEST_MERCHANT_ID' },
      'mock',
    );
    expect(isNew).toBe(true);
    expect(integration?.isEnabled).toBe(false);
    // merchantIdReference holds only the env-var *name*, never a real value.
    expect(integration?.merchantIdReference).toBe('CLOVER_TEST_MERCHANT_ID');
    expect(integration?.credentialReference).toBe('');
    expect(integration?.webhookSecretReference).toBe('');
  });

  it('creates no row at all for not_configured/configure_later', async () => {
    const { createPaymentIntegrationPlaceholder } = await import('./organizationProvisioningService');
    const orgId = idFactory();
    const notConfigured = await createPaymentIntegrationPlaceholder(orgId, 'not_configured', undefined, 'mock');
    const configureLater = await createPaymentIntegrationPlaceholder(idFactory(), 'configure_later', undefined, 'mock');
    expect(notConfigured.integration).toBeNull();
    expect(configureLater.integration).toBeNull();
  });

  it('is idempotent — a second "clover" call for the same organization returns the existing placeholder', async () => {
    const { createPaymentIntegrationPlaceholder } = await import('./organizationProvisioningService');
    const orgId = idFactory();
    const first = await createPaymentIntegrationPlaceholder(orgId, 'clover', {}, 'mock');
    const second = await createPaymentIntegrationPlaceholder(orgId, 'clover', {}, 'mock');
    expect(second.isNew).toBe(false);
    expect(second.integration?.id).toBe(first.integration?.id);
  });
});

describe('saveBranding', () => {
  it('creates a branding row on first save', async () => {
    const { saveBranding } = await import('./organizationProvisioningService');
    const orgId = idFactory();
    const branding = await saveBranding(orgId, { emailFromName: 'Test Org', primaryColor: '#123456' }, 'mock');
    expect(branding.emailFromName).toBe('Test Org');
    expect(branding.primaryColor).toBe('#123456');
  });

  it('updates the existing row on a second save, never creating a duplicate', async () => {
    const { saveBranding, getBranding } = await import('./organizationProvisioningService');
    const orgId = idFactory();
    await saveBranding(orgId, { emailFromName: 'First' }, 'mock');
    await saveBranding(orgId, { emailFromName: 'Second' }, 'mock');
    const current = await getBranding(orgId, 'mock');
    expect(current?.emailFromName).toBe('Second');
    expect(organizationBrandingFixtures.filter((b) => b.organizationId === orgId)).toHaveLength(1);
  });

  it('remains organization-scoped — saving branding for one org never affects another', async () => {
    const { saveBranding, getBranding } = await import('./organizationProvisioningService');
    const orgA = idFactory();
    const orgB = idFactory();
    await saveBranding(orgA, { emailFromName: 'Org A' }, 'mock');
    await saveBranding(orgB, { emailFromName: 'Org B' }, 'mock');
    expect((await getBranding(orgA, 'mock'))?.emailFromName).toBe('Org A');
    expect((await getBranding(orgB, 'mock'))?.emailFromName).toBe('Org B');
  });
});

describe('validateLaunchReadiness / completeOnboarding', () => {
  async function fullyProvisionedOrg() {
    const {
      startOnboarding,
      createPrimaryLocation,
      assignInitialAdministrator,
      provisionWorkflow,
      seedServiceCatalog,
      markStepCompleted,
    } = await import('./organizationProvisioningService');

    const { organization, session } = await startOnboarding(
      {
        idempotencyKey: idFactory(),
        legalName: 'Full Org LLC',
        displayName: 'Full Org',
        primaryEmail: 'staff@fullorg.test',
        primaryPhone: '(555) 000-2222',
        timezone: 'America/Chicago',
        defaultCurrency: 'usd',
        actorUserId: 'platform-admin-1',
        idFactory,
      },
      'mock',
    );
    await createPrimaryLocation(
      organization.id,
      { name: 'Main', addressLine1: '1 St', city: 'City', state: 'IL', postalCode: '11111', country: 'US', phone: '(555) 000-3333' },
      idFactory,
      'mock',
    );
    await assignInitialAdministrator(organization.id, 'full-org-admin', idFactory, 'mock');
    await provisionWorkflow(organization.id, { mode: 'starter' }, idFactory, 'mock');
    await seedServiceCatalog(organization.id, idFactory, 'mock');

    let current = session;
    for (const step of ['organization_profile', 'primary_location', 'administrator_account', 'workflow_setup', 'intake_setup', 'services_pricing', 'payments', 'branding'] as const) {
      current = (await markStepCompleted(current, step, 'mock'))!;
    }

    return { organization, session: current };
  }

  it('reports every checklist item satisfied for a fully-provisioned organization', async () => {
    const { validateLaunchReadiness } = await import('./organizationProvisioningService');
    const { organization, session } = await fullyProvisionedOrg();
    const { ready, checklist } = await validateLaunchReadiness(organization.id, session, 'mock');
    expect(ready).toBe(true);
    expect(checklist.every((c) => c.satisfied)).toBe(true);
  });

  it('rejects completion when a required step is missing (e.g. no primary location)', async () => {
    const { startOnboarding, completeOnboarding } = await import('./organizationProvisioningService');
    const { organization, session } = await startOnboarding(
      {
        idempotencyKey: idFactory(),
        legalName: 'Incomplete Org LLC',
        displayName: 'Incomplete Org',
        primaryEmail: 'staff@incomplete.test',
        primaryPhone: '(555) 000-4444',
        timezone: 'America/Chicago',
        defaultCurrency: 'usd',
        actorUserId: 'platform-admin-1',
        idFactory,
      },
      'mock',
    );
    const result = await completeOnboarding(session.id, 'platform-admin-1', idFactory, 'mock');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.checklist.some((c) => !c.satisfied)).toBe(true);
    }
    const stillOnboarding = await (await import('./organizationProvisioningService')).getOrganization(organization.id, 'mock');
    expect(stillOnboarding?.status).toBe('onboarding'); // never activated
  });

  it('activates the organization once fully provisioned and reviewed', async () => {
    const { completeOnboarding } = await import('./organizationProvisioningService');
    const { organization, session } = await fullyProvisionedOrg();
    const result = await completeOnboarding(session.id, 'platform-admin-1', idFactory, 'mock');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.organization.status).toBe('active');
      expect(result.organization.isActive).toBe(true);
      expect(result.session.status).toBe('completed');
      expect(result.session.completedAt).not.toBeNull();
    }
    void organization;
  });

  it('is idempotent — completing an already-completed session is a harmless no-op', async () => {
    const { completeOnboarding } = await import('./organizationProvisioningService');
    const { session } = await fullyProvisionedOrg();
    const first = await completeOnboarding(session.id, 'platform-admin-1', idFactory, 'mock');
    const second = await completeOnboarding(session.id, 'platform-admin-1', idFactory, 'mock');
    expect(first.success && second.success).toBe(true);
    if (first.success && second.success) {
      expect(second.organization.id).toBe(first.organization.id);
      expect(second.session.completedAt).toBe(first.session.completedAt);
    }
  });

  it('records an onboarding_completed audit entry only once, even across repeated completion calls', async () => {
    const { completeOnboarding, listOnboardingAudit } = await import('./organizationProvisioningService');
    const { organization, session } = await fullyProvisionedOrg();
    await completeOnboarding(session.id, 'platform-admin-1', idFactory, 'mock');
    await completeOnboarding(session.id, 'platform-admin-1', idFactory, 'mock');
    const audit = await listOnboardingAudit(organization.id, 'mock');
    expect(audit.filter((e) => e.action === 'onboarding_completed')).toHaveLength(1);
  });
});

describe('markStepCompleted', () => {
  it('advances currentStep to the next step and adds to completedSteps', async () => {
    const { startOnboarding, markStepCompleted } = await import('./organizationProvisioningService');
    const { session } = await startOnboarding(
      {
        idempotencyKey: idFactory(),
        legalName: 'Step Org LLC',
        displayName: 'Step Org',
        primaryEmail: 'staff@steporg.test',
        primaryPhone: '(555) 000-5555',
        timezone: 'America/Chicago',
        defaultCurrency: 'usd',
        actorUserId: 'platform-admin-1',
        idFactory,
      },
      'mock',
    );
    const updated = await markStepCompleted(session, 'organization_profile', 'mock');
    expect(updated?.completedSteps).toEqual(['organization_profile']);
    expect(updated?.currentStep).toBe('primary_location');
  });

  it('never loses previously completed steps when revisiting an earlier one (backward navigation)', async () => {
    const { startOnboarding, markStepCompleted } = await import('./organizationProvisioningService');
    const { session } = await startOnboarding(
      {
        idempotencyKey: idFactory(),
        legalName: 'Backnav Org LLC',
        displayName: 'Backnav Org',
        primaryEmail: 'staff@backnav.test',
        primaryPhone: '(555) 000-6666',
        timezone: 'America/Chicago',
        defaultCurrency: 'usd',
        actorUserId: 'platform-admin-1',
        idFactory,
      },
      'mock',
    );
    let current = (await markStepCompleted(session, 'organization_profile', 'mock'))!;
    current = (await markStepCompleted(current, 'primary_location', 'mock'))!;
    // Revisit and re-save the first step — its own completion is idempotent.
    current = (await markStepCompleted(current, 'organization_profile', 'mock'))!;
    expect(current.completedSteps).toEqual(['organization_profile', 'primary_location']);
  });
});

describe('RBAC provisioning integration (security-correction round, 2026-07-29)', () => {
  function startInput(overrides: Record<string, unknown> = {}) {
    return {
      idempotencyKey: idFactory(),
      legalName: 'RBAC Test Org, LLC',
      displayName: `RBAC Test Org ${idFactory()}`,
      primaryEmail: 'staff@rbactest.test',
      primaryPhone: '(555) 000-9999',
      timezone: 'America/Chicago',
      defaultCurrency: 'usd',
      actorUserId: 'platform-admin-1',
      idFactory,
      ...overrides,
    };
  }

  it('a newly provisioned organization automatically receives all seven default roles', async () => {
    const { startOnboarding } = await import('./organizationProvisioningService');
    const { listRolesForOrganization } = await import('./roleService');

    const { organization } = await startOnboarding(startInput(), 'mock');
    const roles = await listRolesForOrganization(organization.id, 'mock');

    expect(roles).toHaveLength(7);
    expect(roles.map((r) => r.key).sort()).toEqual(['accounting', 'administrator', 'arranger', 'funeralDirector', 'manager', 'officeStaff', 'readOnly']);
  });

  it("the initial administrator's role resolves to the expected full permission set", async () => {
    const { startOnboarding, assignInitialAdministrator } = await import('./organizationProvisioningService');
    const { resolvePermissionKeysForRole } = await import('./permissionService');

    const { organization } = await startOnboarding(startInput(), 'mock');
    await assignInitialAdministrator(organization.id, 'new-owner-user', idFactory, 'mock');

    const permissions = await resolvePermissionKeysForRole('administrator', organization.id, 'mock');
    expect(permissions.size).toBe(28); // Phase 25: 24 + document.upload + document.archive + document.template.read + document.template.manage
    expect(permissions.has('organization.manage')).toBe(true);
  });

  it('assignInitialAdministrator refuses if the administrator role is not yet resolvable for the organization', async () => {
    const { assignInitialAdministrator } = await import('./organizationProvisioningService');
    // An organization that never went through startOnboarding (so its RBAC
    // roster was never seeded) and has no platform-default roles seeded
    // globally either — simulate by clearing every role fixture entirely.
    const savedRoles = [...roleFixtures];
    const savedRolePermissions = [...rolePermissionFixtures];
    roleFixtures.length = 0;
    rolePermissionFixtures.length = 0;
    try {
      await expect(assignInitialAdministrator('org-with-no-rbac-seed', 'someone', idFactory, 'mock')).rejects.toThrow(/not yet resolvable/);
    } finally {
      roleFixtures.push(...savedRoles);
      rolePermissionFixtures.push(...savedRolePermissions);
    }
  });

  it('repeated provisioning (retrying startOnboarding for the same organization) creates no duplicate RBAC records', async () => {
    const { startOnboarding } = await import('./organizationProvisioningService');
    const { listOrganizationRoleEnablements } = await import('./roleService');

    const input = startInput();
    const { organization: first } = await startOnboarding(input, 'mock');
    const beforeRoles = roleFixtures.length;
    const beforeGrants = rolePermissionFixtures.length;

    const { organization: second, isNew } = await startOnboarding(input, 'mock');
    expect(isNew).toBe(false);
    expect(second.id).toBe(first.id);

    const enablements = await listOrganizationRoleEnablements(first.id, 'mock');
    expect(enablements).toHaveLength(7);
    expect(roleFixtures.length).toBe(beforeRoles);
    expect(rolePermissionFixtures.length).toBe(beforeGrants);
  });

  it('retry after a simulated partial failure (organization/session created, RBAC seeding not yet completed) finishes seeding successfully', async () => {
    const { startOnboarding } = await import('./organizationProvisioningService');
    const { listOrganizationRoleEnablements } = await import('./roleService');

    const input = startInput();
    const { organization } = await startOnboarding(input, 'mock');

    // Simulate "the process crashed after creating the organization/session
    // but before RBAC seeding completed" by removing this organization's
    // enablement roster after the fact — the organization and session rows
    // themselves remain, exactly as a real partial failure would leave them.
    for (let i = organizationRoleFixtures.length - 1; i >= 0; i--) {
      if (organizationRoleFixtures[i].organizationId === organization.id) organizationRoleFixtures.splice(i, 1);
    }
    expect(await listOrganizationRoleEnablements(organization.id, 'mock')).toHaveLength(0);

    // Retry: startOnboarding is called again with the same idempotencyKey,
    // exactly as a client retrying a failed request would.
    const { organization: retried, isNew } = await startOnboarding(input, 'mock');
    expect(isNew).toBe(false);
    expect(retried.id).toBe(organization.id);

    const enablements = await listOrganizationRoleEnablements(organization.id, 'mock');
    expect(enablements).toHaveLength(7);
  });

  it("existing custom roles and role assignments are preserved across repeated provisioning calls for the same organization", async () => {
    const { startOnboarding, assignInitialAdministrator } = await import('./organizationProvisioningService');
    const { createCustomRole, listRolesForOrganization } = await import('./roleService');

    const input = startInput();
    const { organization } = await startOnboarding(input, 'mock');
    await assignInitialAdministrator(organization.id, 'the-owner', idFactory, 'mock');

    const custom = await createCustomRole(
      { organizationId: organization.id, name: 'Night Shift', description: 'After hours', permissions: ['case.read'], actorIdentityId: 'the-owner', idFactory },
      'mock',
    );

    // Re-run provisioning for the same organization (idempotent retry).
    await startOnboarding(input, 'mock');

    const roles = await listRolesForOrganization(organization.id, 'mock');
    expect(roles).toHaveLength(8); // 7 defaults + the custom role, untouched
    expect(roles.some((r) => r.id === custom.id)).toBe(true);

    const adminMembership = mockMembershipFixtures.find((m) => m.organizationId === organization.id && m.userId === 'the-owner');
    expect(adminMembership?.role).toBe('administrator');
  });

  it("one organization's provisioning does not affect another organization's RBAC roster", async () => {
    const { startOnboarding } = await import('./organizationProvisioningService');
    const { listRolesForOrganization, createCustomRole } = await import('./roleService');

    const { organization: orgA } = await startOnboarding(startInput(), 'mock');
    const { organization: orgB } = await startOnboarding(startInput(), 'mock');

    await createCustomRole({ organizationId: orgA.id, name: 'Org A Only', description: '', permissions: ['case.read'], actorIdentityId: 'actor', idFactory }, 'mock');

    const rolesForA = await listRolesForOrganization(orgA.id, 'mock');
    const rolesForB = await listRolesForOrganization(orgB.id, 'mock');

    expect(rolesForA).toHaveLength(8);
    expect(rolesForB).toHaveLength(7);
    expect(rolesForB.some((r) => r.name === 'Org A Only')).toBe(false);
  });

  it("migrateExistingOrganization also seeds the RBAC roster for a pre-existing tenant", async () => {
    const { migrateExistingOrganization } = await import('./organizationProvisioningService');
    const { listRolesForOrganization } = await import('./roleService');

    const orgId = `migrated-org-${idFactory()}`;
    await migrateExistingOrganization(
      {
        organizationId: orgId,
        legalName: 'Migrated Org LLC',
        displayName: 'Migrated Org',
        primaryEmail: 'staff@migrated.test',
        primaryPhone: '(555) 000-8888',
        timezone: 'America/Chicago',
        defaultCurrency: 'usd',
        actorUserId: 'platform-admin-1',
        primaryLocation: { name: 'Main', addressLine1: '1 Main St', city: 'Chicago', state: 'IL', postalCode: '60601', country: 'US', phone: '(555) 000-8888' },
      },
      idFactory,
      'mock',
    );

    const roles = await listRolesForOrganization(orgId, 'mock');
    expect(roles).toHaveLength(7);
  });
});
