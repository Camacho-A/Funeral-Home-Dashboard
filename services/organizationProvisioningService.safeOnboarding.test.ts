import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Safe organization onboarding (2026-10). Runs the REAL onboarding service
 * code in `'wix'` mode against an in-memory fake of the Wix Data layer
 * (lib/wixDataApi.ts) pre-populated with Manors' live-shaped rows, then
 * proves:
 * - every pre-existing Manors row is byte-identical afterwards, and no
 *   shared/global RBAC row (`roles`, `rolePermissions`, `permissions`) was
 *   inserted, updated or deleted;
 * - Gus still gets every code-defined default grant the shared rows lack,
 *   through org-scoped override rows only;
 * - the first administrator is written in the identity format and resolves
 *   through the identity login path;
 * - chosen-id validation, duplicate rejection, allowlist enforcement and
 *   idempotent retry.
 * No network: the fake replaces every Wix call.
 */

type Row = Record<string, unknown>;
type Op = { op: 'insert' | 'update' | 'delete'; collection: string; id: string };

const fake = vi.hoisted(() => {
  const store = new Map<string, Map<string, Row>>();
  const ops: Op[] = [];
  /** Unique indexes the live collections really have (beyond `_id`). */
  const uniqueFields: Record<string, string[]> = {
    onboardingSessions: ['idempotencyKey'],
    organizations: ['beaconOrganizationId'],
  };
  let autoId = 0;
  return { store, ops, uniqueFields, nextId: () => `auto-${++autoId}` };
});

vi.mock('../lib/wixDataApi', () => {
  class WixDataApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.name = 'WixDataApiError';
      this.status = status;
    }
  }

  const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
  const collection = (name: string) => {
    let c = fake.store.get(name);
    if (!c) {
      c = new Map();
      fake.store.set(name, c);
    }
    return c;
  };

  function matchesCondition(value: unknown, condition: unknown): boolean {
    if (condition !== null && typeof condition === 'object' && !Array.isArray(condition)) {
      return Object.entries(condition as Record<string, unknown>).every(([op, operand]) => {
        switch (op) {
          case '$eq':
            return operand === null ? value === null || value === undefined : value === operand;
          case '$ne':
            return value !== operand;
          case '$in':
            return (operand as unknown[]).includes(value);
          case '$hasSome':
            return Array.isArray(value) && value.some((v) => (operand as unknown[]).includes(v));
          case '$exists':
            return (value !== undefined) === operand;
          default:
            throw new Error(`fake wixDataApi: unsupported operator ${op}`);
        }
      });
    }
    return value === condition;
  }

  function matches(data: Row, filter: Record<string, unknown> | undefined): boolean {
    if (!filter) return true;
    return Object.entries(filter).every(([key, condition]) => {
      if (key === '$and') return (condition as Record<string, unknown>[]).every((f) => matches(data, f));
      if (key === '$or') return (condition as Record<string, unknown>[]).some((f) => matches(data, f));
      return matchesCondition(data[key], condition);
    });
  }

  async function queryWixDataItems(
    dataCollectionId: string,
    query: { filter?: Record<string, unknown>; paging?: { limit?: number; cursor?: string; offset?: number } } = {},
  ) {
    const all = [...collection(dataCollectionId).entries()].filter(([, data]) => matches(data, query.filter));
    const offset = query.paging?.cursor ? Number(query.paging.cursor) : query.paging?.offset ?? 0;
    const limit = query.paging?.limit ?? 50; // Wix's silent default cap
    const page = all.slice(offset, offset + limit);
    const hasNext = offset + limit < all.length;
    return {
      dataItems: page.map(([id, data]) => ({ id, dataCollectionId, data: { ...clone(data), _id: id } })),
      pagingMetadata: { hasNext, cursors: { next: hasNext ? String(offset + limit) : null } },
    };
  }

  async function queryAllWixDataItems(dataCollectionId: string, filter?: Record<string, unknown>) {
    const out: Array<{ id: string; dataCollectionId: string; data: Row }> = [];
    let cursor: string | undefined;
    for (;;) {
      const response = await queryWixDataItems(dataCollectionId, { filter, paging: cursor ? { cursor } : { limit: 100 } });
      out.push(...response.dataItems);
      if (!response.pagingMetadata.hasNext) return out;
      cursor = response.pagingMetadata.cursors.next ?? undefined;
    }
  }

  async function insertWixDataItem(dataCollectionId: string, data: Row, itemId?: string) {
    const c = collection(dataCollectionId);
    const id = itemId ?? fake.nextId();
    if (c.has(id)) throw new WixDataApiError(`duplicate _id ${id} in ${dataCollectionId}`, 409);
    for (const field of fake.uniqueFields[dataCollectionId] ?? []) {
      if (data[field] !== undefined && [...c.values()].some((existing) => existing[field] === data[field])) {
        throw new WixDataApiError(`unique index ${dataCollectionId}.${field}`, 409);
      }
    }
    c.set(id, clone(data));
    fake.ops.push({ op: 'insert', collection: dataCollectionId, id });
    return { id, dataCollectionId, data: { ...clone(data), _id: id } };
  }

  async function updateWixDataItem(dataCollectionId: string, itemId: string, data: Row) {
    const c = collection(dataCollectionId);
    if (!c.has(itemId)) throw new WixDataApiError(`not found ${itemId}`, 404);
    const rest = { ...data };
    delete rest._id;
    c.set(itemId, clone(rest));
    fake.ops.push({ op: 'update', collection: dataCollectionId, id: itemId });
    return { id: itemId, dataCollectionId, data: { ...clone(rest), _id: itemId } };
  }

  async function deleteWixDataItem(dataCollectionId: string, itemId: string) {
    collection(dataCollectionId).delete(itemId);
    fake.ops.push({ op: 'delete', collection: dataCollectionId, id: itemId });
  }

  async function countWixDataItems(dataCollectionId: string, filter?: Record<string, unknown>) {
    return [...collection(dataCollectionId).values()].filter((d) => matches(d, filter)).length;
  }

  const unsupported = (name: string) => async () => {
    throw new Error(`fake wixDataApi: ${name} not expected during onboarding`);
  };

  return {
    WixDataApiError,
    queryWixDataItems,
    queryAllWixDataItems,
    insertWixDataItem,
    updateWixDataItem,
    deleteWixDataItem,
    countWixDataItems,
    conditionalPatchWixDataItem: unsupported('conditionalPatchWixDataItem'),
    incrementWixDataField: unsupported('incrementWixDataField'),
  };
});

