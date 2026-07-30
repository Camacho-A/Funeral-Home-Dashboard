import type { Case } from '@/types/case';
import type { CaseOrder } from '@/types/caseOrder';
import type { Organization } from '@/types/organization';
import type { OrganizationBranding } from '@/types/organizationBranding';
import type { OrganizationLocation } from '@/types/organizationLocation';
import { formatCentsAsCurrency } from '@/utils/format';

/**
 * Phase 25 (Document Generation & Template Management). The strongly-typed
 * merge-field system: a fixed, documented, discoverable catalog of
 * `{{namespace.field.path}}` tokens a template body may reference — never
 * a general templating language (no loops/conditionals/arbitrary logic;
 * deliberately non-Turing-complete, both for simplicity and because
 * template bodies eventually reach a headless-Chromium render step, where
 * arbitrary logic would be a real attack surface — see
 * docs/adr/ADR-029-document-generation-and-template-management.md).
 *
 * The placeholder text below is what a *recognized but reserved* field
 * (no backing data exists — either because the feature doesn't exist in
 * Beacon at all, like funeral service scheduling, or because this
 * specific case/organization simply has no value for an otherwise-real
 * field, like a case with no CaseOrder yet) renders as — visible in the
 * generated document, never a silent blank. This is distinct from an
 * *unrecognized* token, which is a validation error (see
 * `validateMergeTokens`/`mergeTemplate` below) — the invariant is "never
 * silently fail," not "every field always has a value."
 */
export const RESERVED_FIELD_PLACEHOLDER = '[Not available]';

export type MergeFieldDataType = 'string' | 'date' | 'currency' | 'number';

export type MergeFieldCategory = 'decedent' | 'service' | 'contact' | 'organization' | 'financial' | 'case';

export type MergeSourceData = {
  case: Case;
  caseOrder: CaseOrder | null;
  organization: Organization;
  branding: OrganizationBranding | null;
  location: OrganizationLocation | null;
};

export type MergeFieldDefinition = {
  /** The exact `{{...}}` token content, e.g. 'case.decedent.fullName' —
      also this catalog's own key. */
  identifier: string;
  displayName: string;
  dataType: MergeFieldDataType;
  description: string;
  /** Shown in the Merge-Field Browser so a template author knows what a
      resolved value actually looks like. */
  exampleValue: string;
  category: MergeFieldCategory;
  /** false = reserved: no backing data source exists yet. See
      RESERVED_FIELD_PLACEHOLDER above — this flag documents *why* a field
      might resolve to the placeholder; it does not change how
      `resolveMergeContext` calls `resolve` (every entry's `resolve` is
      always called; `wired: false` entries simply always return null). */
  wired: boolean;
  /** Returns null when there's genuinely no value to render for this
      call — always null for a `wired: false` entry; for a `wired: true`
      entry, null only when this specific case/organization has no value
      (e.g. no CaseOrder exists yet). Never throws. */
  resolve: (source: MergeSourceData) => string | null;
};

function formatOrganizationAddress(location: OrganizationLocation | null): string | null {
  if (!location) return null;
  const line2 = location.addressLine2 ? ` ${location.addressLine2}` : '';
  return `${location.addressLine1}${line2}, ${location.city}, ${location.state} ${location.postalCode}`;
}

/**
 * The controlled merge-field registry. Every template body's tokens must
 * resolve to one of these keys — nothing in this codebase resolves an ad
 * hoc field path. `case.service.date`/`case.service.location` are
 * deliberately `wired: false`: `types/case.ts` has no service-scheduling
 * fields at all (docs/ROADMAP.md names funeral/service scheduling as an
 * explicit, unbuilt V2 candidate) — reserving the catalog slot now means a
 * future scheduling phase only needs to flip `wired` and supply a real
 * `resolve`, never a template-authoring or merge-engine change.
 */
