import type { DataAdapterMode } from '../lib/env';
import { queryWixDataItems, insertWixDataItem, updateWixDataItem, WixDataApiError } from '../lib/wixDataApi';
import {
  mapWixOrganizationItem,
  buildWixOrganizationData,
  applyOrganizationUpdateToWixData,
  type WixOrganizationItem,
} from '../lib/wixOrganizationMapper';
import {
  mapWixOrganizationLocationItem,
  buildWixOrganizationLocationData,
  type WixOrganizationLocationItem,
} from '../lib/wixOrganizationLocationMapper';
import {
  mapWixOnboardingSessionItem,
  buildWixOnboardingSessionData,
  applyOnboardingSessionUpdateToWixData,
  type WixOnboardingSessionItem,
} from '../lib/wixOnboardingSessionMapper';
import {
  mapWixOrganizationBrandingItem,
  buildWixOrganizationBrandingData,
  applyOrganizationBrandingUpdateToWixData,
  type WixOrganizationBrandingItem,
} from '../lib/wixOrganizationBrandingMapper';
import {
  mapWixOnboardingAuditItem,
  buildWixOnboardingAuditData,
  type WixOnboardingAuditItem,
} from '../lib/wixOnboardingAuditMapper';
import {
  mapWixWorkflowTemplateItem,
  mapWixWorkflowTemplateVersionItem,
  buildWorkflowTemplate,
  buildWixWorkflowTemplateData,
  buildWixWorkflowTemplateVersionData,
  type WixWorkflowTemplateItem,
  type WixWorkflowTemplateVersionItem,
} from '../lib/wixWorkflowTemplateMapper';
import {
  mapWixServiceCatalogItem,
  buildWixServiceCatalogData,
  type WixServiceCatalogItem,
} from '../lib/wixServiceCatalogMapper';
import { createPaymentIntegration, getIntegration } from './paymentsService';
import type { Organization, OrganizationMembership } from '../types/organization';
import type { OrganizationLocation } from '../types/organizationLocation';
import type { OnboardingSession, OnboardingStepKey } from '../types/onboarding';
import type { OrganizationBranding } from '../types/organizationBranding';
import type { OnboardingAuditEntry } from '../types/onboardingAudit';
import type { WorkflowTemplate, IntakeTemplate } from '../types/workflowTemplate';
import type { ServiceCatalogItem } from '../types/serviceCatalog';
import type { PaymentIntegration } from '../types/payment';
import { normalizeSlugCandidate, isReservedSlug, slugWithSuffix } from '../domain/onboarding/slug';
import { ONBOARDING_STEPS, nextStep as computeNextStep } from '../domain/onboarding/steps';
import {
  buildLaunchChecklist,
  isReadyToLaunch,
  type LaunchReadinessInput,
  type LaunchChecklistItem,
} from '../domain/onboarding/launchReadiness';
import { STARTER_WORKFLOW, MINIMAL_WORKFLOW, type StarterWorkflowContent } from '../domain/onboarding/starterWorkflow';
import { STARTER_SERVICE_CATALOG } from '../domain/onboarding/starterServiceCatalog';
import { mockOrganizationFixtures, mockMembershipFixtures } from './__mocks__/authFixtures';
import { workflowTemplateFixtures } from './__mocks__/workflowTemplates';
import { serviceCatalogFixtures } from './__mocks__/pricingFixtures';
import {
  organizationLocationFixtures,
  onboardingSessionFixtures,
  organizationBrandingFixtures,
  onboardingAuditFixtures,
} from './__mocks__/onboardingFixtures';

/**
 * Phase 20 (Organization Onboarding & Tenant Provisioning). See
 * docs/adr/ADR-024-organization-onboarding-tenant-provisioning.md for the
 * full state model and idempotency strategy. Same organization-scoped,
 * `dataAdapterMode`-branching shape as every other `services/*` module —
 * mock mode mutates the imported fixture arrays in place; wix mode reads/
 * writes the real Wix collections.
 *
 * Idempotency, summarized (see each function's own comment for detail):
 * - `startOnboarding`: atomic insert-and-catch-409 on `onboardingSessions.idempotencyKey`
 *   (the same pattern `paymentRecords.idempotencyKey` already established),
 *   with self-healing reconciliation if a prior attempt's organization
 *   somehow never got created.
 * - `createPrimaryLocation`/`assignInitialAdministrator`/`provisionWorkflow`/
 *   `seedServiceCatalog`: look-up-before-insert, since onboarding provisions
 *   at most one of each per organization and no client-supplied token is
 *   needed to detect a retry — the organization's own existing state *is*
 *   the idempotency key.
 * - `createPaymentIntegrationPlaceholder`: reuses `paymentsService.ts`'s
 *   existing natural-key (`{organizationId}-{provider}`) `_id` convention.
 * - `saveBranding`: a plain upsert keyed by `organizationId` — branding is
 *   editable, not historical, so "idempotent" here just means "safe to
 *   call repeatedly," not "never overwrite."
 */

const WIX_CONFLICT_STATUS = 409;

function isWixConflict(error: unknown): boolean {
  return error instanceof WixDataApiError && error.status === WIX_CONFLICT_STATUS;
}

