import type { Organization } from '../../types/organization';
import type { ChecklistItemTemplate } from '../../types/workflowTemplate';
import type { HideableModuleKey } from './moduleVisibility';
import {
  DEFAULT_MINIMUM_PROCESSING_DAYS,
  DEFAULT_PICKUP_WEEKDAYS,
  type Weekday,
} from '../scheduling/cremainsPickupSchedule';

/**
 * Organization profiles (2026-10, multi-tenant hardening).
 *
 * The ONE place organization-specific configuration lives. Before this
 * module every Manors-only behaviour was a separate
 * `MANORS_ORGANIZATION_ID = 'managed-cremations'` check scattered across a
 * dozen capability modules; each of those now asks this module instead,
 * so onboarding another funeral home is one entry in
 * `ORGANIZATION_PROFILES` below (or, once the matching Wix fields exist,
 * nothing at all — just Organization record fields).
 *
 * Deliberately pure and client-safe: no I/O, no server-only imports, and
 * no large assets. The Manors logo is referenced by KEY
 * (`letterhead.logoAssetKey`) and resolved only by the billing layer
 * (domain/billing/organizationStatementOverrides.ts), so importing this
 * module from a Client Component never drags the base64 logo into the
 * browser bundle.
 *
 * RESOLUTION ORDER — `getOrganizationProfile(organizationId, record?)`:
 *
 *   1. explicit Organization record fields, when present
 *      (`name`, `legalName`, `caseNumberPrefix`, `familyPortalEnabled`,
 *      `signatureRequestsEnabled`, `hiddenModules`);
 *   2. the registered profile for that organizationId;
 *   3. `PLATFORM_DEFAULT_PROFILE`.
 *
 * One disclosed exception: a profile may PIN a feature (`pinnedFeatures`)
 * so the profile wins over the record. Manors pins the three features whose
 * Wix fields do not exist live yet (`familyPortalEnabled`,
 * `signatureRequestsEnabled`, `hiddenModules`) — that reproduces exactly
 * the pre-existing "TEMPORARY override checked before the record" semantics
 * those modules always had, so Manors' behaviour is unchanged. Unpin once
 * the live Wix fields exist and are populated. Letterhead is likewise
 * profile-over-record when a profile supplies it, because Manors' live
 * Organization/Location rows still carry onboarding placeholders and the
 * data model has no fax/logo field (see organizationStatementOverrides.ts).
 *
 * No Wix schema change is required by anything here.
 */

// ---------------------------------------------------------------------------
// Organization ids
// ---------------------------------------------------------------------------

/** Manor's Cremation — the original tenant. Case prefix `B`. */
export const MANORS_ORGANIZATION_ID = 'managed-cremations';

/** Gus Camacho Jr. Funeral Home. Case prefix `M`. */
export const GUS_CAMACHO_ORGANIZATION_ID = 'gus-camacho-jr';

// ---------------------------------------------------------------------------
// Capability config shapes (owned here; re-exported by each capability
// module so existing imports keep working)
// ---------------------------------------------------------------------------

/** See domain/organization/checklistRetirement.ts. */
export type RetiredChecklistItem = {
  /** Canonical display stage the item belongs to. */
  displayStage: number;
  /** Position within that stage's checklist — the stable identifier. */
  index: number;
  /** The label that index must carry for the retirement to apply. */
  expectedLabel: string;
};

/** See domain/organization/medicalExaminerWorkflow.ts. */
export type MedicalExaminerStageConfig = {
  displayStage: number;
  /** Indices replaced when the case is a Medical Examiner case. */
  replacedIndices: readonly number[];
  /** Each replaced index's expected label — the shape guard. A list of
      alternatives accepts any one of them, so a template that has since
      been relabelled still matches rather than silently opting out. */
  expectedLabels: readonly (string | readonly string[])[];
  /** The items shown instead, at indices the standard template never uses
      so neither set can overwrite the other. May be empty: an ME case can
      simply not be ASKED something, with nothing substituted. */
  verificationItems: readonly ChecklistItemTemplate[];
};

/** See domain/organization/cremainsPickupCapability.ts. */
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
   * The INDEX is the stable identifier; the label is a SHAPE GUARD, not a
   * lookup key. Scheduling triggers when every item in `items` is complete.
   */
  paperworkStage: {
    displayStage: number;
    expectedLabel: string;
    /** The specific checklist items that constitute "the paperwork was
        sent", by stable in-stage index, each with a per-item label guard. */
    items: ReadonlyArray<{ index: number; expectedLabel: string }>;
  };
  /** The existing checklist item that already means "cremains are
      physically here". */
  receiptChecklistItem: { displayStage: number; index: number; expectedLabel: string };
};