export const MERGE_FIELD_CATALOG: Record<string, MergeFieldDefinition> = {
  'case.caseNumber': {
    identifier: 'case.caseNumber',
    displayName: 'Case Number',
    dataType: 'string',
    description: "The case's human-facing identifier.",
    exampleValue: 'B2026-014',
    category: 'case',
    wired: true,
    resolve: (source) => source.case.caseNumber,
  },
  'case.decedent.fullName': {
    identifier: 'case.decedent.fullName',
    displayName: 'Decedent Full Name',
    dataType: 'string',
    description: 'The full name of the decedent.',
    exampleValue: 'Robert Ellison',
    category: 'decedent',
    wired: true,
    resolve: (source) => source.case.decedentName,
  },
  'case.decedent.dateOfBirth': {
    identifier: 'case.decedent.dateOfBirth',
    displayName: 'Decedent Date of Birth',
    dataType: 'date',
    description: 'The date of birth of the decedent, as entered on the case.',
    exampleValue: '04/12/1951',
    category: 'decedent',
    wired: true,
    resolve: (source) => source.case.dateOfBirth || null,
  },
  'case.decedent.dateOfDeath': {
    identifier: 'case.decedent.dateOfDeath',
    displayName: 'Decedent Date of Death',
    dataType: 'date',
    description: 'The date of death of the decedent, as entered on the case.',
    exampleValue: '01/02/2026',
    category: 'decedent',
    wired: true,
    resolve: (source) => source.case.dateOfDeath || null,
  },
  'case.service.date': {
    identifier: 'case.service.date',
    displayName: 'Service Date',
    dataType: 'date',
    description: 'Reserved — funeral/service scheduling does not exist in Beacon yet (see docs/ROADMAP.md V2 candidates).',
    exampleValue: RESERVED_FIELD_PLACEHOLDER,
    category: 'service',
    wired: false,
    resolve: () => null,
  },
  'case.service.location': {
    identifier: 'case.service.location',
    displayName: 'Service Location',
    dataType: 'string',
    description: 'Reserved — funeral/service scheduling does not exist in Beacon yet (see docs/ROADMAP.md V2 candidates).',
    exampleValue: RESERVED_FIELD_PLACEHOLDER,
    category: 'service',
    wired: false,
    resolve: () => null,
  },
  'case.primaryContact.fullName': {
    identifier: 'case.primaryContact.fullName',
    displayName: 'Primary Contact Name',
    dataType: 'string',
    description: "The case's next-of-kin — Beacon has no separate generic contacts list, so this is the closest real concept.",
    exampleValue: 'Margaret Ellison',
    category: 'contact',
    wired: true,
    resolve: (source) => source.case.nextOfKinName || null,
  },
  'case.primaryContact.phone': {
    identifier: 'case.primaryContact.phone',
    displayName: 'Primary Contact Phone',
    dataType: 'string',
    description: "The case's next-of-kin phone number.",
    exampleValue: '(555) 010-1234',
    category: 'contact',
    wired: true,
    resolve: (source) => source.case.nextOfKinPhone || null,
  },
  'organization.name': {
    identifier: 'organization.name',
    displayName: 'Organization Name',
    dataType: 'string',
    description: "The funeral home's display name.",
    exampleValue: "Manor's Cremation",
    category: 'organization',
    wired: true,
    resolve: (source) => source.organization.name,
  },
  'organization.phone': {
    identifier: 'organization.phone',
    displayName: 'Organization Phone',
    dataType: 'string',
    description: "The organization's primary phone number.",
    exampleValue: '(555) 555-0100',
    category: 'organization',
    wired: true,
    resolve: (source) => source.organization.primaryPhone || null,
  },
  'organization.email': {
    identifier: 'organization.email',
    displayName: 'Organization Email',
    dataType: 'string',
    description: "The organization's primary email address.",
    exampleValue: 'office@manorscremation.com',
    category: 'organization',
    wired: true,
    resolve: (source) => source.organization.primaryEmail || null,
  },
  'organization.address': {
    identifier: 'organization.address',
    displayName: 'Organization Address',
    dataType: 'string',
    description: "The organization's primary location address.",
    exampleValue: '123 Main St, Springfield, IL 62701',
    category: 'organization',
    wired: true,
    resolve: (source) => formatOrganizationAddress(source.location),
  },
  'organization.documentFooter': {
    identifier: 'organization.documentFooter',
    displayName: 'Document Footer',
    dataType: 'string',
    description: "The organization's configured document footer text (Settings > Branding).",
    exampleValue: 'Licensed Funeral Establishment No. 12345',
    category: 'organization',
    wired: true,
    resolve: (source) => source.branding?.documentFooter || null,
  },
  'financial.total': {
    identifier: 'financial.total',
    displayName: 'Order Total',
    dataType: 'currency',
    description: "The case's active CaseOrder total.",
    exampleValue: '$890.00',
    category: 'financial',
    wired: true,
    resolve: (source) => (source.caseOrder ? formatCentsAsCurrency(source.caseOrder.total, source.organization.defaultCurrency ?? 'usd') : null),
  },
  'financial.balanceDue': {
    identifier: 'financial.balanceDue',
    displayName: 'Balance Due',
    dataType: 'currency',
    description: "The case's active CaseOrder balance due.",
    exampleValue: '$0.00',
    category: 'financial',
    wired: true,
    resolve: (source) => (source.caseOrder ? formatCentsAsCurrency(source.caseOrder.balanceDue, source.organization.defaultCurrency ?? 'usd') : null),
  },
};

