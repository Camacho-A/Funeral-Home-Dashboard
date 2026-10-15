import type { Organization } from '../../types/organization';
import { getRegisteredOrganizationProfile, registeredProfileMap, type CremainsPickupSettings } from './organizationProfiles';
import {
  DEFAULT_MINIMUM_PROCESSING_DAYS,
  DEFAULT_PICKUP_WEEKDAYS,
  type Weekday,
} from '../scheduling/cremainsPickupSchedule';

/**
 * Expected Cremains Pickup — organization capability (2026-10).
 *
 * The single place "does this organization schedule cremains pickups, and
 * on what cadence?" is resolved. Mirrors
 * domain/organization/familyPortalCapability.ts and moduleVisibility.ts:
 * one small pure module per capability, keyed on the stable
 * `organizationId`, never an `organizationId === '…'` check scattered
 * through a route or component, and never a display-name comparison.
 *
 * DEFAULT POLARITY IS OPT-IN, DELIBERATELY.
 *
 * This matches `ADVANCED_MODULE_KEYS`'s allowlist polarity rather than
 * Family Portal's: automatic cremains scheduling is a brand-new behavior
 * that creates calendar events, so an organization that has not been
 * configured for it must keep its existing behavior exactly — nothing is
 * scheduled, nothing appears on its calendar. Only an organization with
 * real configuration participates. Gus Camacho Jr. Funeral Home and every
 * other tenant are therefore unaffected until explicitly configured.
 *
 * WHY THE CONFIGURATION LIVES HERE RATHER THAN IN WIX DATA (for now)
 *
 * `Organization` already carries optional capability fields that are
 * "fully wired end-to-end (type, Wix mapper)" ahead of the live Wix field
 * existing — see `familyPortalEnabled`'s own note. The same applies here:
 * `cremainsPickupSettings` is read from the Organization record when
 * present, and falls back to the per-organization defaults below. Once the
 * live field exists and is populated, `ORGANIZATION_DEFAULTS` can simply
 * be emptied; no other file changes. This keeps the feature additive and
 * requires no production schema migration to ship.
 */

export type { CremainsPickupSettings };
export { MANORS_ORGANIZATION_ID } from './organizationProfiles';

/**
 * Per-organization configuration, used until the live Wix field exists.
 *
 * 2026-10: each organization's settings now live in its profile
 * (`features.cremainsPickup`, domain/organization/organizationProfiles.ts —
 * Manors: Tuesdays and Fridays, seven calendar days, confirmed with the
 * business). This map is derived from that registry, kept for existing
 * importers.
 */
export const ORGANIZATION_DEFAULTS: Record<string, CremainsPickupSettings> = registeredProfileMap(
  (profile) => profile.features.cremainsPickup as CremainsPickupSettings,
  (profile) => profile.features.cremainsPickup !== null,
);

function profileSettings(organizationId: string | null | undefined): CremainsPickupSettings | null {
  return organizationId ? getRegisteredOrganizationProfile(organizationId).features.cremainsPickup : null;
}

/** What an organization with no configuration at all gets: nothing
    changes for it. */
export const DISABLED_SETTINGS: CremainsPickupSettings = {
  automaticSchedulingEnabled: false,
  minimumProcessingDays: DEFAULT_MINIMUM_PROCESSING_DAYS,
  allowedPickupWeekdays: DEFAULT_PICKUP_WEEKDAYS,
  // Never matched by the shape guard, so a disabled organization can
  // never accidentally resolve a trigger stage.
  paperworkStage: { displayStage: -1, expectedLabel: '', items: [] },
  receiptChecklistItem: { displayStage: -1, index: -1, expectedLabel: '' },
};

function isWeekday(value: unknown): value is Weekday {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 6;
}

/**
 * Normalizes a stored settings blob, ignoring anything malformed rather
 * than letting it produce a nonsensical schedule. An unusable field falls
 * back to the organization's default for that field alone — never
 * silently disabling a configured organization, and never enabling an
 * unconfigured one.
 */
function normalize(raw: unknown, fallback: CremainsPickupSettings): CremainsPickupSettings {
  if (!raw || typeof raw !== 'object') return fallback;
  const candidate = raw as Partial<Record<keyof CremainsPickupSettings, unknown>>;

  const weekdays = Array.isArray(candidate.allowedPickupWeekdays)
    ? candidate.allowedPickupWeekdays.filter(isWeekday)
    : null;

  const minimum =
    typeof candidate.minimumProcessingDays === 'number' &&
    Number.isInteger(candidate.minimumProcessingDays) &&
    candidate.minimumProcessingDays >= 0
      ? candidate.minimumProcessingDays
      : fallback.minimumProcessingDays;

  return {
    automaticSchedulingEnabled:
      typeof candidate.automaticSchedulingEnabled === 'boolean'
        ? candidate.automaticSchedulingEnabled
        : fallback.automaticSchedulingEnabled,
    minimumProcessingDays: minimum,
    // An explicitly empty weekday list would make scheduling impossible,
    // so it is treated as unconfigured rather than as "never pick up".
    allowedPickupWeekdays: weekdays && weekdays.length > 0 ? weekdays : fallback.allowedPickupWeekdays,
    // Trigger coordinates are deliberately NOT client-overridable through
    // this blob — a wrong stage index would schedule off the wrong task.
    // They come from the organization's own default entry only.
    paperworkStage: fallback.paperworkStage,
    receiptChecklistItem: fallback.receiptChecklistItem,
  };
}

/**
 * This organization's cremains-pickup settings.
 *
 * Resolution order: the Organization record's own stored settings, then
 * the per-organization default above, then disabled.
 */
export function resolveCremainsPickupSettings(
  organization: (Pick<Organization, 'id'> & { cremainsPickupSettings?: unknown }) | null | undefined,
): CremainsPickupSettings {
  const organizationId = organization?.id;
  const fallback = profileSettings(organizationId) ?? DISABLED_SETTINGS;
  if (organization && organization.cremainsPickupSettings !== undefined && organization.cremainsPickupSettings !== null) {
    return normalize(organization.cremainsPickupSettings, fallback);
  }
  return fallback;
}

/** Convenience for callers that only have an id and no record yet. */
export function resolveCremainsPickupSettingsById(organizationId: string | null | undefined): CremainsPickupSettings {
  if (!organizationId) return DISABLED_SETTINGS;
  return profileSettings(organizationId) ?? DISABLED_SETTINGS;
}

export function isCremainsSchedulingEnabled(
  organization: (Pick<Organization, 'id'> & { cremainsPickupSettings?: unknown }) | null | undefined,
): boolean {
  return resolveCremainsPickupSettings(organization).automaticSchedulingEnabled;
}