const provisioning = await import('./organizationProvisioningService');
const {
  startOnboarding,
  createPrimaryLocation,
  assignInitialAdministrator,
  provisionWorkflow,
  seedServiceCatalog,
  createPaymentIntegrationPlaceholder,
  saveBranding,
  markStepCompleted,
  completeOnboarding,
  OnboardingStartError,
  OnboardingAdministratorError,
} = provisioning;
const { resolvePermissions } = await import('./permissionService');
const { listMembershipsForIdentity, isActiveMembership } = await import('./membershipService');
const { createCustomRole, seedPlatformDefaultRoles, seedManorsCaseNumberManagePermission } = await import('./roleService');
const { runDefaultRoleReconciliation, GlobalRbacMutationRefusedError } = await import('./rbacReconciliationService');
const { resolveMembershipAuthorizationContext } = await import('../lib/auth/resolveMembershipAuthorizationContext');
const { DEFAULT_ROLE_DEFINITIONS } = await import('../domain/rbac/defaultRoles');
const ids = await import('../domain/rbac/deterministicIds');
const { buildWixOrganizationData } = await import('../lib/wixOrganizationMapper');
const { buildWixRoleData } = await import('../lib/wixRoleMapper');
const { buildWixRolePermissionData } = await import('../lib/wixRolePermissionMapper');
const { buildWixOrganizationRoleData } = await import('../lib/wixOrganizationRoleMapper');
const { buildWixMembershipData } = await import('../lib/wixMembershipMapper');
const { buildWixIdentityData } = await import('../lib/wixIdentityMapper');
const { buildWixWorkflowTemplateData, buildWixWorkflowTemplateVersionData } = await import('../lib/wixWorkflowTemplateMapper');
const { buildWixServiceCatalogData } = await import('../lib/wixServiceCatalogMapper');
const { buildWixOnboardingSessionData } = await import('../lib/wixOnboardingSessionMapper');
const { buildWixOrganizationLocationData } = await import('../lib/wixOrganizationLocationMapper');
const { buildWixOrganizationRolePermissionOverrideData } = await import('../lib/wixOrganizationRolePermissionOverrideMapper');
const { STARTER_WORKFLOW } = await import('../domain/onboarding/starterWorkflow');

