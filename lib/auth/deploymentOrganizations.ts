import { getDeploymentOrganizationIds } from '../env';

/**
 * Deployment organization restrictions (2026-10) — the single reusable
 * gate every tenant-scoped entry point (staff API routes, the portal
 * layout, family/public token routes, webhooks, scheduled jobs, onboarding)
 * consults so that one SOLIS deployment never serves or processes another
 * deployment's organizations on the shared Beacon backend.
 *
 * Configuration lives in lib/env.ts (`DEPLOYMENT_ORGANIZATION_IDS`), which
 * fails closed in production on Wix data. With no allowlist (local/mock),
 * every organization is allowed — membership checks still apply.
 *
 * Organization ids are only ever compared exactly; a client-supplied id is
 * never trusted by this module — it only answers "may this deployment
 * touch that organization at all", on top of (never instead of) the
 * caller's membership/ownership checks.
 */
export function isOrganizationAllowedInDeployment(organizationId: string | null | undefined): boolean {
  if (!organizationId) return false;
  const allowed = getDeploymentOrganizationIds();
  return allowed === null || allowed.includes(organizationId);
}

/** Keeps only records whose organization this deployment may serve. */
export function filterToDeploymentOrganizations<T>(
  records: readonly T[],
  organizationIdOf: (record: T) => string | null | undefined,
): T[] {
  const allowed = getDeploymentOrganizationIds();
  if (allowed === null) return [...records];
  return records.filter((record) => {
    const organizationId = organizationIdOf(record);
    return organizationId != null && allowed.includes(organizationId);
  });
}

export class DeploymentOrganizationError extends Error {
  constructor(organizationId: string | null | undefined) {
    super(`Organization "${organizationId ?? '(none)'}" is not served by this deployment.`);
    this.name = 'DeploymentOrganizationError';
  }
}

/** Throws DeploymentOrganizationError when the organization is outside this deployment. */
export function assertOrganizationAllowedInDeployment(organizationId: string | null | undefined): void {
  if (!isOrganizationAllowedInDeployment(organizationId)) {
    throw new DeploymentOrganizationError(organizationId);
  }
}
