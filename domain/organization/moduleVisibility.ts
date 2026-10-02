import type { Organization } from '@/types/organization';

/**
 * Manors launch-prep. The lightest possible module-visibility mechanism —
 * a flat allowlist on `Organization.enabledModules`, not a feature-flag
 * framework. Every key here is an advanced/SaaS-scale nav module that a
 * brand-new or not-yet-configured organization does not see by default;
 * an administrator can enable any of them later without touching code.
 *
 * This never touches authorization — a hidden module's routes/APIs keep
 * enforcing their own RBAC checks exactly as before. Hiding a module's nav
 * link only removes its *discovery* surface for staff who don't need it.
 *
 * `accounting` is deliberately NOT in this list — it's core financial
 * infrastructure Manor already actively uses (case payments/GL), not an
 * unused SaaS-scale module, so it's gated by the `accounting.view`
 * permission directly in Sidebar.tsx instead of by org-level module
 * configuration. See that component's own comment.
 */
export const ADVANCED_MODULE_KEYS = [
  'merchandise',
  'inventory',
  'procurement',
  'accountsPayable',
  'resources',
  'calendarIntegrations',
  // Manors branding/visibility follow-up (2026-10). Bank-statement
  // import/reconciliation — distinct from Banking itself (bank account
  // management, deposits), which Manors actively uses via real case
  // payments and stays unaffected. Unlike every other key above,
  // Reconciliation's underlying API routes also enforce this (see each
  // route's own comment) — the other keys only hide their module's nav
  // link today; this is the first to also gate the server endpoint,
  // because this task specifically asked for direct-URL/API access to
  // follow the same disabled-module behavior, not just nav discovery.
  'reconciliation',
] as const;

export type AdvancedModuleKey = (typeof ADVANCED_MODULE_KEYS)[number];

/** `enabledModules` absent/null — every pre-existing organization, plus any
    newly-provisioned one that hasn't been configured yet — means none of
    the advanced modules are shown. Deliberate safe default for Manors'
    launch; an administrator opts specific modules back in per organization. */
export function isModuleEnabled(
  organization: Pick<Organization, 'enabledModules'> | null | undefined,
  key: AdvancedModuleKey,
): boolean {
  if (!organization?.enabledModules) return false;
  return organization.enabledModules.includes(key);
}