const MANORS = 'managed-cremations';
const GUS = 'gus-camacho-jr';
const OTHER_EXISTING = 'evergreen-memorial-group';
const T0 = '2025-01-01T00:00:00.000Z';
const MANORS_ADMIN_IDENTITY = 'identity-manors-admin';
const GUS_ADMIN_IDENTITY = 'identity-gus-admin';
const PLATFORM_ADMIN = 'platform-admin-1';

/** The live gap the Manors migration exists for: code grants these, the
    shared rows don't (yet). */
const LIVE_GAP = [
  { roleKey: 'administrator', permissionKey: 'caseNumber.manage' },
  { roleKey: 'funeralDirector', permissionKey: 'caseNumber.manage' },
] as const;

function put(collectionName: string, id: string, data: Row) {
  let c = fake.store.get(collectionName);
  if (!c) {
    c = new Map();
    fake.store.set(collectionName, c);
  }
  c.set(id, JSON.parse(JSON.stringify(data)));
}

function identityRow(id: string, email: string, displayName: string) {
  return buildWixIdentityData(
    { id, email, normalizedEmail: email, displayName, phone: null, status: 'active', emailVerified: true, passwordVersion: 1, mfaEnabled: false, lastLoginAt: null, createdAt: T0, updatedAt: T0 },
    { passwordHash: 'hash', mfaSecretReference: null, mfaVerifiedAt: null, mfaRecoveryCodeHashes: [] },
  ) as unknown as Row;
}

