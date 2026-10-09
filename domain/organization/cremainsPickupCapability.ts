import type { Organization } from '../../types/organization';
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

export type CremainsPickupSettings = {
  /** Master switch. False (or an unconfigured organization) means no
      automatic scheduling and no cremains events anywhere. */
  automaticSchedulingEnabled: boolean;
  /** Calendar days between paperwork completion and the earliest pickup. */
  minimumProcessingDays: number;
  /** Which weekdays this organization's crematory releases cremains on. */
  allowedPickupWeekdays: readonly Weekday[];
  /**
   * Which workflow stage represents "crematory paperwork has been sent".
   *
   * A canonical `displayStage` index plus the stage label it is expected
   * to carry. The INDEX is the stable identifier; the label is a SHAPE
   * GUARD, not a lookup key — the same discipline
   * domain/organization/workflowStagePresentation.ts uses. If a template
   * is restructured so the label no longer matches, scheduling stops
   * rather than firing off the wrong stage.
   *
   * Scheduling triggers when EVERY checklist item in this stage is
   * complete — i.e. the paperwork was genuinely sent — never merely
   * because the case entered the stage.
   */
  paperworkStage: { displayStage: number; expectedLabel: string };
  /**
   * The existing checklist item that already means "cremains are
   * physically here". Receipt integrates with this item rather than
   * introducing a competing source of truth.
   */
  receiptChecklistItem: { displayStage: number; index: number; expectedLabel: string };
};

/** Manors' stable organization id — the same constant the other
    capability modules already key on. */
export const MANORS_ORGANIZATION_ID = 'managed-cremations';

/**
 * Per-organization configuration, used until the live Wix field exists.
 *
 * Manors Cremation: Tuesdays and Fridays, seven calendar days. Confirmed
 * with the business, not inferred.
 */
export const ORGANIZATION_DEFAULTS: Record<string, CremainsPickupSettings> = {
  [MANORS_ORGANIZATION_ID]: {
    automaticSchedulingEnabled: true,
    minimumProcessingDays: DEFAULT_MINIMUM_PROCESSING_DAYS,
    allowedPickupWeekdays: DEFAULT_PICKUP_WEEKDAYS,
    // Read from Manors' own live workflow snapshot, not guessed: display
    // stage 3 holds "Permit sent to crematory" and "Authorization of
    // release sent to crematory".
    paperworkStage: { displayStage: 3, expectedLabel: 'Permit & Authorization Sent to Crematory' },
    // Display stage 5, item 0 — the item Manors already uses to record
    // that the ashes are back.
    receiptChecklistItem: { displayStage: 5, index: 0, expectedLabel: 'Ashes picked up (Tue/Fri)' },
  },
};

/** What an organization with no configuration at all gets: nothing
    changes for it. */
export const DISABLED_SETTINGS: CremainsPickupSettings = {
  automaticSchedulingEnabled: false,
  minimumProcessingDays: DEFAULT_MINIMUM_PROCESSING_DAYS,
  allowedPickupWeekdays: DEFAULT_PICKUP_WEEKDAYS,
  // Never matched by the shape guard, so a disabled organization can
  // never accidentally resolve a trigger stage.
  paperworkStage: { displayStage: -1, expectedLabel: '' },
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
  const fallback = (organizationId && ORGANIZATION_DEFAULTS[organizationId]) || DISABLED_SETTINGS;
  if (organization && organization.cremainsPickupSettings !== undefined && organization.cremainsPickupSettings !== null) {
    return normalize(organization.cremainsPickupSettings, fallback);
  }
  return fallback;
}

/** Convenience for callers that only have an id and no record yet. */
export function resolveCremainsPickupSettingsById(organizationId: string | null | undefined): CremainsPickupSettings {
  if (!organizationId) return DISABLED_SETTINGS;
  return ORGANIZATION_DEFAULTS[organizationId] ?? DISABLED_SETTINGS;
}

export function isCremainsSchedulingEnabled(
  organization: (Pick<Organization, 'id'> & { cremainsPickupSettings?: unknown }) | null | undefined,
): boolean {
  return resolveCremainsPickupSettings(organization).automaticSchedulingEnabled;
}
