import { NextResponse } from 'next/server';
import { requireIdentitySession } from '@/lib/auth/requireIdentitySession';
import { PERMISSION_KEYS, PERMISSION_DESCRIPTIONS, permissionCategory } from '@/domain/rbac/permissionCatalog';

/**
 * Phase 22 (Role-Based Access Control). The complete, static permission
 * catalog — the Permission Matrix and Permission Inspector UI's data
 * source. Served directly from `domain/rbac/permissionCatalog.ts` rather
 * than reading the `permissions` Wix collection: that collection is a
 * queryable mirror of this same constant (seeded once, never edited by
 * application logic — see `docs/adr/ADR-026-role-based-authorization-architecture.md`),
 * so reading the constant directly is both simpler and always exactly
 * current, with no possibility of drifting out of sync with a stale seed.
 *
 * Read-only; any authenticated identity may see the full catalog — the
 * list of what permissions *exist* is not itself sensitive information
 * (no CSRF check needed for a GET with no side effects).
 */
export async function GET() {
  const access = await requireIdentitySession();
  if (!access.authorized) return access.response;

  const permissions = PERMISSION_KEYS.map((key) => ({
    key,
    category: permissionCategory(key),
    description: PERMISSION_DESCRIPTIONS[key],
  }));

  return NextResponse.json({ permissions });
}