function seedSharedBackend() {
  fake.store.clear();
  fake.ops.length = 0;

  // Organizations
  put('organizations', MANORS, buildWixOrganizationData({
    id: MANORS, name: "Manor's Cremation", isActive: true, legalName: "Manor's Cremation LLC", slug: 'manors-cremation', status: 'active',
    timezone: 'America/Chicago', defaultCurrency: 'usd', primaryEmail: 'office@manors.test', primaryPhone: '555-0100', website: null, createdAt: T0, updatedAt: T0,
  }) as unknown as Row);
  put('organizations', OTHER_EXISTING, buildWixOrganizationData({
    id: OTHER_EXISTING, name: 'Evergreen', isActive: true, legalName: 'Evergreen LLC', slug: 'evergreen', status: 'active',
    timezone: 'America/Chicago', defaultCurrency: 'usd', primaryEmail: 'e@e.test', primaryPhone: '555-0101', website: null, createdAt: T0, updatedAt: T0,
  }) as unknown as Row);

  // Shared (global) default roles + their grants, minus the live gap.
  for (const def of DEFAULT_ROLE_DEFINITIONS) {
    const roleId = ids.defaultRoleFixtureId(def.key);
    put('roles', roleId, buildWixRoleData({ id: roleId, key: def.key, name: def.name, description: def.description, organizationId: null, isSystemDefault: true, createdAt: T0, updatedAt: T0 }) as unknown as Row);
    for (const permissionKey of def.permissions) {
      if (LIVE_GAP.some((g) => g.roleKey === def.key && g.permissionKey === permissionKey)) continue;
      const grantId = ids.defaultRolePermissionFixtureId(def.key, permissionKey);
      put('rolePermissions', grantId, buildWixRolePermissionData({ id: grantId, roleId, permissionKey, createdAt: T0 }) as unknown as Row);
    }
    // Manors' curated roster: everything but Arranger.
    if (def.key !== 'arranger') {
      const enablementId = ids.organizationRoleFixtureId(MANORS, def.key);
      put('organizationRoles', enablementId, buildWixOrganizationRoleData({ id: enablementId, organizationId: MANORS, roleId, createdAt: T0 }) as unknown as Row);
    }
  }
  // A Manors org-scoped override.
  const manorsOverrideId = ids.organizationRolePermissionOverrideId(MANORS, 'officeStaff', 'payment.refund');
  put('organizationRolePermissionOverrides', manorsOverrideId, buildWixOrganizationRolePermissionOverrideData({
    id: manorsOverrideId, organizationId: MANORS, roleKey: 'officeStaff', permissionKey: 'payment.refund', action: 'revoke', reason: 'Manors policy', createdAt: T0, createdBy: MANORS_ADMIN_IDENTITY, updatedAt: T0,
  }) as unknown as Row);

  // Identities + memberships (identity format and a legacy row).
  put('identities', MANORS_ADMIN_IDENTITY, identityRow(MANORS_ADMIN_IDENTITY, 'admin@manors.test', 'Manors Admin'));
  put('identities', GUS_ADMIN_IDENTITY, identityRow(GUS_ADMIN_IDENTITY, 'admin@gus.test', 'Gus Admin'));
  put('organizationMemberships', 'membership-manors-admin', {
    ...(buildWixMembershipData({ id: 'membership-manors-admin', identityId: MANORS_ADMIN_IDENTITY, organizationId: MANORS, role: 'administrator', status: 'active', invitedBy: null, joinedAt: T0, createdAt: T0, updatedAt: T0 }) as unknown as Row),
  });
  put('organizationMemberships', 'legacy-manors-staff', { beaconMembershipId: 'legacy-manors-staff', organizationId: MANORS, userId: 'wix-user-1', identitySource: 'wix', role: 'staff', isActive: true });

  // Workflow, catalog, location, onboarding record, payments, case sequence.
  put('workflowTemplates', 'manors-template', buildWixWorkflowTemplateData({ id: 'manors-template', organizationId: MANORS, name: 'Manors Cremation', isEnabled: true, caseTypes: STARTER_WORKFLOW.caseTypes }) as unknown as Row);
  put('workflowTemplateVersions', 'manors-template-v1', buildWixWorkflowTemplateVersionData({ beaconTemplateId: 'manors-template', version: 1, caseTypes: STARTER_WORKFLOW.caseTypes, stages: STARTER_WORKFLOW.stages, intake: STARTER_WORKFLOW.intake, createdAt: T0 }) as unknown as Row);
  put('serviceCatalog', 'manors-svc-1', buildWixServiceCatalogData({ id: 'manors-svc-1', organizationId: MANORS, serviceCode: 'DC', displayName: 'Direct Cremation', category: 'service', pricingType: 'fixed', defaultPrice: 99500, isActive: true, sortOrder: 1, createdAt: T0, updatedAt: T0 } as never) as unknown as Row);
  put('organizationLocations', 'manors-loc', buildWixOrganizationLocationData({ id: 'manors-loc', organizationId: MANORS, name: 'Main', locationType: 'office', addressLine1: '1 Main', addressLine2: null, city: 'X', state: 'TX', postalCode: '00000', country: 'US', phone: '555', email: null, isPrimary: true, isActive: true, createdAt: T0, updatedAt: T0 }) as unknown as Row);
  put('onboardingSessions', 'manors-onboarding', { ...(buildWixOnboardingSessionData({ id: 'manors-onboarding', organizationId: MANORS, status: 'completed', currentStep: 'review_launch', completedSteps: [], startedByUserId: MANORS_ADMIN_IDENTITY, startedAt: T0, completedAt: T0, lastSavedAt: T0, version: 1, createdAt: T0, updatedAt: T0 }) as unknown as Row), idempotencyKey: 'manors-migration' });
  put('paymentIntegrations', `${MANORS}-clover`, { beaconIntegrationId: `${MANORS}-clover`, organizationId: MANORS, provider: 'clover', environment: 'production', isEnabled: true });
  put('caseSequences', `${MANORS}-2026`, { organizationId: MANORS, prefix: 'B', year: 2026, nextValue: 42 });
}

function snapshot(): Map<string, string> {
  const out = new Map<string, string>();
  for (const [collectionName, rows] of fake.store) {
    for (const [id, data] of rows) out.set(`${collectionName}/${id}`, JSON.stringify(data));
  }
  return out;
}

function currentRow(key: string): string | undefined {
  const [collectionName, ...rest] = key.split('/');
  const row = fake.store.get(collectionName)?.get(rest.join('/'));
  return row === undefined ? undefined : JSON.stringify(row);
}

let counter = 0;
const idFactory = () => `gus-id-${++counter}`;