// ---------------------------------------------------------------------------
// Profile shapes
// ---------------------------------------------------------------------------

/**
 * Statement / Receipt letterhead. Every field is nullable: `null` means
 * "fall back to the Organization record / primary Location" for that field.
 * A profile with `letterhead: null` gets an entirely record-driven header.
 */
export type OrganizationLetterhead = {
  /** Business name as printed on the document header. */
  name: string | null;
  /** Literal address lines (street, then city/state/zip). */
  addressLines: readonly string[] | null;
  phone: string | null;
  fax: string | null;
  email: string | null;
  website: string | null;
  /** Key into the billing layer's logo-asset map — never the bytes
      themselves (see this file's header comment). */
  logoAssetKey: string | null;
};

/** Receipt of Payment footer when the legal entity differs from the
    trading name. `null` = derive from the provider name. */
export type OrganizationReceiptFooter = {
  thanksLine: string;
  legalEntityLine: string | null;
};

export type OrganizationFeaturePreferences = {
  /** Family Portal. Platform default: enabled. */
  familyPortalEnabled: boolean;
  /** Staff-initiated Signature Requests. Platform default: enabled. */
  signatureRequestsEnabled: boolean;
  /** Document Archive action. Platform default: enabled. */
  documentArchivingEnabled: boolean;
  /** Expected Cremains Pickup scheduling. `null` = opt-in not configured
      (nothing is scheduled). */
  cremainsPickup: CremainsPickupSettings | null;
  /** Case Owner editor in Case Information. Platform default: shown. */
  caseOwnerVisible: boolean;
  /** Cash Advance Items section on the Statement and BillingCard.
      Platform default: shown. */
  cashAdvanceOnStatement: boolean;
  /** Core, visible-by-default modules this organization hides. */
  hiddenModules: readonly HideableModuleKey[];
  /** Medical Examiner checklist variant. Empty = no variant. */
  medicalExaminerStages: readonly MedicalExaminerStageConfig[];
  /** Checklist items retired (hidden, never deleted). Empty = none. */
  retiredChecklistItems: readonly RetiredChecklistItem[];
  /** Presentation-only intake overlay (workflowStagePresentation.ts):
      render canonical stages 0+1 as one "Intake & JotForm" stage. */
  combineIntakeStages: boolean;
  /** Uppercase the combined intake stage's checklist labels. Only ever
      applies together with `combineIntakeStages`. */
  uppercaseCombinedIntakeLabels: boolean;
  /** "Additional Items & Services" wording for adding to an existing Case
      Order (caseOrderTerminology.ts). Platform default: "Edit Services". */
  additionalItemsTerminology: boolean;
  /** Legacy Certifier relabel for frozen pre-v5 snapshots
      (domain/cases/legacyCertifierPresentation.ts). */
  legacyCertifierPresentation: boolean;
};

/** Features whose value can also come from an Organization record field —
    and which a profile may therefore pin. */
export type PinnableFeature = 'familyPortalEnabled' | 'signatureRequestsEnabled' | 'hiddenModules';

export type OrganizationNotificationPreferences = {
  /** Display name for outbound transactional email. `null` = platform
      sender ("SOLIS"; see lib/email/resendClient.ts). Not yet wired per
      organization — the Resend client is platform-level today. */
  senderDisplayName: string | null;
  /** Reply-To for outbound email. `null` = `RESEND_REPLY_TO_ADDRESS`. */
  replyToAddress: string | null;
};

/**
 * Integration placeholders. Informational only — nothing here holds a
 * credential. Payment credentials stay in `PaymentIntegration` records as
 * env-var REFERENCE NAMES (types/payment.ts); JotForm configuration stays
 * in external-form integration records (domain/externalForms/**).
 */
export type OrganizationIntegrations = {
  jotform: 'externalFormIntegration' | 'none';
  payments: 'clover' | 'none';
  calendar: 'none';
};

export type OrganizationProfile = {
  displayName: string | null;
  /** Short staff-facing name, e.g. the VA "who is handling it" button. */
  shortName: string | null;
  legalName: string | null;
  /** Default case-number prefix. `null` = platform default (see
      domain/cases/caseNumber.ts). The record's `caseNumberPrefix` wins. */
  caseNumberPrefix: string | null;
  letterhead: OrganizationLetterhead | null;
  receiptFooter: OrganizationReceiptFooter | null;
  /** Explicit VA-responsibility button label. `null` = derived from the
      short/display name. */
  vaNotificationLabel: string | null;
  features: OrganizationFeaturePreferences;
  /** Features where the profile wins over the Organization record. */
  pinnedFeatures: readonly PinnableFeature[];
  notifications: OrganizationNotificationPreferences;
  integrations: OrganizationIntegrations;
};

