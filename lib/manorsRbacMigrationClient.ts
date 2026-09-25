/**
 * Manors RBAC production migration (2026-09). Client-side fetch wrappers
 * around `/api/organization/rbac/seed-case-number-manage` — mirrors
 * `lib/caseNumberingClient.ts`'s exact shape.
 */

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
  const params = new URLSearchParams({ organizationId });
  const response = await fetch(`/api/organization/rbac/seed-case-number-manage?${params.toString()}`);
  const body = await parseJsonOrThrow(response);
  return body as unknown as ManorsCaseNumberManageMigrationStatus;
}

export async function executeManorsCaseNumberManageMigration(organizationId: string): Promise<ManorsCaseNumberManageMigrationResult> {
  const response = await fetch('/api/organization/rbac/seed-case-number-manage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ organizationId }),
  });
  const body = await parseJsonOrThrow(response);
  return body as unknown as ManorsCaseNumberManageMigrationResult;
}