const GUS_PROFILE = {
  legalName: 'Gus Camacho Jr. Funeral Home',
  displayName: 'Gus Camacho Jr. Funeral Home',
  primaryEmail: 'placeholder@gus.test',
  primaryPhone: 'To be configured',
  timezone: 'America/Chicago',
  defaultCurrency: 'usd',
  actorUserId: PLATFORM_ADMIN,
};

let priorAllowlist: string | undefined;
beforeEach(() => {
  counter = 0;
  priorAllowlist = process.env.DEPLOYMENT_ORGANIZATION_IDS;
  delete process.env.DEPLOYMENT_ORGANIZATION_IDS;
  seedSharedBackend();
});
afterEach(() => {
  if (priorAllowlist === undefined) delete process.env.DEPLOYMENT_ORGANIZATION_IDS;
  else process.env.DEPLOYMENT_ORGANIZATION_IDS = priorAllowlist;
});

async function runFullGusOnboarding() {
  const { organization, session } = await startOnboarding({ ...GUS_PROFILE, idempotencyKey: 'gus-start-1', idFactory, organizationId: GUS }, 'wix');
  await createPrimaryLocation(GUS, { name: 'Main', addressLine1: 'To be configured', city: 'To be configured', state: 'TX', postalCode: '00000', country: 'US', phone: 'To be configured' }, idFactory, 'wix');
  const admin = await assignInitialAdministrator(GUS, GUS_ADMIN_IDENTITY, idFactory, 'wix', { invitedByIdentityId: PLATFORM_ADMIN });
  await provisionWorkflow(GUS, { mode: 'starter' }, idFactory, 'wix');
  await seedServiceCatalog(GUS, idFactory, 'wix');
  await createPaymentIntegrationPlaceholder(GUS, 'configure_later', undefined, 'wix');
  await saveBranding(GUS, { primaryColor: '#123456' }, 'wix');
  let s = await markStepCompleted(session, 'payments', 'wix');
  s = await markStepCompleted(s!, 'branding', 'wix');
  const completed = await completeOnboarding(s!.id, PLATFORM_ADMIN, idFactory, 'wix');
  return { organization, session, admin, completed };
}