/** What a registry entry may specify — anything omitted inherits the
    platform default. */
export type OrganizationProfileEntry = Partial<Omit<OrganizationProfile, 'features'>> & {
  features?: Partial<OrganizationFeaturePreferences>;
};

export type ResolvedOrganizationProfile = OrganizationProfile & {
  organizationId: string;
  /** Whether a registered profile exists for this id. */
  registered: boolean;
};

// ---------------------------------------------------------------------------
// Platform defaults
// ---------------------------------------------------------------------------

export const PLATFORM_DEFAULT_FEATURES: Readonly<OrganizationFeaturePreferences> = Object.freeze<OrganizationFeaturePreferences>({
  familyPortalEnabled: true,
  signatureRequestsEnabled: true,
  documentArchivingEnabled: true,
  cremainsPickup: null,
  caseOwnerVisible: true,
  cashAdvanceOnStatement: true,
  hiddenModules: [],
  medicalExaminerStages: [],
  retiredChecklistItems: [],
  combineIntakeStages: false,
  uppercaseCombinedIntakeLabels: false,
  additionalItemsTerminology: false,
  legacyCertifierPresentation: false,
});

export const PLATFORM_DEFAULT_PROFILE: Readonly<OrganizationProfile> = Object.freeze<OrganizationProfile>({
  displayName: null,
  shortName: null,
  legalName: null,
  caseNumberPrefix: null,
  letterhead: null,
  receiptFooter: null,
  vaNotificationLabel: null,
  features: PLATFORM_DEFAULT_FEATURES,
  pinnedFeatures: [],
  notifications: { senderDisplayName: null, replyToAddress: null },
  integrations: { jotform: 'none', payments: 'none', calendar: 'none' },
});

/** Used when neither the record nor a profile supplies a name. */
export const GENERIC_ORGANIZATION_SHORT_NAME = 'Funeral Home';

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/**
 * Manor's Cremation. Every value below was moved verbatim from the
 * capability module that previously hardcoded it; see each module's own
 * comment for the business reasoning.
 */
const MANORS_PROFILE: OrganizationProfileEntry = {
  displayName: "Manor's Cremation",
  shortName: 'Manors',
  legalName: 'Cremations America of Broward, LLC',
  caseNumberPrefix: 'B',
  letterhead: {
    name: 'MANORS CREMATION SERVICES',
    addressLines: ['481 E Commercial Blvd', 'Oakland Park, FL 33334'],
    phone: '954-884-5770',
    fax: '305-603-9250',
    email: 'contact@manorscremation.com',
    website: null,
    logoAssetKey: 'manors-logo',
  },
  receiptFooter: {
    thanksLine: 'Thank you for your trust in Cremations America of Broward, LLC',
    legalEntityLine: 'DBA MANORS CREMATION',
  },
  vaNotificationLabel: 'MANORS',
  features: {
    familyPortalEnabled: false,
    signatureRequestsEnabled: false,
    documentArchivingEnabled: false,
    caseOwnerVisible: false,
    cashAdvanceOnStatement: false,
    hiddenModules: ['accounting-chart-of-accounts', 'accounting-journal-entries', 'accounting-banking', 'reports-staff', 'reports-documents'],
    combineIntakeStages: true,
    uppercaseCombinedIntakeLabels: true,
    additionalItemsTerminology: true,
    legacyCertifierPresentation: true,
    // Tuesdays and Fridays, seven calendar days — confirmed with the
    // business. Coordinates read from Manors' own live workflow snapshot.
    cremainsPickup: {
      automaticSchedulingEnabled: true,
      minimumProcessingDays: DEFAULT_MINIMUM_PROCESSING_DAYS,
      allowedPickupWeekdays: DEFAULT_PICKUP_WEEKDAYS,
      paperworkStage: {
        displayStage: 3,
        expectedLabel: 'Permit & Authorization Sent to Crematory',
        items: [
          { index: 0, expectedLabel: 'Permit sent to crematory' },
          { index: 1, expectedLabel: 'Authorization of release sent to crematory' },
        ],
      },
      receiptChecklistItem: { displayStage: 5, index: 0, expectedLabel: 'Ashes picked up (Tue/Fri)' },
    },
    retiredChecklistItems: [
      // "Ready for Pickup / Contact Family", item 1 — Manors no longer
      // photographs the tag.
      { displayStage: 5, index: 1, expectedLabel: 'Tag photo taken' },
      // Duplicate of "Payment collected" (index 8). Retired, not deleted,
      // so no stored checklistState key shifts meaning.
      { displayStage: 0, index: 9, expectedLabel: 'Credit card payment collected by phone' },
    ],
    medicalExaminerStages: [
      // "First Call & Payment" — ME-owned items are simply not asked at
      // intake on an ME case; nothing substituted, nothing marked done.
      {
        displayStage: 0,
        replacedIndices: [3, 5, 6],
        expectedLabels: [
          'Weight',
          'Time of death',
          // Both the current and the pre-2026-09 label, so an older frozen
          // snapshot still matches.
          ['Certifier Information', 'Certifier name & phone'],
        ],
        verificationItems: [],
      },
      // "EDRS & Doctor / Cause of Death" — staff verify the ME's work.
      {
        displayStage: 2,
        replacedIndices: [0, 1, 2],
        expectedLabels: [
          'EDRS submitted & sent to doctor',
          'Cause of death entered',
          'Hardsave for state approval if not an online doctor',
        ],
        verificationItems: [
          { index: 3, label: 'Medical Examiner EDRS entry verified', hasField: false },
          { index: 4, label: 'Medical Examiner cause of death verified', hasField: false },
          { index: 5, label: 'Required ME information confirmed', hasField: false },
        ],
      },
    ],
  },
  // TEMPORARY: these Wix fields are not live yet; the profile must keep
  // winning over the record exactly as the old overrides did.
  pinnedFeatures: ['familyPortalEnabled', 'signatureRequestsEnabled', 'hiddenModules'],
  integrations: { jotform: 'externalFormIntegration', payments: 'clover', calendar: 'none' },
};

