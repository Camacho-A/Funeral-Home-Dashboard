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
 *
 * This file also holds the OPPOSITE-polarity mechanism — see
 * `HIDEABLE_MODULE_KEYS`/`isModuleHidden` below — for hiding specific
 * already-core, visible-by-default features (Accounting sub-nav items,
 * Report categories) per organization, rather than advanced ones that
 * default to hidden.
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

/**
 * Manors accounting/reports cleanup (2026-10). An opt-OUT denylist — the
 * OPPOSITE polarity from `ADVANCED_MODULE_KEYS` above: every key here is a
 * core, already-in-use feature shown by DEFAULT to every organization
 * (same default-preserve posture `domain/organization/familyPortalCapability.ts`/
 * `signatureRequestCapability.ts` already established), not an advanced
 * module hidden until opted into. An organization only loses one of these
 * if it's explicitly listed in its own `hiddenModules`.
 */
export const HIDEABLE_MODULE_KEYS = [
  // Accounting sub-navigation (components/accounting/AccountingNav.tsx) —
  // the underlying pages/data/permissions are completely unaffected; this
  // only controls whether the nav link (and, for Reports below, the
  // report itself) is shown, exactly like ADVANCED_MODULE_KEYS above.
  'accounting-chart-of-accounts',
  'accounting-journal-entries',
  'accounting-banking',
  // Report categories (domain/reporting/reportRegistry.ts) — hides every
  // report in that category, server-side (GET /api/reports and the
  // single-report/export routes), the same enforcement precedent
  // `requiresModule` already established for Merchandise/Inventory/
  // Accounts Payable-gated reports.
  'reports-staff',
  'reports-documents',
] as const;

export type HideableModuleKey = (typeof HIDEABLE_MODULE_KEYS)[number];

/**
 * TEMPORARY (2026-10): `Organization.hiddenModules` is fully wired
 * end-to-end (type, Wix mapper) but does not exist as a live Wix Data
 * field yet — adding a new field to the live `organizations` collection
 * hit the same production collection-schema-mutation constraint
 * `domain/organization/familyPortalCapability.ts`'s own comment
 * documents for that identical situation. `MANORS_ORGANIZATION_ID`-scoped
 * override below is the immediate, disclosed mechanism, mirroring that
 * file's (and `signatureRequestCapability.ts`'s) exact precedent — this
 * is the ACTUAL live mechanism for Manors today, not a placeholder;
 * `isModuleHidden` checks it before ever consulting the real field.
 *
 * TODO(remove-after-wix-field-exists): once `hiddenModules` exists live
 * and is set for `managed-cremations`, delete the entry below (or empty
 * the whole map) — every call site already reads through `isModuleHidden`.
 */
export const MANORS_ORGANIZATION_ID = 'managed-cremations';

export const HIDDEN_MODULE_OVERRIDES: Record<string, readonly HideableModuleKey[]> = {
  [MANORS_ORGANIZATION_ID]: ['accounting-chart-of-accounts', 'accounting-journal-entries', 'accounting-banking', 'reports-staff', 'reports-documents'],
};

/** `hiddenModules` absent/null and no override — every organization,
    including every pre-existing one, sees this by default (the opposite
    default from `isModuleEnabled` above). */
export function isModuleHidden(
  organization: (Pick<Organization, 'hiddenModules'> & { id: string }) | null | undefined,
  key: HideableModuleKey,
): boolean {
  if (organization?.id && organization.id in HIDDEN_MODULE_OVERRIDES) {
    return HIDDEN_MODULE_OVERRIDES[organization.id].includes(key);
  }
  if (!organization?.hiddenModules) return false;
  return organization.hiddenModules.includes(key);
}
