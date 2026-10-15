import { isValidOrganizationId } from '../../lib/env';
import { RESERVED_SLUGS } from './slug';

/**
 * Safe organization onboarding (2026-10). Pure rules for the optional,
 * caller-chosen organization id `POST /api/onboarding/start` accepts
 * (e.g. `gus-camacho-jr`). No I/O here: existence/conflict checks need the
 * data layer and live in services/organizationProvisioningService.ts.
 *
 * Why an id can be chosen at all: several SOLIS deployments share one
 * multi-tenant Beacon backend, and each deployment names the organizations
 * it serves by id (DEPLOYMENT_ORGANIZATION_IDS). A random UUID can't be
 * known in advance, so a restricted deployment could never serve the
 * tenant it just onboarded.
 */

/**
 * Ids that may never be claimed through onboarding, even when free:
 * - every reserved slug (route names, platform names),
 * - generic/sentinel words that would be confusing or dangerous as a
 *   tenant id,
 * - `managed-cremations` — the live Manors tenant. Its row already exists,
 *   so the existence check would reject it anyway; it is listed here too so
 *   onboarding can never write to it even if that lookup were ever wrong.
 */
export const RESERVED_ORGANIZATION_IDS: ReadonlySet<string> = new Set([
  ...RESERVED_SLUGS,
  'managed-cremations',
  'platform',
  'system',
  'global',
  'default',
  'null',
  'undefined',
  'root',
  'new',
  'organization',
  'organizations',
]);

export function isReservedOrganizationId(id: string): boolean {
  return RESERVED_ORGANIZATION_IDS.has(id);
}

export type OrganizationIdResolutionError =
  | 'invalid_organization_id'
  | 'reserved_organization_id'
  | 'organization_not_allowed_in_deployment'
  | 'organization_id_required';

export type OrganizationIdResolution =
  | { ok: true; organizationId: string | null }
  | { ok: false; code: OrganizationIdResolutionError; message: string };

/**
 * Resolves which organization id a new onboarding should use.
 *
 * - `requested` given: it must be a string matching `isValidOrganizationId`,
 *   not reserved, and allowed by this deployment's allowlist.
 * - `requested` omitted, deployment unrestricted (`allowlist === null`):
 *   `organizationId: null` — the caller generates a UUID (old behaviour).
 * - `requested` omitted, deployment restricted to exactly one organization:
 *   that organization (a Gus deployment onboards `gus-camacho-jr` without
 *   the wizard having to send it). It still goes through every check below.
 * - `requested` omitted, deployment restricted to several organizations:
 *   rejected — the caller must say which one.
 */
export function resolveOnboardingOrganizationId(
  requested: unknown,
  allowlist: readonly string[] | null,
): OrganizationIdResolution {
  let candidate: unknown = requested;
  if (candidate === undefined || candidate === null || candidate === '') {
    if (allowlist === null) return { ok: true, organizationId: null };
    if (allowlist.length !== 1) {
      return {
        ok: false,
        code: 'organization_id_required',
        message: 'This deployment serves several organizations — organizationId is required.',
      };
    }
    candidate = allowlist[0];
  }

  if (typeof candidate !== 'string' || !isValidOrganizationId(candidate)) {
    return {
      ok: false,
      code: 'invalid_organization_id',
      message: 'organizationId must be 3-64 lowercase letters, digits or hyphens, starting and ending with a letter or digit.',
    };
  }
  if (isReservedOrganizationId(candidate)) {
    return { ok: false, code: 'reserved_organization_id', message: `Organization id "${candidate}" is reserved.` };
  }
  if (allowlist !== null && !allowlist.includes(candidate)) {
    return {
      ok: false,
      code: 'organization_not_allowed_in_deployment',
      message: `Organization "${candidate}" is not served by this deployment.`,
    };
  }
  return { ok: true, organizationId: candidate };
}