describe('full onboarding of gus-camacho-jr against a shared backend holding Manors', () => {
  it('leaves every pre-existing row byte-identical and never writes a shared RBAC row', async () => {
    const before = snapshot();
    const { organization, completed } = await runFullGusOnboarding();

    expect(organization.id).toBe(GUS);
    expect(completed.success).toBe(true);
    if (completed.success) expect(completed.organization.status).toBe('active');

    for (const [key, value] of before) {
      expect(currentRow(key), key).toBe(value);
    }
    const preExisting = new Set(before.keys());
    const touchedPreExisting = fake.ops.filter((o) => o.op !== 'insert' && preExisting.has(`${o.collection}/${o.id}`));
    expect(touchedPreExisting).toEqual([]);
    const sharedWrites = fake.ops.filter((o) => ['roles', 'rolePermissions', 'permissions'].includes(o.collection));
    expect(sharedWrites).toEqual([]);
    // Every write that happened is Gus-scoped.
    for (const op of fake.ops) {
      const row = fake.store.get(op.collection)?.get(op.id);
      if (row && 'organizationId' in row) expect(row.organizationId, `${op.collection}/${op.id}`).toBe(GUS);
    }
  });

  it("gives Gus the code-defined grants the shared rows lack via org-scoped overrides — Manors' effective permissions are unchanged", async () => {
    const manorsAdminBefore = await resolvePermissions({ identityId: MANORS_ADMIN_IDENTITY, organizationId: MANORS, roleKey: 'administrator' }, 'wix');
    const manorsFdBefore = await resolvePermissions({ identityId: 'x', organizationId: MANORS, roleKey: 'funeralDirector' }, 'wix');
    await runFullGusOnboarding();

    const manorsAdminAfter = await resolvePermissions({ identityId: MANORS_ADMIN_IDENTITY, organizationId: MANORS, roleKey: 'administrator' }, 'wix');
    const manorsFdAfter = await resolvePermissions({ identityId: 'x', organizationId: MANORS, roleKey: 'funeralDirector' }, 'wix');
    expect([...manorsAdminAfter].sort()).toEqual([...manorsAdminBefore].sort());
    expect([...manorsFdAfter].sort()).toEqual([...manorsFdBefore].sort());
    expect(manorsAdminAfter.has('caseNumber.manage')).toBe(false);

    for (const def of DEFAULT_ROLE_DEFINITIONS) {
      const gus = await resolvePermissions({ identityId: 'x', organizationId: GUS, roleKey: def.key }, 'wix');
      expect([...gus].sort(), def.key).toEqual([...def.permissions].sort());
    }
    const overrides = [...(fake.store.get('organizationRolePermissionOverrides')?.values() ?? [])].filter((o) => o.organizationId === GUS);
    expect(overrides.map((o) => `${o.roleKey}:${o.permissionKey}:${o.action}`).sort()).toEqual(
      LIVE_GAP.map((g) => `${g.roleKey}:${g.permissionKey}:grant`).sort(),
    );
  });

  it('writes the first administrator in the identity format, so identity login resolves gus-camacho-jr', async () => {
    const { admin } = await runFullGusOnboarding();
    expect(admin.isNew).toBe(true);
    expect(admin.membership.role).toBe('administrator');

    const memberships = (await listMembershipsForIdentity(GUS_ADMIN_IDENTITY, 'wix')).filter(isActiveMembership);
    expect(memberships).toHaveLength(1);
    expect(memberships[0]).toMatchObject({ identityId: GUS_ADMIN_IDENTITY, organizationId: GUS, role: 'administrator', status: 'active', invitedBy: PLATFORM_ADMIN });

    const result = await resolveMembershipAuthorizationContext(
      { id: 'session-1', identityId: GUS_ADMIN_IDENTITY, organizationId: null } as never,
      'wix',
      GUS,
    );
    expect(result).toEqual({ granted: true, context: { userId: GUS_ADMIN_IDENTITY, organizationId: GUS, role: 'administrator' } });

    // Legacy readers keep working on the same row.
    const row = [...fake.store.get('organizationMemberships')!.values()].find((m) => m.organizationId === GUS)!;
    expect(row).toMatchObject({ userId: GUS_ADMIN_IDENTITY, isActive: true });
    // Manors' admin can't see Gus and vice versa.
    const manors = (await listMembershipsForIdentity(MANORS_ADMIN_IDENTITY, 'wix')).map((m) => m.organizationId);
    expect(manors).toEqual([MANORS]);
    // Best-effort StaffProfile exists for the new admin.
    expect([...(fake.store.get('staffProfiles')?.values() ?? [])].some((p) => p.organizationId === GUS)).toBe(true);
  });

  it('refuses an unknown administrator identity (invite by email instead) and never writes a membership', async () => {
    await startOnboarding({ ...GUS_PROFILE, idempotencyKey: 'k', idFactory, organizationId: GUS }, 'wix');
    const before = fake.ops.length;
    await expect(assignInitialAdministrator(GUS, 'no-such-identity', idFactory, 'wix')).rejects.toBeInstanceOf(OnboardingAdministratorError);
    expect(fake.ops.slice(before).filter((o) => o.collection === 'organizationMemberships')).toEqual([]);
  });

  it('assignInitialAdministrator is idempotent (one membership row, isNew false on retry)', async () => {
    await startOnboarding({ ...GUS_PROFILE, idempotencyKey: 'k', idFactory, organizationId: GUS }, 'wix');
    await assignInitialAdministrator(GUS, GUS_ADMIN_IDENTITY, idFactory, 'wix');
    const second = await assignInitialAdministrator(GUS, GUS_ADMIN_IDENTITY, idFactory, 'wix');
    expect(second.isNew).toBe(false);
    expect([...fake.store.get('organizationMemberships')!.values()].filter((m) => m.organizationId === GUS)).toHaveLength(1);
  });
});