const MERGE_TOKEN_PATTERN = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;

/** Every distinct `{{token}}` referenced in a template body, deduplicated
    — exported so `services/documentTemplatesService.ts` can compute
    `DocumentTemplateVersion.mergeFieldsUsed` without re-implementing this
    extraction. */
export function extractMergeTokens(templateBody: string): string[] {
  const tokens = new Set<string>();
  for (const match of templateBody.matchAll(MERGE_TOKEN_PATTERN)) {
    tokens.add(match[1]);
  }
  return [...tokens];
}

/**
 * Rejects a template body at the earliest possible point (save time) if it
 * references any token not in `MERGE_FIELD_CATALOG` — named explicitly in
 * `unknownTokens`, never silently dropped or accepted. A reserved
 * (`wired: false`) token is still a *recognized*, valid token here.
 */
export function validateMergeTokens(templateBody: string): { valid: boolean; unknownTokens: string[] } {
  const unknownTokens = extractMergeTokens(templateBody).filter((token) => !(token in MERGE_FIELD_CATALOG));
  return { valid: unknownTokens.length === 0, unknownTokens };
}

/**
 * Resolves every catalog entry (not just the ones a given template
 * happens to use — cheap, since it's plain field lookups) against real
 * source data. A `null` result (reserved, or simply unavailable for this
 * instance) becomes the visible placeholder — never a blank string.
 */
export function resolveMergeContext(source: MergeSourceData): Record<string, string> {
  const resolved: Record<string, string> = {};
  for (const [identifier, definition] of Object.entries(MERGE_FIELD_CATALOG)) {
    const value = definition.resolve(source);
    resolved[identifier] = value ?? RESERVED_FIELD_PLACEHOLDER;
  }
  return resolved;
}

/**
 * Substitutes every `{{token}}` in `templateBody` with its resolved
 * value. Defensive backstop: throws if a token isn't present in
 * `resolved` at all (meaning it was never a recognized catalog key) —
 * `mergeTemplate` never silently blanks an unrecognized token, even if a
 * caller somehow bypasses `validateMergeTokens` at save time. In normal
 * operation this should be unreachable, since `resolveMergeContext`
 * always returns every catalog key and template saves are validated.
 */
export function mergeTemplate(templateBody: string, resolved: Record<string, string>): string {
  const unresolvable: string[] = [];
  const merged = templateBody.replace(MERGE_TOKEN_PATTERN, (fullMatch, token: string) => {
    if (!(token in resolved)) {
      unresolvable.push(token);
      return fullMatch;
    }
    return resolved[token];
  });
  if (unresolvable.length > 0) {
    throw new Error(`Unrecognized merge field(s): ${unresolvable.join(', ')}`);
  }
  return merged;
}

/**
 * Synthetic source data for previewing a template with no real case
 * selected (e.g. while first authoring it) — built so every field
 * resolves to exactly the same string as its own catalog entry's
 * `exampleValue`, keeping the two in sync structurally rather than by
 * separate hand-maintained copies. Never used for anything but preview —
 * `services/documentService.ts`'s real `generate()` always resolves
 * against genuine Case/CaseOrder/Organization data.
 */
export function buildSampleMergeSourceData(): MergeSourceData {
  return {
    case: {
      caseNumber: 'B2026-014',
      decedentName: 'Robert Ellison',
      dateOfBirth: '04/12/1951',
      dateOfDeath: '01/02/2026',
      nextOfKinName: 'Margaret Ellison',
      nextOfKinPhone: '(555) 010-1234',
    } as unknown as import('@/types/case').Case,
    caseOrder: {
      total: 89_000,
      balanceDue: 0,
    } as unknown as CaseOrder,
    organization: {
      name: "Manor's Cremation",
      primaryPhone: '(555) 555-0100',
      primaryEmail: 'office@manorscremation.com',
      defaultCurrency: 'usd',
    } as unknown as Organization,
    branding: {
      documentFooter: 'Licensed Funeral Establishment No. 12345',
    } as unknown as OrganizationBranding,
    location: {
      addressLine1: '123 Main St',
      addressLine2: null,
      city: 'Springfield',
      state: 'IL',
      postalCode: '62701',
    } as unknown as OrganizationLocation,
  };
}
