import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { requirePlatformAdministrator } from '@/lib/auth/requireOnboardingAccess';
import { getDataAdapterMode } from '@/lib/env';
import { parseJsonBody } from '@/lib/auth/routeHelpers';
import { runDefaultRoleReconciliation } from '@/services/rbacReconciliationService';

/**
 * Phase 38 (RBAC Grant Hygiene & Authorization Integrity). Runs a GLOBAL
 * platform-default-role grant reconciliation.
 *
 * Because the default roles are platform-global (org-null, shared by every
 * tenant), a mutation here affects ALL organizations — so this is gated by
 * PLATFORM ADMINISTRATOR (env allowlist), not a tenant `organization.manage`
 * grant. `dry_run` is read-only (safe preview); `apply` performs the additive
 * inserts + createdAt backfills and persists a PLATFORM-scoped reconciliation
 * record. Manual invocation only — nothing runs at startup or on deploy (D7).
 */
export async function POST(request: Request) {
  const csrfResponse = requireSameOrigin(request);
  if (csrfResponse) return csrfResponse;

  const access = await requirePlatformAdministrator();
  if (!access.authorized) return access.response;

  const parsed = await parseJsonBody(request);
  if (!parsed.ok) return parsed.response;
  const mode = parsed.body.mode;
  if (mode !== 'dry_run' && mode !== 'apply') {
    return NextResponse.json({ error: "mode must be 'dry_run' or 'apply'." }, { status: 400 });
  }

  const record = await runDefaultRoleReconciliation(
    { mode, actor: access.session.user.id, idFactory: () => crypto.randomUUID() },
    getDataAdapterMode(),
  );

  return NextResponse.json({ record });
}
