import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { requireSameOrigin } from '@/lib/auth/csrf';
import { requirePlatformAdministrator } from '@/lib/auth/requireOnboardingAccess';
import { getDataAdapterMode } from '@/lib/env';
import { parseJsonBody } from '@/lib/auth/routeHelpers';
import {
  runDefaultRoleReconciliation,
  isGlobalRbacMutationAllowed,
  GLOBAL_RECONCILIATION_CONFIRMATION,
} from '@/services/rbacReconciliationService';

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
 *
 * Safe onboarding (2026-10): `apply` is refused (409) on any deployment
 * restricted by DEPLOYMENT_ORGANIZATION_IDS (e.g. the Gus deployment) —
 * one tenant's deployment must never change other tenants' permissions —
 * and, where it is allowed, requires `confirm: 'apply-to-all-organizations'`.
 * `dry_run` stays available everywhere (read-only).
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

  if (mode === 'apply') {
    if (!isGlobalRbacMutationAllowed()) {
      return NextResponse.json(
        {
          error:
            'Global RBAC reconciliation cannot be applied from a deployment restricted to specific organizations — the default-role grants are shared by every organization. Use dry_run.',
          code: 'global_rbac_mutation_refused',
        },
        { status: 409 },
      );
    }
    if (parsed.body.confirm !== GLOBAL_RECONCILIATION_CONFIRMATION) {
      return NextResponse.json(
        {
          error: `apply changes the default-role grants of EVERY organization; resend with confirm: '${GLOBAL_RECONCILIATION_CONFIRMATION}' after reviewing a dry_run.`,
          code: 'confirmation_required',
        },
        { status: 400 },
      );
    }
  }

  const record = await runDefaultRoleReconciliation(
    { mode, actor: access.session.user.id, idFactory: () => crypto.randomUUID() },
    getDataAdapterMode(),
  );

  return NextResponse.json({ record });
}