describe('chosen organization id', () => {
  async function expectStartError(organizationId: unknown, code: string, idempotencyKey = 'k1') {
    const before = snapshot();
    const opsBefore = fake.ops.length;
    const error = await startOnboarding({ ...GUS_PROFILE, idempotencyKey, idFactory, organizationId }, 'wix').catch((e) => e);
    expect(error).toBeInstanceOf(OnboardingStartError);
    expect((error as InstanceType<typeof OnboardingStartError>).code).toBe(code);
    expect(fake.ops.slice(opsBefore)).toEqual([]);
    expect(snapshot()).toEqual(before);
    return error as InstanceType<typeof OnboardingStartError>;
  }

  it('is validated (format) — 400', async () => {
    expect((await expectStartError('Gus_Camacho', 'invalid_organization_id')).status).toBe(400);
    await expectStartError('-gus', 'invalid_organization_id');
    await expectStartError(42, 'invalid_organization_id');
  });

  it('rejects reserved ids, including managed-cremations — 400', async () => {
    await expectStartError('admin', 'reserved_organization_id');
    await expectStartError(MANORS, 'reserved_organization_id');
  });

  it('rejects an id that already exists — 409, never merged', async () => {
    const error = await expectStartError(OTHER_EXISTING, 'organization_exists');
    expect(error.status).toBe(409);
  });

  it('rejects a second onboarding of gus-camacho-jr under a different idempotency key — 409', async () => {
    await startOnboarding({ ...GUS_PROFILE, idempotencyKey: 'first', idFactory, organizationId: GUS }, 'wix');
    await expectStartError(GUS, 'organization_exists', 'second');
  });

  it('defaults to a UUID-style generated id on an unrestricted deployment', async () => {
    const { organization } = await startOnboarding({ ...GUS_PROFILE, idempotencyKey: 'k', idFactory }, 'wix');
    expect(organization.id).toBe('gus-id-1');
  });

  it('uses a deterministic onboarding session id for a chosen id', async () => {
    const { session } = await startOnboarding({ ...GUS_PROFILE, idempotencyKey: 'k', idFactory, organizationId: GUS }, 'wix');
    expect(session.id).toBe(`onboarding-${GUS}`);
  });
});

describe('deployment allowlist', () => {
  it('rejects an organization this deployment does not serve — 403', async () => {
    process.env.DEPLOYMENT_ORGANIZATION_IDS = GUS;
    const error = await startOnboarding({ ...GUS_PROFILE, idempotencyKey: 'k', idFactory, organizationId: 'someone-else' }, 'wix').catch((e) => e);
    expect(error).toBeInstanceOf(OnboardingStartError);
    expect(error.code).toBe('organization_not_allowed_in_deployment');
    expect(error.status).toBe(403);
    expect(fake.ops).toEqual([]);
  });

  it('defaults to the single allowed organization when none is named', async () => {
    process.env.DEPLOYMENT_ORGANIZATION_IDS = GUS;
    const { organization } = await startOnboarding({ ...GUS_PROFILE, idempotencyKey: 'k', idFactory }, 'wix');
    expect(organization.id).toBe(GUS);
  });

  it('requires an explicit id when several organizations are allowed', async () => {
    process.env.DEPLOYMENT_ORGANIZATION_IDS = `${GUS},another-org`;
    const error = await startOnboarding({ ...GUS_PROFILE, idempotencyKey: 'k', idFactory }, 'wix').catch((e) => e);
    expect(error.code).toBe('organization_id_required');
  });

  it('a Gus deployment can never reach Manors: managed-cremations is refused even if allowlisted elsewhere', async () => {
    process.env.DEPLOYMENT_ORGANIZATION_IDS = GUS;
    const error = await startOnboarding({ ...GUS_PROFILE, idempotencyKey: 'manors-migration', idFactory }, 'wix').catch((e) => e);
    // Manors' own (completed) onboarding key resolves to Manors — never resumed from the Gus deployment.
    expect(error).toBeInstanceOf(OnboardingStartError);
    expect(fake.ops).toEqual([]);
  });
});

