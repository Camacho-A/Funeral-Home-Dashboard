import crypto from 'crypto';
import type { DataAdapterMode } from '../lib/env';
import { getDeploymentOrganizationIds } from '../lib/env';
import { isOrganizationAllowedInDeployment } from '../lib/auth/deploymentOrganizations';
import { queryWixDataItems, insertWixDataItem, updateWixDataItem, WixDataApiError } from '../lib/wixDataApi';
import { isAdminTier } from './authorizationPolicyService';
import { seedDefaultRoles } from './roleService';
import { resolveRoleForKey } from './permissionService';
import { getMembership, createMembership } from './membershipService';
import { getIdentityById } from './identityService';
import { ensureStaffProfileForActivatedMembership } from './staffProfileService';
import { inviteToOrganization, type InviteToOrganizationResult } from './invitationService';
import { mapWixMembershipItem, buildWixMembershipData, type WixMembershipItem } from '../lib/wixMembershipMapper';
import type { Membership } from '../types/membership';
import { resolveOnboardingOrganizationId, type OrganizationIdResolutionError } from '../domain/onboarding/organizationId';
import {
  mapWixOrganizationItem,
  buildWixOrganizationData,
  applyOrganizationUpdateToWixData,
  type WixOrganizationItem,
} from '../lib/wixOrganizationMapper';
import {
  mapWixOrganizationLocationItem,
  buildWixOrganizationLocationData,
  applyOrganizationLocationUpdateToWixData,
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
import { uploadPublicBrandingAsset } from '../lib/vercelBlob/brandingAssetStorage';
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
import { membershipFixtures } from './__mocks__/identityFixtures';
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
  // Safe onboarding (2026-10): never offer to resume a session for an
  // organization this deployment does not serve.
  if (dataAdapterMode === 'mock') {
    return (
      onboardingSessionFixtures.find(
        (s) => s.startedByUserId === userId && s.status !== 'completed' && isOrganizationAllowedInDeployment(s.organizationId),
      ) ?? null
    );
  }
  const response = await queryWixDataItems<WixOnboardingSessionItem>('onboardingSessions', {
    filter: { startedByUserId: userId },
  });
  const sessions = response.dataItems
    .map((item) => mapWixOnboardingSessionItem(item.data))
    .filter((s): s is OnboardingSession => s !== null && s.status !== 'completed' && isOrganizationAllowedInDeployment(s.organizationId));
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
  /**
   * Safe onboarding (2026-10): optional caller-chosen organization id
   * (e.g. `gus-camacho-jr`). Validated by
   * `domain/onboarding/organizationId.ts#resolveOnboardingOrganizationId`
   * (format, reserved ids, deployment allowlist) and then required not to
   * exist yet. Omitted on an unrestricted deployment → a UUID from
   * `idFactory` (the original behaviour).
   */
  organizationId?: unknown;
};

export type OnboardingStartErrorCode =
  | OrganizationIdResolutionError
  | 'organization_exists'
  | 'idempotency_key_conflict';

/** A refusal `/api/onboarding/start` turns into a 4xx — never a partial
    write: every check that can raise this runs before (or instead of) any
    write to an organization that is not this onboarding's own. */
export class OnboardingStartError extends Error {
  readonly code: OnboardingStartErrorCode;
  readonly status: 400 | 403 | 409;
  constructor(code: OnboardingStartErrorCode, message: string) {
    super(message);
    this.name = 'OnboardingStartError';
    this.code = code;
    this.status =
      code === 'organization_exists' || code === 'idempotency_key_conflict'
        ? 409
        : code === 'organization_not_allowed_in_deployment'
          ? 403
          : 400;
  }
}

/** Deterministic onboarding-session id for a chosen organization id. Wix
    item ids are unique, so two different idempotency keys racing to
    onboard the same chosen id can never both claim a session — the loser's
    insert conflicts and is reported as `organization_exists`. */