function nowIso(): string {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// Slug generation
// ---------------------------------------------------------------------------

async function organizationExistsWithSlug(slug: string, dataAdapterMode: DataAdapterMode): Promise<boolean> {
  if (dataAdapterMode === 'mock') {
    return mockOrganizationFixtures.some((o) => o.slug === slug);
  }
  const response = await queryWixDataItems<WixOrganizationItem>('organizations', {
    filter: { slug },
    paging: { limit: 1 },
  });
  return response.dataItems.length > 0;
}

/**
 * Normalizes `candidateBase`, rejects/retries past reserved values, and
 * probes for collisions with a numbered-suffix retry loop
 * (`name`, `name-2`, `name-3`, ...). A real, if narrow, TOCTOU race exists
 * between this check and the eventual organization insert — `organizations`
 * already spends its one allowed unique index on `beaconOrganizationId`
 * (confirmed empirically: Wix Data caps a collection at exactly one unique
 * index, and `organizations` already has one), so a genuine unique-index-
 * backed guarantee isn't available here. This is the same class of
 * accepted limitation already documented for
 * `organizationMemberships(userId, organizationId)` and
 * `workflowTemplateVersions(beaconTemplateId, version)` — see
 * docs/WIX_DATA_SCHEMA.md's "Known limitations."
 */
export async function generateUniqueSlug(candidateBase: string, dataAdapterMode: DataAdapterMode): Promise<string> {
  const base = normalizeSlugCandidate(candidateBase);
  const effectiveBase = isReservedSlug(base) ? `${base}-org` : base;

  let attempt = 1;
  while (attempt < 1000) {
    const candidate = slugWithSuffix(effectiveBase, attempt);
    if (!isReservedSlug(candidate) && !(await organizationExistsWithSlug(candidate, dataAdapterMode))) {
      return candidate;
    }
    attempt += 1;
  }
  throw new Error(`Failed to generate a unique organization slug from "${candidateBase}".`);
}

// ---------------------------------------------------------------------------
// Audit trail
// ---------------------------------------------------------------------------

/**
 * Appends one immutable audit entry. `metadata` must already be display-
 * safe, non-secret key/value data — never a credential value or anything
 * `lib/paymentFieldGuard.ts` would reject; every call site in this file
 * only ever passes values it already knows are safe (a provider name, a
 * template source, a role) — never an arbitrary caller-supplied object.
 */
export async function recordOnboardingAudit(
  params: { organizationId: string; actorUserId: string; action: string; metadata?: Record<string, string> | null },
  idFactory: () => string,
  dataAdapterMode: DataAdapterMode,
): Promise<OnboardingAuditEntry> {
  const entry: OnboardingAuditEntry = {
    id: idFactory(),
    organizationId: params.organizationId,
    actorUserId: params.actorUserId,
    action: params.action,
    metadata: params.metadata ?? null,
    timestamp: nowIso(),
  };

  if (dataAdapterMode === 'mock') {
    onboardingAuditFixtures.push(entry);
    return entry;
  }

  await insertWixDataItem<WixOnboardingAuditItem>('onboardingAuditEntries', buildWixOnboardingAuditData(entry), entry.id);
  return entry;
}

export async function listOnboardingAudit(
  organizationId: string,
  dataAdapterMode: DataAdapterMode,
): Promise<OnboardingAuditEntry[]> {
  if (dataAdapterMode === 'mock') {
    return onboardingAuditFixtures
      .filter((e) => e.organizationId === organizationId)
      .sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
  }
  const response = await queryWixDataItems<WixOnboardingAuditItem>('onboardingAuditEntries', {
    filter: { organizationId },
  });
  return response.dataItems
    .map((item) => mapWixOnboardingAuditItem(item.data))
    .filter((e): e is OnboardingAuditEntry => e !== null)
    .sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
}

// ---------------------------------------------------------------------------
// Organization + onboarding session lookup
// ---------------------------------------------------------------------------

export async function getOrganization(organizationId: string, dataAdapterMode: DataAdapterMode): Promise<Organization | null> {
  if (dataAdapterMode === 'mock') {
    return mockOrganizationFixtures.find((o) => o.id === organizationId) ?? null;
  }
  const response = await queryWixDataItems<WixOrganizationItem>('organizations', {
    filter: { beaconOrganizationId: organizationId },
    paging: { limit: 1 },
  });
  return mapWixOrganizationItem(response.dataItems[0]?.data);
}

export async function getOnboardingSessionById(
  onboardingSessionId: string,
  dataAdapterMode: DataAdapterMode,
): Promise<OnboardingSession | null> {
  if (dataAdapterMode === 'mock') {
    return onboardingSessionFixtures.find((s) => s.id === onboardingSessionId) ?? null;
  }
  const response = await queryWixDataItems<WixOnboardingSessionItem>('onboardingSessions', {
    filter: { beaconOnboardingSessionId: onboardingSessionId },
    paging: { limit: 1 },
  });
  return mapWixOnboardingSessionItem(response.dataItems[0]?.data);
}

async function findOnboardingSessionByIdempotencyKey(
  idempotencyKey: string,
  dataAdapterMode: DataAdapterMode,
): Promise<OnboardingSession | null> {
  if (dataAdapterMode === 'mock') {
    return onboardingSessionFixtures.find((s) => (s as OnboardingSession & { idempotencyKey?: string }).idempotencyKey === idempotencyKey) ?? null;
  }
  const response = await queryWixDataItems<WixOnboardingSessionItem & { idempotencyKey?: unknown }>('onboardingSessions', {
    filter: { idempotencyKey },
    paging: { limit: 1 },
  });
  return mapWixOnboardingSessionItem(response.dataItems[0]?.data);
}

/** Find any non-completed session this user started — the "exit and
    resume" convenience GET /api/onboarding/session falls back to when the
    client doesn't have a sessionId handy. */
export async function findResumableSessionForUser(
  userId: string,
  dataAdapterMode: DataAdapterMode,
): Promise<OnboardingSession | null> {
  if (dataAdapterMode === 'mock') {
    return (
      onboardingSessionFixtures.find((s) => s.startedByUserId === userId && s.status !== 'completed') ?? null
    );
  }
  const response = await queryWixDataItems<WixOnboardingSessionItem>('onboardingSessions', {
    filter: { startedByUserId: userId },
  });
  const sessions = response.dataItems
    .map((item) => mapWixOnboardingSessionItem(item.data))
    .filter((s): s is OnboardingSession => s !== null && s.status !== 'completed');
  return sessions[0] ?? null;
}

// ---------------------------------------------------------------------------
// 1. startOnboarding — creates the OnboardingSession + Organization together
// ---------------------------------------------------------------------------

export type StartOnboardingInput = {
  idempotencyKey: string;
  legalName: string;
  displayName: string;
  primaryEmail: string;
  primaryPhone: string;
  website?: string | null;
  timezone: string;
  defaultCurrency: string;
  actorUserId: string;
  idFactory: () => string;
};

async function persistOrganization(organization: Organization, dataAdapterMode: DataAdapterMode): Promise<Organization> {
  if (dataAdapterMode === 'mock') {
    mockOrganizationFixtures.push(organization);
    return organization;
  }
  const inserted = await insertWixDataItem<WixOrganizationItem>(
    'organizations',
    buildWixOrganizationData(organization),
    organization.id,
  );
  const mapped = mapWixOrganizationItem(inserted.data);
  if (!mapped) throw new Error('Failed to create organization.');
  return mapped;
}

async function persistOnboardingSessionWithIdempotencyKey(
  session: OnboardingSession,
  idempotencyKey: string,
  dataAdapterMode: DataAdapterMode,
): Promise<{ session: OnboardingSession; isNew: boolean }> {
  if (dataAdapterMode === 'mock') {
    const existing = onboardingSessionFixtures.find(
      (s) => (s as OnboardingSession & { idempotencyKey?: string }).idempotencyKey === idempotencyKey,
    );
    if (existing) return { session: existing, isNew: false };
    (session as OnboardingSession & { idempotencyKey?: string }).idempotencyKey = idempotencyKey;
    onboardingSessionFixtures.push(session);
    return { session, isNew: true };
  }

  const data = { ...buildWixOnboardingSessionData(session), idempotencyKey };
  try {
    const inserted = await insertWixDataItem<WixOnboardingSessionItem & { idempotencyKey?: unknown }>(
      'onboardingSessions',
      data,
      session.id,
    );
    const mapped = mapWixOnboardingSessionItem(inserted.data);
    if (!mapped) throw new Error('Failed to create onboarding session.');
    return { session: mapped, isNew: true };
  } catch (error) {
    if (!isWixConflict(error)) throw error;
    const existing = await findOnboardingSessionByIdempotencyKey(idempotencyKey, dataAdapterMode);
    if (!existing) throw error;
    return { session: existing, isNew: false };
  }
}

/**
 * Creates a brand-new organization (status `draft`) and its first
 * `OnboardingSession` (status `in_progress`, step `organization_profile`)
 * together. Idempotent: the session is claimed atomically via a unique
 * index on `idempotencyKey` (the same insert-and-catch-409 pattern
 * `paymentRecords.idempotencyKey` established in Phase 19B) — a retried
 * `/start` call with the same key returns the *same* session and
 * organization rather than creating a second tenant.
 *
 * Self-healing reconciliation: if a prior attempt's session was claimed
 * but its organization somehow was never actually created (a genuine, rare
 * write failure between the two inserts — never rolled back per "use
 * idempotent reconciliation instead of an unsafe cross-collection
 * rollback"), a retry with the same idempotencyKey creates the missing
 * organization now, using the already-fixed organizationId/slug the first
 * attempt reserved.
 */
export async function startOnboarding(
  input: StartOnboardingInput,
  dataAdapterMode: DataAdapterMode,
): Promise<{ organization: Organization; session: OnboardingSession; isNew: boolean }> {
  const organizationId = input.idFactory();
  const now = nowIso();

  const draftSession: OnboardingSession = {
    id: input.idFactory(),
    organizationId,
    status: 'in_progress',
    currentStep: 'organization_profile',
    completedSteps: [],
    startedByUserId: input.actorUserId,
    startedAt: now,
    completedAt: null,
    lastSavedAt: now,
    version: 1,
    createdAt: now,
    updatedAt: now,
  };

  const { session, isNew } = await persistOnboardingSessionWithIdempotencyKey(draftSession, input.idempotencyKey, dataAdapterMode);

  let organization = await getOrganization(session.organizationId, dataAdapterMode);
  if (!organization) {
    // Either genuinely new, or a prior attempt's organization write failed
    // — either way, create it now using the session's own fixed id.
    const slug = await generateUniqueSlug(input.displayName, dataAdapterMode);
    organization = await persistOrganization(
      {
        id: session.organizationId,
        name: input.displayName,
        isActive: false,
        legalName: input.legalName,
        slug,
        status: 'draft',
        timezone: input.timezone,
        defaultCurrency: input.defaultCurrency.toLowerCase(),
        primaryEmail: input.primaryEmail,
        primaryPhone: input.primaryPhone,
        website: input.website ?? null,
        createdAt: now,
        updatedAt: now,
      },
      dataAdapterMode,
    );
    await recordOnboardingAudit(
      { organizationId: session.organizationId, actorUserId: input.actorUserId, action: 'organization_created', metadata: { slug } },
      input.idFactory,
      dataAdapterMode,
    );
  }

  if (isNew && organization.status === 'draft') {
    const flipped = await updateOrganization(session.organizationId, { status: 'onboarding' }, dataAdapterMode);
    if (flipped) organization = flipped;
  }

  return { organization, session, isNew };
}

// ---------------------------------------------------------------------------
// Organization profile update (Step 1) + generic organization update
// ---------------------------------------------------------------------------

export async function updateOrganization(
  organizationId: string,
  patch: Partial<Organization>,
  dataAdapterMode: DataAdapterMode,
): Promise<Organization | null> {
  const nextPatch = { ...patch, updatedAt: nowIso() };

  if (dataAdapterMode === 'mock') {
    const index = mockOrganizationFixtures.findIndex((o) => o.id === organizationId);
    if (index === -1) return null;
    mockOrganizationFixtures[index] = { ...mockOrganizationFixtures[index], ...nextPatch };
    return mockOrganizationFixtures[index];
  }

  const response = await queryWixDataItems<WixOrganizationItem>('organizations', {
    filter: { beaconOrganizationId: organizationId },
    paging: { limit: 1 },
  });
  const existingItem = response.dataItems[0];
  if (!existingItem) return null;
  const merged = applyOrganizationUpdateToWixData(existingItem.data, nextPatch);
  const updated = await updateWixDataItem<WixOrganizationItem>('organizations', existingItem.id, merged);
  return mapWixOrganizationItem(updated.data);
}

// ---------------------------------------------------------------------------
// 2. createPrimaryLocation (Step 2)
// ---------------------------------------------------------------------------

export async function getPrimaryLocation(
  organizationId: string,
  dataAdapterMode: DataAdapterMode,
): Promise<OrganizationLocation | null> {
  if (dataAdapterMode === 'mock') {
    return organizationLocationFixtures.find((l) => l.organizationId === organizationId && l.isPrimary) ?? null;
  }
  const response = await queryWixDataItems<WixOrganizationLocationItem>('organizationLocations', {
    filter: { organizationId, isPrimary: true },
    paging: { limit: 1 },
  });
  return mapWixOrganizationLocationItem(response.dataItems[0]?.data);
}

export type CreatePrimaryLocationInput = {
  name: string;
  locationType?: string;
  addressLine1: string;
  addressLine2?: string | null;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  phone: string;
  email?: string | null;
};

/** Idempotent: an organization has exactly one primary location. A retry
    (or a second call) finds the existing one and returns it unchanged
    rather than creating a duplicate. */
export async function createPrimaryLocation(
  organizationId: string,
  input: CreatePrimaryLocationInput,
  idFactory: () => string,
  dataAdapterMode: DataAdapterMode,
): Promise<{ location: OrganizationLocation; isNew: boolean }> {
  const existing = await getPrimaryLocation(organizationId, dataAdapterMode);
  if (existing) return { location: existing, isNew: false };

  const now = nowIso();
  const location: OrganizationLocation = {
    id: idFactory(),
    organizationId,
    name: input.name,
    locationType: (input.locationType as OrganizationLocation['locationType']) ?? 'office',
    addressLine1: input.addressLine1,
    addressLine2: input.addressLine2 ?? null,
    city: input.city,
    state: input.state,
    postalCode: input.postalCode,
    country: input.country,
    phone: input.phone,
    email: input.email ?? null,
    isPrimary: true,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  };

  if (dataAdapterMode === 'mock') {
    organizationLocationFixtures.push(location);
    return { location, isNew: true };
  }

  const inserted = await insertWixDataItem<WixOrganizationLocationItem>(
    'organizationLocations',
    buildWixOrganizationLocationData(location),
    location.id,
  );
  const mapped = mapWixOrganizationLocationItem(inserted.data);
  if (!mapped) throw new Error('Failed to create primary location.');
  return { location: mapped, isNew: true };
}

// ---------------------------------------------------------------------------
// 3. assignInitialAdministrator (Step 3)
// ---------------------------------------------------------------------------

async function findAdminMembership(
  organizationId: string,
  userId: string,
  dataAdapterMode: DataAdapterMode,
): Promise<OrganizationMembership | null> {
  if (dataAdapterMode === 'mock') {
    return (
      mockMembershipFixtures.find((m) => m.organizationId === organizationId && m.userId === userId && m.isActive) ?? null
    );
  }
  const response = await queryWixDataItems<Record<string, unknown>>('organizationMemberships', {
    filter: { organizationId, userId, isActive: true },
    paging: { limit: 1 },
  });
  const item = response.dataItems[0]?.data;
  if (!item || typeof item.role !== 'string') return null;
  return {
    organizationId,
    userId,
    role: item.role as OrganizationMembership['role'],
    isActive: true,
  };
}

/**
 * Assigns the organization-scoped `administrator` role — never any other
 * role, regardless of what a caller might request, matching "Do not allow
 * the client to assign arbitrary platform-level permissions" (there is no
 * platform-level role this function can grant at all; the only role it
 * ever writes is the literal string `'administrator'`). Idempotent: an
 * existing active membership for this (organizationId, userId) pair is
 * returned unchanged rather than duplicated.
 */
export async function assignInitialAdministrator(
  organizationId: string,
  administratorUserId: string,
  idFactory: () => string,
  dataAdapterMode: DataAdapterMode,
): Promise<{ membership: OrganizationMembership; isNew: boolean }> {
  const existing = await findAdminMembership(organizationId, administratorUserId, dataAdapterMode);
  if (existing) return { membership: existing, isNew: false };

  const membership: OrganizationMembership = {
    organizationId,
    userId: administratorUserId,
    role: 'administrator',
    isActive: true,
  };

  if (dataAdapterMode === 'mock') {
    mockMembershipFixtures.push(membership);
    return { membership, isNew: true };
  }

  const id = idFactory();
  // Phase 20 is the first code path that ever writes to the live
  // `organizationMemberships` collection (Phase 13/14A created it, but
  // application code has only ever read mock fixtures for membership
  // resolution — see lib/auth/authorize.ts's own comment). `identitySource`
  // is derived from `dataAdapterMode` itself as a reasonable simplification
  // (AUTH_ADAPTER/DATA_ADAPTER are typically aligned in practice) since no
  // established convention exists yet for determining it independently.
  await insertWixDataItem(
    'organizationMemberships',
    {
      beaconMembershipId: id,
      organizationId,
      userId: administratorUserId,
      identitySource: 'wix',
      role: 'administrator',
      isActive: true,
    },
    id,
  );
  return { membership, isNew: true };
}

// ---------------------------------------------------------------------------
// 4. provisionWorkflow (Step 4) + 5. provisionIntakeConfiguration (Step 5)
// ---------------------------------------------------------------------------

export async function getOrganizationWorkflow(
  organizationId: string,
  dataAdapterMode: DataAdapterMode,
): Promise<WorkflowTemplate | null> {
  if (dataAdapterMode === 'mock') {
    return workflowTemplateFixtures.find((t) => t.organizationId === organizationId) ?? null;
  }
  const response = await queryWixDataItems<WixWorkflowTemplateItem>('workflowTemplates', {
    filter: { organizationId },
    paging: { limit: 1 },
  });
  const summary = mapWixWorkflowTemplateItem(response.dataItems[0]?.data);
  if (!summary) return null;

  const versionsResponse = await queryWixDataItems<WixWorkflowTemplateVersionItem>('workflowTemplateVersions', {
    filter: { beaconTemplateId: summary.id },
  });
  const versions = versionsResponse.dataItems
    .map((item) => mapWixWorkflowTemplateVersionItem(item.data))
    .filter((v): v is NonNullable<typeof v> => v !== null)
    .sort((a, b) => a.version - b.version);

  return buildWorkflowTemplate(summary, versions);
}

async function fetchSourceTemplateContent(
  sourceTemplateId: string,
  dataAdapterMode: DataAdapterMode,
): Promise<StarterWorkflowContent | null> {
  const source =
    dataAdapterMode === 'mock'
      ? workflowTemplateFixtures.find((t) => t.id === sourceTemplateId) ?? null
      : await (async () => {
          const response = await queryWixDataItems<WixWorkflowTemplateItem>('workflowTemplates', {
            filter: { beaconTemplateId: sourceTemplateId },
            paging: { limit: 1 },
          });
          const summary = mapWixWorkflowTemplateItem(response.dataItems[0]?.data);
          if (!summary) return null;
          const versionsResponse = await queryWixDataItems<WixWorkflowTemplateVersionItem>('workflowTemplateVersions', {
            filter: { beaconTemplateId: summary.id },
          });
          const versions = versionsResponse.dataItems
            .map((item) => mapWixWorkflowTemplateVersionItem(item.data))
            .filter((v): v is NonNullable<typeof v> => v !== null)
            .sort((a, b) => a.version - b.version);
          return buildWorkflowTemplate(summary, versions);
        })();

  if (!source || source.versions.length === 0) return null;
  const latest = source.versions[source.versions.length - 1];
  // Deep clone — "Never share a mutable workflow instance between
  // organizations" means byte-for-byte independent data, not merely a new
  // template row wrapping the *same* stages/intake object graph.
  return structuredClone({ caseTypes: latest.caseTypes, stages: latest.stages, intake: latest.intake });
}

export type ProvisionWorkflowMode = 'starter' | 'clone_existing' | 'minimal';

/**
 * Materializes a brand-new, organization-owned `WorkflowTemplate` +
 * its first `WorkflowTemplateVersion` — never a reference to, or shared
 * row with, any other organization's template ("Never share a mutable
 * workflow instance between organizations"). `'starter'`/`'minimal'` come
 * from plain in-code content (`domain/onboarding/starterWorkflow.ts`);
 * `'clone_existing'` copies another existing template's latest version's
 * `stages`/`intake`/`caseTypes` by value.
 *
 * Idempotent: an organization provisions at most one initial workflow
 * during onboarding — a retry finds the existing one and returns it
 * unchanged.
 */
export async function provisionWorkflow(
  organizationId: string,
  params: { mode: ProvisionWorkflowMode; sourceTemplateId?: string; name?: string },
  idFactory: () => string,
  dataAdapterMode: DataAdapterMode,
): Promise<{ template: WorkflowTemplate; isNew: boolean }> {
  const existing = await getOrganizationWorkflow(organizationId, dataAdapterMode);
  if (existing) return { template: existing, isNew: false };

  let content: StarterWorkflowContent;
  if (params.mode === 'minimal') {
    content = MINIMAL_WORKFLOW;
  } else if (params.mode === 'clone_existing') {
    if (!params.sourceTemplateId) throw new Error('sourceTemplateId is required for clone_existing mode.');
    const cloned = await fetchSourceTemplateContent(params.sourceTemplateId, dataAdapterMode);
    if (!cloned) throw new Error(`Source template "${params.sourceTemplateId}" was not found or has no versions.`);
    content = cloned;
  } else {
    content = STARTER_WORKFLOW;
  }

  const now = nowIso();
  const templateId = idFactory();
  const template: WorkflowTemplate = {
    id: templateId,
    organizationId,
    name: params.name ?? 'Standard Workflow',
    isEnabled: true,
    caseTypes: content.caseTypes,
    versions: [{ version: 1, caseTypes: content.caseTypes, stages: content.stages, intake: content.intake, createdAt: now }],
  };

  if (dataAdapterMode === 'mock') {
    workflowTemplateFixtures.push(template);
    return { template, isNew: true };
  }

  await insertWixDataItem<WixWorkflowTemplateItem>(
    'workflowTemplates',
    buildWixWorkflowTemplateData({ id: templateId, organizationId, name: template.name, isEnabled: true, caseTypes: content.caseTypes }),
    templateId,
  );
  await insertWixDataItem<WixWorkflowTemplateVersionItem>(
    'workflowTemplateVersions',
    buildWixWorkflowTemplateVersionData({
      beaconTemplateId: templateId,
      version: 1,
      caseTypes: content.caseTypes,
      stages: content.stages,
      intake: content.intake,
      createdAt: now,
    }),
    `${templateId}-v1`,
  );

  return { template, isNew: true };
}

const RETIRED_INTAKE_FIELD_TYPES = new Set(['creditCard', 'expiration', 'cvv']);

/**
 * Reads back the organization's own workflow's intake configuration for
 * staff review. Defensive, belt-and-suspenders filtering of any retired
 * payment-card field type — `IntakeFieldType` already structurally
 * excludes these (ADR-021), so this only ever matters for malformed data
 * from a non-TypeScript caller or a cloned source that predates that
 * removal; matches `lib/paymentFieldGuard.ts`'s "cheap and uniform to
 * apply everywhere" philosophy.
 */
export function filterRetiredIntakeFieldTypes(intake: IntakeTemplate): IntakeTemplate {
  return {
    sections: intake.sections.map((section) => ({
      ...section,
      fields: section.fields.filter((field) => !field.fieldType || !RETIRED_INTAKE_FIELD_TYPES.has(field.fieldType)),
    })),
  };
}

export async function provisionIntakeConfiguration(
  organizationId: string,
  dataAdapterMode: DataAdapterMode,
): Promise<IntakeTemplate | null> {
  const template = await getOrganizationWorkflow(organizationId, dataAdapterMode);
  if (!template || template.versions.length === 0) return null;
  const latest = template.versions[template.versions.length - 1];
  return filterRetiredIntakeFieldTypes(latest.intake);
}

// ---------------------------------------------------------------------------
// 6. seedServiceCatalog (Step 6)
// ---------------------------------------------------------------------------

export async function getOrganizationServiceCatalog(
  organizationId: string,
  dataAdapterMode: DataAdapterMode,
): Promise<ServiceCatalogItem[]> {
  if (dataAdapterMode === 'mock') {
    return serviceCatalogFixtures.filter((item) => item.organizationId === organizationId);
  }
  const response = await queryWixDataItems<WixServiceCatalogItem>('serviceCatalog', {
    filter: { organizationId },
  });
  return response.dataItems
    .map((item) => mapWixServiceCatalogItem(item.data))
    .filter((item): item is ServiceCatalogItem => item !== null);
}

/**
 * Seeds a brand-new, organization-owned `serviceCatalog` — never a
 * reference to any other organization's rows ("New tenants must receive
 * their own catalog records. Do not reference Manor's catalog rows from
 * another organization"). Idempotent: an organization is seeded at most
 * once — a retry finds existing rows and returns them unchanged.
 */
export async function seedServiceCatalog(
  organizationId: string,
  idFactory: () => string,
  dataAdapterMode: DataAdapterMode,
): Promise<{ catalog: ServiceCatalogItem[]; isNew: boolean }> {
  const existing = await getOrganizationServiceCatalog(organizationId, dataAdapterMode);
  if (existing.length > 0) return { catalog: existing, isNew: false };

  const now = nowIso();
  const catalog: ServiceCatalogItem[] = STARTER_SERVICE_CATALOG.map((entry) => ({
    id: idFactory(),
    organizationId,
    serviceCode: entry.serviceCode,
    displayName: entry.displayName,
    category: entry.category,
    pricingType: entry.pricingType,
    defaultPrice: entry.defaultPrice,
    isActive: true,
    sortOrder: entry.sortOrder,
    createdAt: now,
    updatedAt: now,
  }));

  if (dataAdapterMode === 'mock') {
    serviceCatalogFixtures.push(...catalog);
    return { catalog, isNew: true };
  }

  for (const item of catalog) {
    await insertWixDataItem<WixServiceCatalogItem>('serviceCatalog', buildWixServiceCatalogData(item), item.id);
  }
  return { catalog, isNew: true };
}

// ---------------------------------------------------------------------------
// 7. createPaymentIntegrationPlaceholder (Step 7)
// ---------------------------------------------------------------------------

export type PaymentSetupChoice = 'clover' | 'not_configured' | 'configure_later';

/**
 * Reuses `services/paymentsService.ts`'s existing
 * `PaymentIntegration`/`createPaymentIntegration` — never a parallel
 * payment-configuration model. For `'clover'`, creates a disabled
 * placeholder row naming only *reference* env var names (never a
 * credential value — "Do not collect or store Clover secrets in
 * onboarding forms. Store only credential-reference names."); for
 * `'not_configured'`/`'configure_later'`, no row is created at all —
 * there is nothing to configure yet, and `validateLaunchReadiness` treats
 * "payments step reviewed" as independent of whether an integration row
 * exists. Idempotent: reuses `paymentsService.ts`'s natural-key
 * (`{organizationId}-{provider}`) convention via `getIntegration`.
 */
export async function createPaymentIntegrationPlaceholder(
  organizationId: string,
  choice: PaymentSetupChoice,
  references: { merchantIdReference?: string; credentialReference?: string; webhookSecretReference?: string } | undefined,
  dataAdapterMode: DataAdapterMode,
): Promise<{ integration: PaymentIntegration | null; isNew: boolean }> {
  if (choice !== 'clover') {
    return { integration: null, isNew: false };
  }

  const existing = await getIntegration(organizationId, 'clover', dataAdapterMode);
  if (existing) return { integration: existing, isNew: false };

  const now = nowIso();
  const integration: PaymentIntegration = {
    id: `${organizationId}-clover`,
    organizationId,
    provider: 'clover',
    environment: 'sandbox',
    merchantIdReference: references?.merchantIdReference ?? '',
    credentialReference: references?.credentialReference ?? '',
    webhookSecretReference: references?.webhookSecretReference ?? '',
    isEnabled: false,
    createdAt: now,
    updatedAt: now,
  };

  const created = await createPaymentIntegration(integration, dataAdapterMode);
  return { integration: created, isNew: true };
}

// ---------------------------------------------------------------------------
// 8. saveBranding (Step 8)
// ---------------------------------------------------------------------------

export async function getBranding(organizationId: string, dataAdapterMode: DataAdapterMode): Promise<OrganizationBranding | null> {
  if (dataAdapterMode === 'mock') {
    return organizationBrandingFixtures.find((b) => b.organizationId === organizationId) ?? null;
  }
  const response = await queryWixDataItems<WixOrganizationBrandingItem>('organizationBranding', {
    filter: { organizationId },
    paging: { limit: 1 },
  });
  return mapWixOrganizationBrandingItem(response.dataItems[0]?.data);
}

export type SaveBrandingInput = {
  logoUrl?: string | null;
  primaryColor?: string | null;
  secondaryColor?: string | null;
  accentColor?: string | null;
  emailFromName?: string | null;
  documentFooter?: string | null;
};

/** Upsert keyed by `organizationId` — branding is editable, not
    historical/append-only, so "idempotent" here means "safe to call
    repeatedly," including re-saving the exact same values or changing
    them, never "reject a second call." */
export async function saveBranding(
  organizationId: string,
  input: SaveBrandingInput,
  dataAdapterMode: DataAdapterMode,
): Promise<OrganizationBranding> {
  const now = nowIso();
  const existing = await getBranding(organizationId, dataAdapterMode);

  if (existing) {
    const patch = { ...input, updatedAt: now };
    if (dataAdapterMode === 'mock') {
      const index = organizationBrandingFixtures.findIndex((b) => b.organizationId === organizationId);
      organizationBrandingFixtures[index] = { ...organizationBrandingFixtures[index], ...patch };
      return organizationBrandingFixtures[index];
    }
    const response = await queryWixDataItems<WixOrganizationBrandingItem>('organizationBranding', {
      filter: { organizationId },
      paging: { limit: 1 },
    });
    const existingItem = response.dataItems[0];
    if (!existingItem) throw new Error('Branding row disappeared between read and write.');
    const merged = applyOrganizationBrandingUpdateToWixData(existingItem.data, patch);
    const updated = await updateWixDataItem<WixOrganizationBrandingItem>('organizationBranding', existingItem.id, merged);
    const mapped = mapWixOrganizationBrandingItem(updated.data);
    if (!mapped) throw new Error('Failed to update branding.');
    return mapped;
  }

  const branding: OrganizationBranding = {
    organizationId,
    logoUrl: input.logoUrl ?? null,
    primaryColor: input.primaryColor ?? null,
    secondaryColor: input.secondaryColor ?? null,
    accentColor: input.accentColor ?? null,
    emailFromName: input.emailFromName ?? null,
    documentFooter: input.documentFooter ?? null,
    createdAt: now,
    updatedAt: now,
  };

  if (dataAdapterMode === 'mock') {
    organizationBrandingFixtures.push(branding);
    return branding;
  }

  const inserted = await insertWixDataItem<WixOrganizationBrandingItem>(
    'organizationBranding',
    buildWixOrganizationBrandingData(branding),
    organizationId,
  );
  const mapped = mapWixOrganizationBrandingItem(inserted.data);
  if (!mapped) throw new Error('Failed to create branding.');
  return mapped;
}

// ---------------------------------------------------------------------------
// 9. validateLaunchReadiness + 10. completeOnboarding (Step 9)
// ---------------------------------------------------------------------------

export async function validateLaunchReadiness(
  organizationId: string,
  onboardingSession: OnboardingSession,
  dataAdapterMode: DataAdapterMode,
): Promise<{ checklist: LaunchChecklistItem[]; ready: boolean }> {
  const organization = await getOrganization(organizationId, dataAdapterMode);
  const [location, administratorCount, workflow, catalog] = await Promise.all([
    getPrimaryLocation(organizationId, dataAdapterMode),
    countAdminMemberships(organizationId, dataAdapterMode),
    getOrganizationWorkflow(organizationId, dataAdapterMode),
    getOrganizationServiceCatalog(organizationId, dataAdapterMode),
  ]);

  const input: LaunchReadinessInput = {
    hasOrganizationProfile: Boolean(
      organization?.legalName && organization?.name && organization?.timezone && organization?.defaultCurrency && organization?.primaryEmail && organization?.primaryPhone,
    ),
    hasPrimaryLocation: location !== null,
    hasAdministrator: administratorCount > 0,
    hasWorkflow: workflow !== null,
    hasIntakeConfigured: Boolean(workflow && workflow.versions.length > 0 && workflow.versions[workflow.versions.length - 1].intake.sections.length > 0),
    hasServiceCatalog: catalog.length > 0,
    paymentStatusReviewed: onboardingSession.completedSteps.includes('payments'),
    brandingReviewed: onboardingSession.completedSteps.includes('branding'),
  };

  return { checklist: buildLaunchChecklist(input), ready: isReadyToLaunch(input) };
}

async function countAdminMemberships(organizationId: string, dataAdapterMode: DataAdapterMode): Promise<number> {
  if (dataAdapterMode === 'mock') {
    return mockMembershipFixtures.filter(
      (m) => m.organizationId === organizationId && m.isActive && (m.role === 'owner' || m.role === 'administrator'),
    ).length;
  }
  const response = await queryWixDataItems<Record<string, unknown>>('organizationMemberships', {
    filter: { organizationId, isActive: true },
  });
  return response.dataItems.filter((item) => item.data.role === 'owner' || item.data.role === 'administrator').length;
}

/**
 * Marks onboarding completed and flips `organization.status` to `active`
 * — the only code path that may ever do so ("Only the server may mark
 * onboarding completed"). Rejects (returns `{success: false}`) when
 * `validateLaunchReadiness` finds any required item missing — never
 * partially activates. Idempotent: calling this again on an
 * already-`completed` session is a harmless no-op returning the same
 * result.
 */
export async function completeOnboarding(
  onboardingSessionId: string,
  actorUserId: string,
  idFactory: () => string,
  dataAdapterMode: DataAdapterMode,
): Promise<
  | { success: true; organization: Organization; session: OnboardingSession }
  | { success: false; checklist: LaunchChecklistItem[] }
> {
  const session = await getOnboardingSessionById(onboardingSessionId, dataAdapterMode);
  if (!session) throw new Error('Onboarding session not found.');

  if (session.status === 'completed') {
    const organization = await getOrganization(session.organizationId, dataAdapterMode);
    if (!organization) throw new Error('Organization not found for a completed onboarding session.');
    return { success: true, organization, session };
  }

  const { checklist, ready } = await validateLaunchReadiness(session.organizationId, session, dataAdapterMode);
  if (!ready) {
    return { success: false, checklist };
  }

  const now = nowIso();
  const organization = await updateOrganization(session.organizationId, { status: 'active', isActive: true }, dataAdapterMode);
  if (!organization) throw new Error('Organization not found while completing onboarding.');

  const completedSteps: OnboardingStepKey[] = ONBOARDING_STEPS.map((s) => s.key);
  const updatedSession = await updateOnboardingSession(
    onboardingSessionId,
    { status: 'completed', completedAt: now, completedSteps, version: session.version + 1 },
    dataAdapterMode,
  );
  if (!updatedSession) throw new Error('Onboarding session disappeared while completing onboarding.');

  await recordOnboardingAudit(
    { organizationId: session.organizationId, actorUserId, action: 'onboarding_completed', metadata: null },
    idFactory,
    dataAdapterMode,
  );

  return { success: true, organization, session: updatedSession };
}

// ---------------------------------------------------------------------------
// Onboarding session step progression (used by every PATCH .../route.ts)
// ---------------------------------------------------------------------------

export async function updateOnboardingSession(
  onboardingSessionId: string,
  patch: Partial<OnboardingSession>,
  dataAdapterMode: DataAdapterMode,
): Promise<OnboardingSession | null> {
  const nextPatch = { ...patch, lastSavedAt: nowIso() };

  if (dataAdapterMode === 'mock') {
    const index = onboardingSessionFixtures.findIndex((s) => s.id === onboardingSessionId);
    if (index === -1) return null;
    onboardingSessionFixtures[index] = { ...onboardingSessionFixtures[index], ...nextPatch };
    return onboardingSessionFixtures[index];
  }

  const response = await queryWixDataItems<WixOnboardingSessionItem>('onboardingSessions', {
    filter: { beaconOnboardingSessionId: onboardingSessionId },
    paging: { limit: 1 },
  });
  const existingItem = response.dataItems[0];
  if (!existingItem) return null;
  const merged = applyOnboardingSessionUpdateToWixData(existingItem.data, nextPatch);
  const updated = await updateWixDataItem<WixOnboardingSessionItem>('onboardingSessions', existingItem.id, merged);
  return mapWixOnboardingSessionItem(updated.data);
}

/** Marks `step` completed (idempotent — adding an already-present step is
    a no-op) and advances `currentStep` to whatever comes next, unless the
    caller is revisiting an earlier step (backward navigation never loses
    completed-step membership or jumps `currentStep` backward on its own). */
export async function markStepCompleted(
  session: OnboardingSession,
  step: OnboardingStepKey,
  dataAdapterMode: DataAdapterMode,
): Promise<OnboardingSession | null> {
  const completedSteps = session.completedSteps.includes(step) ? session.completedSteps : [...session.completedSteps, step];
  const advanced = computeNextStep(step);
  const currentStep = advanced ?? step;

  return updateOnboardingSession(
    session.id,
    { completedSteps, currentStep, version: session.version + 1 },
    dataAdapterMode,
  );
}

// ---------------------------------------------------------------------------
// Existing-organization migration/backfill (e.g. Manor's Cremation)
// ---------------------------------------------------------------------------

async function findOnboardingSessionForOrganization(
  organizationId: string,
  dataAdapterMode: DataAdapterMode,
): Promise<OnboardingSession | null> {
  if (dataAdapterMode === 'mock') {
    return onboardingSessionFixtures.find((s) => s.organizationId === organizationId) ?? null;
  }
  const response = await queryWixDataItems<WixOnboardingSessionItem>('onboardingSessions', {
    filter: { organizationId },
    paging: { limit: 1 },
  });
  return mapWixOnboardingSessionItem(response.dataItems[0]?.data);
}

export type MigrateExistingOrganizationInput = {
  organizationId: string;
  legalName: string;
  displayName: string;
  primaryEmail: string;
  primaryPhone: string;
  website?: string | null;
  timezone: string;
  defaultCurrency: string;
  primaryLocation: CreatePrimaryLocationInput;
  actorUserId: string;
};

export type MigrateExistingOrganizationReport = {
  organization: { id: string; created: boolean; backfilledFields: string[] };
  primaryLocation: { id: string; created: boolean };
  workflowTemplate: { id: string; found: boolean } | { found: false };
  serviceCatalog: { count: number };
  paymentIntegration: { id: string; found: boolean } | { found: false };
  onboardingSession: { id: string; created: boolean };
};

/**
 * Phase 20 (Organization Onboarding & Tenant Provisioning). Backfills a
 * tenant that already existed *before* this phase's onboarding flow was
 * built (Manor's Cremation, live since Phase 13/14A) into the same
 * `Organization`/`OrganizationLocation`/`OnboardingSession` shape a
 * brand-new tenant now gets — "Do not recreate or duplicate Manor's
 * existing tenant data": every already-existing record (its workflow
 * versions, its service catalog, its Clover `PaymentIntegration`) is only
 * ever *confirmed and linked/reported*, never re-created or overwritten.
 * Only the organization's own profile row is backfilled — and only fields
 * it doesn't already have a value for (`legalName`/`slug`/`timezone`/etc.
 * were introduced by this phase; `name`/`isActive` already existed and are
 * left untouched) — plus a genuinely new `OrganizationLocation` (Manor's
 * predates that collection entirely) and a `completed`-status
 * `OnboardingSession` recording that this migration ran.
 *
 * Idempotent — safe to run more than once: the organization backfill only
 * ever fills in currently-absent fields, `createPrimaryLocation` finds and
 * returns an already-created primary location rather than duplicating it,
 * and a second call finds the first call's own `OnboardingSession` already
 * recorded and leaves it untouched.
 */
export async function migrateExistingOrganization(
  input: MigrateExistingOrganizationInput,
  idFactory: () => string,
  dataAdapterMode: DataAdapterMode,
): Promise<MigrateExistingOrganizationReport> {
  const now = nowIso();
  let organization = await getOrganization(input.organizationId, dataAdapterMode);
  let orgCreated = false;
  const backfilledFields: string[] = [];

  if (!organization) {
    orgCreated = true;
    const slug = await generateUniqueSlug(input.displayName, dataAdapterMode);
    organization = await persistOrganization(
      {
        id: input.organizationId,
        name: input.displayName,
        isActive: true,
        legalName: input.legalName,
        slug,
        status: 'active',
        timezone: input.timezone,
        defaultCurrency: input.defaultCurrency.toLowerCase(),
        primaryEmail: input.primaryEmail,
        primaryPhone: input.primaryPhone,
        website: input.website ?? null,
        createdAt: now,
        updatedAt: now,
      },
      dataAdapterMode,
    );
  } else {
    const patch: Partial<Organization> = {};
    if (!organization.legalName) {
      patch.legalName = input.legalName;
      backfilledFields.push('legalName');
    }
    if (!organization.slug) {
      patch.slug = await generateUniqueSlug(input.displayName, dataAdapterMode);
      backfilledFields.push('slug');
    }
    if (!organization.status) {
      // An already-live tenant is 'active' by definition — never 'draft'
      // or 'onboarding', which would incorrectly suggest it isn't fully
      // set up yet.
      patch.status = 'active';
      backfilledFields.push('status');
    }
    if (!organization.timezone) {
      patch.timezone = input.timezone;
      backfilledFields.push('timezone');
    }
    if (!organization.defaultCurrency) {
      patch.defaultCurrency = input.defaultCurrency.toLowerCase();
      backfilledFields.push('defaultCurrency');
    }
    if (!organization.primaryEmail) {
      patch.primaryEmail = input.primaryEmail;
      backfilledFields.push('primaryEmail');
    }
    if (!organization.primaryPhone) {
      patch.primaryPhone = input.primaryPhone;
      backfilledFields.push('primaryPhone');
    }
    if (organization.website === undefined && input.website !== undefined) {
      patch.website = input.website ?? null;
      backfilledFields.push('website');
    }
    if (!organization.createdAt) {
      patch.createdAt = now;
      backfilledFields.push('createdAt');
    }

    if (Object.keys(patch).length > 0) {
      const updated = await updateOrganization(input.organizationId, patch, dataAdapterMode);
      if (updated) organization = updated;
    }
  }

  const { location, isNew: locationCreated } = await createPrimaryLocation(
    input.organizationId,
    input.primaryLocation,
    idFactory,
    dataAdapterMode,
  );

  const workflowTemplate = await getOrganizationWorkflow(input.organizationId, dataAdapterMode);
  const catalog = await getOrganizationServiceCatalog(input.organizationId, dataAdapterMode);
  const paymentIntegration = await getIntegration(input.organizationId, 'clover', dataAdapterMode);

  let onboardingSession = await findOnboardingSessionForOrganization(input.organizationId, dataAdapterMode);
  let sessionCreated = false;
  if (!onboardingSession) {
    sessionCreated = true;
    const completedSteps = ONBOARDING_STEPS.map((s) => s.key);
    const session: OnboardingSession = {
      id: idFactory(),
      organizationId: input.organizationId,
      status: 'completed',
      currentStep: 'review_launch',
      completedSteps,
      startedByUserId: input.actorUserId,
      startedAt: now,
      completedAt: now,
      lastSavedAt: now,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };

    if (dataAdapterMode === 'mock') {
      onboardingSessionFixtures.push(session);
    } else {
      await insertWixDataItem<WixOnboardingSessionItem>('onboardingSessions', buildWixOnboardingSessionData(session), session.id);
    }
    onboardingSession = session;

    await recordOnboardingAudit(
      { organizationId: input.organizationId, actorUserId: input.actorUserId, action: 'onboarding_completed', metadata: { migrated: 'true' } },
      idFactory,
      dataAdapterMode,
    );
  }

  return {
    organization: { id: organization.id, created: orgCreated, backfilledFields },
    primaryLocation: { id: location.id, created: locationCreated },
    workflowTemplate: workflowTemplate ? { id: workflowTemplate.id, found: true } : { found: false },
    serviceCatalog: { count: catalog.length },
    paymentIntegration: paymentIntegration ? { id: paymentIntegration.id, found: true } : { found: false },
    onboardingSession: { id: onboardingSession.id, created: sessionCreated },
  };
}
