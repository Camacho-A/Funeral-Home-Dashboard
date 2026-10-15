/**
 * Manors RBAC production migration (2026-09). Client-side fetch wrappers
 * around `/api/organization/rbac/seed-case-number-manage` — mirrors
 * `lib/caseNumberingClient.ts`'s exact shape.
 *
 * Safe onboarding (2026-10): inert for every organization but Manors — the
 * status check answers "not applicable" without any request, and execute
 * refuses without any request, so the control can never appear or fire
 * for Gus (or any other tenant).
 */

/** The only organization this migration applies to (kept in sync with
    services/roleService.ts#MANORS_RBAC_MIGRATION_ORGANIZATION_ID, which is
    server-only). */
export const MANORS_RBAC_MIGRATION_ORGANIZATION_ID = 'managed-cremations';

export function isManorsRbacMigrationOrganization(organizationId: string | null | undefined): boolean {
  return organizationId === MANORS_RBAC_MIGRATION_ORGANIZATION_ID;
}

async function parseJsonOrThrow(response: Response): Promise<Record<string, unknown>> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof body.error === 'string' ? body.error : 'Something went wrong. Please try again.';
    throw new Error(message);
  }
  return body;
}

export type ManorsCaseNumberManageMigrationStatus = {
  organizationId: string;
  applicable: boolean;
  needsMigration: boolean;
  permissionKey?: string;
  administratorGranted?: boolean;
  funeralDirectorGranted?: boolean;
};

export type ManorsCaseNumberManageMigrationResult = ManorsCaseNumberManageMigrationStatus & {
  administratorNewlyGranted: boolean;
  funeralDirectorNewlyGranted: boolean;
};

export async function fetchManorsCaseNumberManageMigrationStatus(organizationId: string): Promise<ManorsCaseNumberManageMigrationStatus> {
  if (!isManorsRbacMigrationOrganization(organizationId)) {
    return { organizationId, applicable: false, needsMigration: false };
  }
  const params = new URLSearchParams({ organizationId });
  const response = await fetch(`/api/organization/rbac/seed-case-number-manage?${params.toString()}`);
  const body = await parseJsonOrThrow(response);
  return body as unknown as ManorsCaseNumberManageMigrationStatus;
}

export async function executeManorsCaseNumberManageMigration(organizationId: string): Promise<ManorsCaseNumberManageMigrationResult> {
  if (!isManorsRbacMigrationOrganization(organizationId)) {
    throw new Error('This action is only available for the Manors organization.');
  }
  const response = await fetch('/api/organization/rbac/seed-case-number-manage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ organizationId }),
  });
  const body = await parseJsonOrThrow(response);
  return body as unknown as ManorsCaseNumberManageMigrationResult;
}