/**
 * Gus Camacho Jr. Funeral Home. Platform defaults everywhere — no Manors
 * business decision is inherited. Letterhead/legal name are deliberately
 * `null` (TO BE CONFIGURED): the Statement and Receipt then render from
 * Gus's own Organization record and primary Location, never from invented
 * data. Fill these in (or the record fields) once Gus confirms them.
 */
const GUS_CAMACHO_PROFILE: OrganizationProfileEntry = {
  displayName: 'Gus Camacho Jr. Funeral Home',
  shortName: 'Gus Camacho Jr.',
  legalName: null, // TO BE CONFIGURED — falls back to Organization.legalName.
  caseNumberPrefix: 'M',
  letterhead: null, // TO BE CONFIGURED — falls back to Organization/Location.
  receiptFooter: null,
  vaNotificationLabel: null,
};

/**
 * Registered profiles. Adding a funeral home = one entry here (or nothing,
 * when platform defaults + its Organization record suffice).
 */
export const ORGANIZATION_PROFILES: Readonly<Record<string, OrganizationProfileEntry>> = Object.freeze({
  [MANORS_ORGANIZATION_ID]: MANORS_PROFILE,
  [GUS_CAMACHO_ORGANIZATION_ID]: GUS_CAMACHO_PROFILE,
});

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

function mergeEntry(entry: OrganizationProfileEntry | undefined): OrganizationProfile {
  if (!entry) return PLATFORM_DEFAULT_PROFILE;
  return {
    ...PLATFORM_DEFAULT_PROFILE,
    ...entry,
    features: { ...PLATFORM_DEFAULT_FEATURES, ...(entry.features ?? {}) },
    notifications: { ...PLATFORM_DEFAULT_PROFILE.notifications, ...(entry.notifications ?? {}) },
    integrations: { ...PLATFORM_DEFAULT_PROFILE.integrations, ...(entry.integrations ?? {}) },
  };
}

/** The registered profile merged over platform defaults, ignoring any
    Organization record. Use when only an id is available. */
export function getRegisteredOrganizationProfile(organizationId: string | null | undefined): OrganizationProfile {
  return mergeEntry(organizationId ? ORGANIZATION_PROFILES[organizationId] : undefined);
}

export function hasRegisteredOrganizationProfile(organizationId: string | null | undefined): boolean {
  return Boolean(organizationId && Object.prototype.hasOwnProperty.call(ORGANIZATION_PROFILES, organizationId));
}