describe('idempotent retry', () => {
  it('same key + same id resumes the same draft with no new rows', async () => {
    const first = await startOnboarding({ ...GUS_PROFILE, idempotencyKey: 'gus-key', idFactory, organizationId: GUS }, 'wix');
    const after = snapshot();
    const second = await startOnboarding({ ...GUS_PROFILE, idempotencyKey: 'gus-key', idFactory, organizationId: GUS }, 'wix');
    expect(second.isNew).toBe(false);
    expect(second.session.id).toBe(first.session.id);
    expect(second.organization.id).toBe(GUS);
    expect(snapshot()).toEqual(after);
  });

  it('same key + a different id is a conflict', async () => {
    await startOnboarding({ ...GUS_PROFILE, idempotencyKey: 'gus-key', idFactory, organizationId: GUS }, 'wix');
    const error = await startOnboarding({ ...GUS_PROFILE, idempotencyKey: 'gus-key', idFactory, organizationId: 'gus-camacho-two' }, 'wix').catch((e) => e);
    expect(error.code).toBe('idempotency_key_conflict');
    expect(error.status).toBe(409);
  });

  it('heals a draft whose organization write failed, under the same chosen id', async () => {
    await startOnboarding({ ...GUS_PROFILE, idempotencyKey: 'gus-key', idFactory, organizationId: GUS }, 'wix');
    fake.store.get('organizations')!.delete(GUS);
    const resumed = await startOnboarding({ ...GUS_PROFILE, idempotencyKey: 'gus-key', idFactory, organizationId: GUS }, 'wix');
    expect(resumed.organization.id).toBe(GUS);
  });
});

describe('shared RBAC rows', () => {
  it('seedPlatformDefaultRoles is read-only when any default role exists', async () => {
    await seedPlatformDefaultRoles('wix');
    expect(fake.ops).toEqual([]);
  });

  it('seedPlatformDefaultRoles creates the default roles + grants only on a fresh backend', async () => {
    fake.store.clear();
    await seedPlatformDefaultRoles('wix');
    const grants = fake.store.get('rolePermissions')!;
    expect(grants.size).toBe(DEFAULT_ROLE_DEFINITIONS.reduce((n, d) => n + d.permissions.length, 0));
    expect(fake.store.get('roles')!.size).toBe(DEFAULT_ROLE_DEFINITIONS.length);
  });

  it('global reconcile apply is refused on a restricted deployment and writes nothing', async () => {
    process.env.DEPLOYMENT_ORGANIZATION_IDS = GUS;
    await expect(runDefaultRoleReconciliation({ mode: 'apply', idFactory }, 'wix')).rejects.toBeInstanceOf(GlobalRbacMutationRefusedError);
    const dry = await runDefaultRoleReconciliation({ mode: 'dry_run', idFactory }, 'wix');
    expect(dry.summary.requiredChanges).toBeGreaterThan(0);
    expect(fake.ops).toEqual([]);
  });

  it('the Manors-only migration is inert for Gus and on a Gus deployment', async () => {
    await expect(seedManorsCaseNumberManagePermission({ organizationId: GUS, actorIdentityId: 'x' }, 'wix')).rejects.toThrow(/only applies to the Manors organization/);
    process.env.DEPLOYMENT_ORGANIZATION_IDS = GUS;
    await expect(seedManorsCaseNumberManagePermission({ organizationId: MANORS, actorIdentityId: 'x' }, 'wix')).rejects.toThrow(/only applies to the Manors organization/);
    expect(fake.ops).toEqual([]);
  });
});

describe('org-specific roles', () => {
  it('a Gus custom role resolves only inside Gus and writes nothing shared', async () => {
    await startOnboarding({ ...GUS_PROFILE, idempotencyKey: 'k', idFactory, organizationId: GUS }, 'wix');
    const opsBefore = fake.ops.length;
    const role = await createCustomRole(
      { organizationId: GUS, name: 'Gus Arranger', description: 'Gus only', permissions: ['case.read', 'case.create'], actorIdentityId: GUS_ADMIN_IDENTITY, idFactory },
      'wix',
    );
    const gus = await resolvePermissions({ identityId: 'x', organizationId: GUS, roleKey: role.key }, 'wix');
    expect([...gus].sort()).toEqual(['case.create', 'case.read']);
    const manors = await resolvePermissions({ identityId: 'x', organizationId: MANORS, roleKey: role.key }, 'wix');
    expect(manors.size).toBe(0);
    const newOps = fake.ops.slice(opsBefore);
    for (const op of newOps) {
      const row = fake.store.get(op.collection)!.get(op.id)!;
      if (op.collection === 'rolePermissions') expect(row.roleId).toBe(role.id);
      if ('organizationId' in row) expect(row.organizationId).toBe(GUS);
    }
  });
});
