/**
 * Phase 20 (Organization Onboarding & Tenant Provisioning). "Platform
 * administrator" — a capability distinct from, and broader than, any
 * `OrganizationRole` (which is always scoped to one organization a
 * membership already exists for). Creating a brand-new tenant happens
 * *before* any membership in it can exist, so it can't be gated by
 * `resolveAuthorizationContext`/`OrganizationMembership` at all — a
 * separate, narrower mechanism is needed.
 *
 * Deliberately minimal, matching this project's existing "deliberately
 * small, no granular permission matrix" philosophy (see
 * `types/organization.ts`'s `OrganizationRole` comment): a plain
 * comma-separated allowlist of user ids, read from `PLATFORM_ADMIN_USER_IDS`
 * — the same env-var-driven bootstrapping approach already used for Clover
 * credential *references* (never a database row, a role field on some
 * "users" collection this project doesn't have, or a new granular
 * permission system). See `docs/adr/ADR-024-organization-onboarding-tenant-provisioning.md`
 * for why this was chosen over building a real platform-roles system this
 * phase doesn't otherwise need.
 *
 * Works identically regardless of `AUTH_ADAPTER`/`DATA_ADAPTER` — it's a
 * pure env-var check against whatever `session.user.id` already is (a mock
 * id or a real Wix member `_id`), not a Wix Data read.
 */
export function getPlatformAdminUserIds(): string[] {
  const raw = process.env.PLATFORM_ADMIN_USER_IDS ?? '';
  return raw
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
}

export function isPlatformAdminUser(userId: string): boolean {
  return getPlatformAdminUserIds().includes(userId);
}