export function isFeaturePinned(organizationId: string | null | undefined, feature: PinnableFeature): boolean {
  return getRegisteredOrganizationProfile(organizationId).pinnedFeatures.includes(feature);
}

function nonEmpty(value: string | null | undefined): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

type OrganizationRecordInput = Partial<
  Pick<Organization, 'name' | 'legalName' | 'caseNumberPrefix' | 'familyPortalEnabled' | 'signatureRequestsEnabled' | 'hiddenModules'>
> | null;

/**
 * The effective profile for one organization: explicit record fields >
 * registered profile > platform defaults (pinned features excepted — see
 * the header comment).
 */
export function getOrganizationProfile(
  organizationId: string | null | undefined,
  organizationRecord?: OrganizationRecordInput,
): ResolvedOrganizationProfile {
  const base = getRegisteredOrganizationProfile(organizationId);
  const record = organizationRecord ?? null;
  const pinned = new Set(base.pinnedFeatures);

  const features: OrganizationFeaturePreferences = { ...base.features };
  if (record) {
    if (!pinned.has('familyPortalEnabled') && typeof record.familyPortalEnabled === 'boolean') {
      features.familyPortalEnabled = record.familyPortalEnabled;
    }
    if (!pinned.has('signatureRequestsEnabled') && typeof record.signatureRequestsEnabled === 'boolean') {
      features.signatureRequestsEnabled = record.signatureRequestsEnabled;
    }
    if (!pinned.has('hiddenModules') && Array.isArray(record.hiddenModules)) {
      features.hiddenModules = record.hiddenModules as HideableModuleKey[];
    }
  }

  return {
    ...base,
    organizationId: organizationId ?? '',
    registered: hasRegisteredOrganizationProfile(organizationId),
    displayName: nonEmpty(record?.name) ?? base.displayName,
    legalName: nonEmpty(record?.legalName) ?? base.legalName,
    caseNumberPrefix: nonEmpty(record?.caseNumberPrefix) ?? base.caseNumberPrefix,
    features,
  };
}

/** Short staff-facing name: profile short name, else display name, else
    the generic "Funeral Home". */
export function organizationShortName(profile: Pick<OrganizationProfile, 'shortName' | 'displayName'>): string {
  return nonEmpty(profile.shortName) ?? nonEmpty(profile.displayName) ?? GENERIC_ORGANIZATION_SHORT_NAME;
}

/**
 * Builds a `{ organizationId: value }` map of the registered profiles whose
 * value differs from the platform default (optionally only pinned ones).
 * Used to keep the capability modules' historical exported maps
 * (`ORGANIZATION_OVERRIDES`, `HIDDEN_MODULE_OVERRIDES`, …) available for
 * existing importers, now derived from this registry.
 */
export function registeredProfileMap<T>(
  select: (profile: OrganizationProfile) => T,
  include: (profile: OrganizationProfile, organizationId: string) => boolean,
): Record<string, T> {
  const out: Record<string, T> = {};
  for (const organizationId of Object.keys(ORGANIZATION_PROFILES)) {
    const profile = getRegisteredOrganizationProfile(organizationId);
    if (include(profile, organizationId)) out[organizationId] = select(profile);
  }
  return out;
}

// ---------------------------------------------------------------------------
// VA notification responsibility (types/case.ts#VaNotificationResponsibility)
// ---------------------------------------------------------------------------

/**
 * The stored value `'manors'` predates multi-tenancy and is kept as-is for
 * backward compatibility (never rewritten in stored data): it is the legacy
 * KEY for "this funeral home is handling the VA notification", whichever
 * funeral home that is. Only its LABEL is organization-specific.
 */
export const VA_FUNERAL_HOME_RESPONSIBILITY_KEY = 'manors' as const;

/** Button label for the "this funeral home" choice — the profile's explicit
    label (Manors: "MANORS"), else its short/display name uppercased, else
    "FUNERAL HOME". */
export function vaNotificationFuneralHomeLabel(profile: Pick<OrganizationProfile, 'vaNotificationLabel' | 'shortName' | 'displayName'>): string {
  return nonEmpty(profile.vaNotificationLabel) ?? organizationShortName(profile).toUpperCase();
}

/** "Manors staff" / "Gus Camacho Jr. staff" / "funeral home staff". */
export function vaNotificationStaffPhrase(profile: Pick<OrganizationProfile, 'shortName' | 'displayName'>): string {
  const name = nonEmpty(profile.shortName) ?? nonEmpty(profile.displayName);
  return name ? `${name} staff` : 'funeral home staff';
}