export function onboardingSessionIdForOrganization(organizationId: string): string {
  return `onboarding-${organizationId}`;
}

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
  const resolution = resolveOnboardingOrganizationId(input.organizationId, getDeploymentOrganizationIds());
  if (!resolution.ok) throw new OnboardingStartError(resolution.code, resolution.message);
  const chosenOrganizationId = resolution.organizationId;

  // 1. Same idempotency key seen before → resume that draft, but only if it
  //    is for the same organization id (a key can never be re-pointed).
  const priorSession = await findOnboardingSessionByIdempotencyKey(input.idempotencyKey, dataAdapterMode);
  if (priorSession) {
    if (chosenOrganizationId !== null && priorSession.organizationId !== chosenOrganizationId) {
      throw new OnboardingStartError(
        'idempotency_key_conflict',
        'This idempotency key was already used to onboard a different organization.',
      );
    }
    if (!isOrganizationAllowedInDeployment(priorSession.organizationId)) {
      throw new OnboardingStartError('organization_not_allowed_in_deployment', 'That onboarding belongs to an organization this deployment does not serve.');
    }
  } else if (chosenOrganizationId !== null) {
    // 2. New key + chosen id → the id must be completely unused: no
    //    organization row and no other onboarding session. Never merge
    //    into, or overwrite, an existing tenant.
    if ((await getOrganization(chosenOrganizationId, dataAdapterMode)) || (await findOnboardingSessionForOrganization(chosenOrganizationId, dataAdapterMode))) {
      throw new OnboardingStartError('organization_exists', `Organization "${chosenOrganizationId}" already exists.`);
    }
  }

  const organizationId = priorSession?.organizationId ?? chosenOrganizationId ?? input.idFactory();
  const now = nowIso();

  const draftSession: OnboardingSession = {
    id: priorSession?.id ?? (chosenOrganizationId !== null ? onboardingSessionIdForOrganization(chosenOrganizationId) : input.idFactory()),
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

  let claimed: { session: OnboardingSession; isNew: boolean };
  try {
    claimed = priorSession
      ? { session: priorSession, isNew: false }
      : await persistOnboardingSessionWithIdempotencyKey(draftSession, input.idempotencyKey, dataAdapterMode);
  } catch (error) {
    // A conflict that is NOT our own key (see persistOnboardingSessionWithIdempotencyKey)
    // means another key just claimed this chosen organization id.
    if (chosenOrganizationId !== null && isWixConflict(error)) {
      throw new OnboardingStartError('organization_exists', `Organization "${chosenOrganizationId}" is already being onboarded.`);
    }
    throw error;
  }
  const { session, isNew } = claimed;
  if (chosenOrganizationId !== null && session.organizationId !== chosenOrganizationId) {
    throw new OnboardingStartError('idempotency_key_conflict', 'This idempotency key was already used to onboard a different organization.');
  }

  let organization = await getOrganization(session.organizationId, dataAdapterMode);
  if (organization && isNew) {
    // The organization appeared between the existence check and our claim
    // (created out-of-band). Never adopt it.
    throw new OnboardingStartError('organization_exists', `Organization "${session.organizationId}" already exists.`);
  }
  if (organization && session.status !== 'completed' && organization.status !== 'draft' && organization.status !== 'onboarding') {
    // A resumed draft whose organization is already live/suspended was not
    // created by this onboarding — refuse rather than re-seed or re-activate it.
    throw new OnboardingStartError('organization_exists', `Organization "${session.organizationId}" is not an onboarding draft.`);
  }
  if (!organization) {
    // Either genuinely new, or a prior attempt's organization write failed
    // — either way, create it now using the session's own fixed id.
    const slug = await generateUniqueSlug(input.displayName, dataAdapterMode);
    try {
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
    } catch (error) {
      if (isWixConflict(error)) {
        throw new OnboardingStartError('organization_exists', `Organization "${session.organizationId}" already exists.`);
      }
      throw error;
    }
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

  // Phase 22 (Role-Based Access Control) integration: every organization
  // gets its RBAC roster as soon as it exists — before Step 3
  // (`assignInitialAdministrator`) can run. Idempotent (deterministic ids).
  // Safe onboarding (2026-10): seeding only ever writes rows scoped to THIS
  // organization (enablements + org-scoped grant overrides); the shared
  // default-role rows every other tenant resolves through are never
  // written unless the backend has no default roles at all — see
  // roleService.seedPlatformDefaultRoles.
  await seedDefaultRoles(session.organizationId, dataAdapterMode, organization.status);

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

/**
 * Settings → Organization Profile (2026-09). Updates the organization's
 * existing primary location — never creates one (see `getPrimaryLocation`/
 * `createPrimaryLocation` above for that; this function returns `null`,
 * untouched, when no primary location exists rather than fabricating one).
 * Same load-current → merge → write-full-record safety as
 * `updateOrganization`: `applyOrganizationLocationUpdateToWixData` spreads
 * the existing raw Wix item first, only then overlays the patch's fields —
 * `isPrimary`/`isActive`/`organizationId`/`createdAt` are never part of
 * that patch's possible fields (see this editor's own API route), so they
 * always survive the full-replace write untouched.
 */
export async function updatePrimaryLocation(
  organizationId: string,
  patch: Partial<OrganizationLocation>,
  dataAdapterMode: DataAdapterMode,
): Promise<OrganizationLocation | null> {
  const nextPatch = { ...patch, updatedAt: nowIso() };

  if (dataAdapterMode === 'mock') {
    const index = organizationLocationFixtures.findIndex((l) => l.organizationId === organizationId && l.isPrimary);
    if (index === -1) return null;
    organizationLocationFixtures[index] = { ...organizationLocationFixtures[index], ...nextPatch };
    return organizationLocationFixtures[index];
  }

  const response = await queryWixDataItems<WixOrganizationLocationItem>('organizationLocations', {
    filter: { organizationId, isPrimary: true },
    paging: { limit: 1 },
  });
  const existingItem = response.dataItems[0];
  if (!existingItem) return null;
  const merged = applyOrganizationLocationUpdateToWixData(existingItem.data, nextPatch);
  const updated = await updateWixDataItem<WixOrganizationLocationItem>('organizationLocations', existingItem.id, merged);
  return mapWixOrganizationLocationItem(updated.data);
}

// ---------------------------------------------------------------------------
// 3. assignInitialAdministrator (Step 3)
// ---------------------------------------------------------------------------

async function findLegacyAdminMembership(
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

export type OnboardingAdministratorErrorCode = 'identity_not_found' | 'membership_not_assignable';

export class OnboardingAdministratorError extends Error {
  readonly code: OnboardingAdministratorErrorCode;
  constructor(code: OnboardingAdministratorErrorCode, message: string) {
    super(message);
    this.name = 'OnboardingAdministratorError';
    this.code = code;
  }
}

/** Deterministic id for the first administrator's membership row, so a
    double-submitted Step 3 can never create two rows. */
export function initialAdministratorMembershipId(organizationId: string, identityId: string): string {
  const readable = `membership-${organizationId}-${identityId}`;
  if (readable.length <= 128) return readable;
  const digest = crypto.createHash('sha256').update(`membership|${organizationId}|${identityId}`).digest('hex').slice(0, 40);
  return `membership-h-${digest}`;
}

function toLegacyShape(membership: Membership): OrganizationMembership {
  return {
    organizationId: membership.organizationId,
    userId: membership.identityId,
    role: membership.role as OrganizationMembership['role'],
    isActive: membership.status === 'active',
  };
}

/**
 * Step 3 — the first administrator. Only ever assigns the literal
 * `'administrator'` role (no parameter through which a caller could ask for
 * another), and refuses unless that role resolves for this organization.
 *
 * Safe onboarding correction (2026-10) — membership format: this used to
 * write the legacy row shape (`userId`, `identitySource: 'wix'`, no
 * `identityId`/`status`), which identity-mode login
 * (`membershipService.listMembershipsForIdentity` → filter by
 * `identityId`, `mapWixMembershipItem` → requires `status`, timestamps,
 * `beaconMembershipId`) cannot read — the new organization's first
 * administrator could never sign into it. On Wix data (always identity
 * auth — see lib/env.ts#isAuthAdapterAllowedForDataAdapter) it now writes
 * the CURRENT identity format, `status: 'active'`, for an existing
 * `Identity` (`administratorUserId` is an identity id), plus the legacy
 * `userId`/`isActive` fields on the same row so legacy readers
 * (`countAdminMemberships`, `findLegacyAdminMembership`) keep working.
 * An unknown identity is refused (`identity_not_found`) — onboard a
 * person who has no identity yet with `inviteInitialAdministrator`
 * (the existing invitation flow: email verification + password) instead.
 * A StaffProfile is provisioned best-effort, like every other activation
 * path (invitation acceptance, reactivation).
 *
 * Mock data keeps the legacy fixture write (mock/wix-login sessions read
 * `mockMembershipFixtures`) and, when the user is also a mock identity,
 * adds the identity-format membership too.
 *
 * Idempotent: an existing active membership for the pair is returned
 * unchanged (never re-roled); a disabled/removed one is refused rather than
 * silently reactivated.
 */
export async function assignInitialAdministrator(
  organizationId: string,
  administratorUserId: string,
  idFactory: () => string,
  dataAdapterMode: DataAdapterMode,
  options?: { invitedByIdentityId?: string | null },
): Promise<{ membership: OrganizationMembership; isNew: boolean; identityMembership?: Membership }> {
  const administratorRole = await resolveRoleForKey('administrator', organizationId, dataAdapterMode);
  if (!administratorRole) {
    throw new Error(`The administrator role is not yet resolvable for organization ${organizationId} — its RBAC roster has not been seeded.`);
  }

  if (dataAdapterMode === 'mock') {
    let legacy = await findLegacyAdminMembership(organizationId, administratorUserId, dataAdapterMode);
    let isNew = false;
    if (!legacy) {
      legacy = { organizationId, userId: administratorUserId, role: 'administrator', isActive: true };
      mockMembershipFixtures.push(legacy);
      isNew = true;
    }
    const identity = await getIdentityById(administratorUserId, dataAdapterMode);
    if (!identity) return { membership: legacy, isNew };
    const { membership: identityMembership, isNew: identityIsNew } = await createMembership(
      {
        identityId: identity.id,
        organizationId,
        role: 'administrator',
        status: 'active',
        invitedBy: options?.invitedByIdentityId ?? null,
        idFactory: () => initialAdministratorMembershipId(organizationId, identity.id),
      },
      dataAdapterMode,
    );
    return { membership: legacy, isNew: isNew || identityIsNew, identityMembership };
  }

  const existing = await getMembership(administratorUserId, organizationId, dataAdapterMode);
  if (existing) {
    if (existing.status === 'active' || existing.status === 'invited') {
      return { membership: toLegacyShape(existing), isNew: false, identityMembership: existing };
    }
    throw new OnboardingAdministratorError(
      'membership_not_assignable',
      `This person's membership in the organization is ${existing.status}; change it in Settings → Team instead.`,
    );
  }

  const identity = await getIdentityById(administratorUserId, dataAdapterMode);
  if (!identity) {
    throw new OnboardingAdministratorError(
      'identity_not_found',
      'No SOLIS identity exists for that administrator. Invite them by email instead (administratorEmail).',
    );
  }

  const now = nowIso();
  const membership: Membership = {
    id: initialAdministratorMembershipId(organizationId, identity.id),
    identityId: identity.id,
    organizationId,
    role: 'administrator',
    status: 'active',
    invitedBy: options?.invitedByIdentityId ?? null,
    joinedAt: now,
    createdAt: now,
    updatedAt: now,
  };

  try {
    await insertWixDataItem<WixMembershipItem & Record<string, unknown>>(
      'organizationMemberships',
      {
        ...buildWixMembershipData(membership),
        // Legacy-reader compatibility on the same row (see this function's comment).
        userId: identity.id,
        isActive: true,
        identitySource: 'identity',
      },
      membership.id,
    );
  } catch (error) {
    if (!isWixConflict(error)) throw error;
    const landed = await getMembership(identity.id, organizationId, dataAdapterMode);
    if (!landed) throw error;
    return { membership: toLegacyShape(landed), isNew: false, identityMembership: landed };
  }

  try {
    await ensureStaffProfileForActivatedMembership(
      {
        organizationId,
        identityId: identity.id,
        membershipId: membership.id,
        displayName: identity.displayName,
        membershipRole: membership.role,
        idFactory,
      },
      dataAdapterMode,
    );
  } catch (error) {
    console.error(`[assignInitialAdministrator] StaffProfile provisioning failed for membershipId=${membership.id}:`, error);
  }

  return { membership: toLegacyShape(membership), isNew: true, identityMembership: membership };
}

/**
 * Step 3, alternative path — the first administrator has no SOLIS identity
 * yet. Reuses the existing invitation flow unchanged
 * (`invitationService.inviteToOrganization`: identity + `invited`
 * membership + verification token; acceptance verifies email, sets the
 * password, activates the membership and provisions the StaffProfile). The
 * caller delivers the token exactly like `POST /api/auth/invitations`.
 * Until the invitation is accepted the organization has no ACTIVE
 * administrator, so `validateLaunchReadiness` keeps blocking launch.
 */
export async function inviteInitialAdministrator(
  organizationId: string,
  params: { email: string; displayName: string; invitedByIdentityId: string },
  idFactory: () => string,
  dataAdapterMode: DataAdapterMode,
): Promise<InviteToOrganizationResult> {
  const administratorRole = await resolveRoleForKey('administrator', organizationId, dataAdapterMode);
  if (!administratorRole) {
    throw new Error(`The administrator role is not yet resolvable for organization ${organizationId} — its RBAC roster has not been seeded.`);
  }
  return inviteToOrganization(
    { email: params.email, displayName: params.displayName, organizationId, role: 'administrator', invitedByIdentityId: params.invitedByIdentityId, idFactory },
    dataAdapterMode,
  );
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
  // Safe onboarding (2026-10): never read another deployment's tenant data
  // as a clone source (e.g. a Gus deployment cloning Manors' workflow).
  if (source.organizationId && !isOrganizationAllowedInDeployment(source.organizationId)) return null;
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
  signInLogoUrl?: string | null;
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
    signInLogoUrl: input.signInLogoUrl ?? null,
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

/**
 * Which branding slot an upload fills (2026-10). `'mark'` is the original
 * compact logo every pre-existing caller means — it stays the default so
 * nothing had to change. `'signIn'` is the full lockup shown on the login
 * card.
 */
export type BrandingLogoSlot = 'mark' | 'signIn';

export type UploadBrandingLogoInput = {
  organizationId: string;
  slot?: BrandingLogoSlot;
  fileBuffer: Buffer;
  mimeType: string;
  fileExtension: string;
  idFactory: () => string;
};

/**
 * Organization Branding Settings phase. The real, production-capable
 * write path onboarding's own branding step never built ("No upload
 * endpoint is built in this phase" — `types/organizationBranding.ts`'s
 * own header comment, Phase 20). Uploads to a PUBLIC Blob location
 * (`uploadPublicBrandingAsset` — deliberately not the private,
 * `DocumentStorageProvider`-mediated path case documents use; see that
 * module's own header comment for why a logo needs a plain, directly-
 * fetchable URL), then persists the resulting URL via the existing
 * `saveBranding` upsert — the same function onboarding's own Branding
 * step already calls, so mock vs. wix persistence semantics are
 * identical to every other branding write, not a second code path.
 * `idFactory` is caller-injected (never `crypto.randomUUID()` called
 * directly here), matching `services/documentService.ts#upload`'s own
 * dependency-injection convention for testability.
 */
export async function uploadBrandingLogo(input: UploadBrandingLogoInput, dataAdapterMode: DataAdapterMode): Promise<OrganizationBranding> {
  const slot = input.slot ?? 'mark';
  const prefix = slot === 'signIn' ? 'signin-logo' : 'logo';
  const key = `branding/${input.organizationId}/${prefix}-${input.idFactory()}.${input.fileExtension}`;
  const { url } = await uploadPublicBrandingAsset(key, input.fileBuffer, input.mimeType);
  const patch: SaveBrandingInput = slot === 'signIn' ? { signInLogoUrl: url } : { logoUrl: url };
  return saveBranding(input.organizationId, patch, dataAdapterMode);
}

/**
 * Clears `logoUrl` back to `null` via the same `saveBranding` upsert.
 * Deliberately does NOT attempt to delete the previously-uploaded Blob —
 * this phase's own explicit instruction: "if uncertain, leave the
 * previous blob orphaned and report that cleanup as future work rather
 * than risking deletion of another resource." Confirming a stored
 * `logoUrl` is actually one of this app's own uploaded Blobs (as opposed
 * to, say, a hand-entered external URL) isn't something this service can
 * verify safely today, so no deletion is attempted at all — the orphaned
 * object (if any) is harmless, unreferenced storage, not a correctness
 * or security issue. `lib/vercelBlob/brandingAssetStorage.ts#deletePublicBrandingAsset`
 * exists for a future, deliberate cleanup pass once ownership can be
 * confirmed.
 */
export async function removeBrandingLogo(
  organizationId: string,
  dataAdapterMode: DataAdapterMode,
  slot: BrandingLogoSlot = 'mark',
): Promise<OrganizationBranding> {
  return saveBranding(organizationId, slot === 'signIn' ? { signInLogoUrl: null } : { logoUrl: null }, dataAdapterMode);
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

/**
 * Phase 22 (Role-Based Access Control) migration: counts active
 * memberships whose role resolves to admin-tier (`organization.manage`)
 * via `authorizationPolicyService.isAdminTier`, instead of comparing
 * `role === 'owner' || role === 'administrator'` directly. Behavior is
 * unchanged — `domain/rbac/legacyRoleAliases.ts` maps both of those
 * values onto the same `administrator` default role, the only one this
 * permission is granted to.
 */
async function countAdminMemberships(organizationId: string, dataAdapterMode: DataAdapterMode): Promise<number> {
  // Safe onboarding (2026-10): counts BOTH membership shapes — identity
  // format (`identityId` + `status: 'active'`, what identity login reads)
  // and the legacy shape (`userId` + `isActive`) — deduplicated by person.
  const candidates = new Map<string, string>();

  if (dataAdapterMode === 'mock') {
    for (const m of mockMembershipFixtures) {
      if (m.organizationId === organizationId && m.isActive) candidates.set(m.userId, m.role);
    }
    for (const m of membershipFixtures) {
      if (m.organizationId === organizationId && m.status === 'active' && !candidates.has(m.identityId)) candidates.set(m.identityId, m.role);
    }
  } else {
    const response = await queryWixDataItems<Record<string, unknown>>('organizationMemberships', {
      filter: { organizationId },
    });
    for (const item of response.dataItems) {
      const identityMembership = mapWixMembershipItem(item.data as WixMembershipItem);
      if (identityMembership) {
        if (identityMembership.status === 'active') candidates.set(identityMembership.identityId, identityMembership.role);
        continue;
      }
      const data = item.data;
      if (data.isActive === true && typeof data.userId === 'string' && typeof data.role === 'string' && !candidates.has(data.userId)) {
        candidates.set(data.userId, data.role);
      }
    }
  }

  const adminChecks = await Promise.all(
    [...candidates].map(([userId, role]) => isAdminTier({ identityId: userId, organizationId, roleKey: role }, dataAdapterMode)),
  );
  return adminChecks.filter(Boolean).length;
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

  // Phase 22 (Role-Based Access Control) integration: "completion before
  // organization activation." `startOnboarding` already seeds this
  // organization's RBAC roster (Step 1), but re-asserting it here —
  // idempotently, a cheap no-op if already seeded — guarantees the
  // invariant holds regardless of which code path actually created this
  // organization (defense in depth against, e.g., a future direct-creation
  // path that bypasses `startOnboarding`), and never activates an
  // organization whose roster isn't confirmed seeded. Reads the
  // organization fresh (still pre-activation at this point, always
  // 'draft'/'onboarding') so seedDefaultRoles' role-subset-integrity gate
  // sees accurate status, not a guess.
  const preActivationOrganization = await getOrganization(session.organizationId, dataAdapterMode);
  await seedDefaultRoles(session.organizationId, dataAdapterMode, preActivationOrganization?.status);

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

  // Phase 22 (Role-Based Access Control) integration: a pre-existing,
  // already-live tenant migrated through this path needs its RBAC roster
  // exactly as much as a brand-new one provisioned through
  // `startOnboarding` — "Manor's Cremation must not depend on manual setup
  // that future tenants will not receive." Idempotent; a genuinely first-
  // time migration (no enablement rows yet) still gets the full
  // platform-default set. A *re-run* against a tenant already migrated
  // once (organization.status is 'active' by this point, per the backfill
  // above) is now a strict no-op — see seedDefaultRoles' own comment —
  // rather than silently re-expanding a roster this tenant may have had
  // deliberately narrowed since its original migration.
  await seedDefaultRoles(input.organizationId, dataAdapterMode, organization.status);

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
