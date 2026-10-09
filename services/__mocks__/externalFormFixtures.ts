import type { ExternalFormConfig } from '@/types/externalFormConfig';
import type { CaseFormLink } from '@/types/caseFormLink';
import type { ExternalFormSubmission } from '@/types/externalFormSubmission';
import { DEFAULT_ORGANIZATION_ID } from './organizationIds';
import {
  FIELD_MAP_VITAL_STATISTICS,
  FIELD_MAP_ARRANGEMENT_FORMS,
  FIELD_MAP_FIRST_CALL_SHEET,
  FIRST_CALL_SHEET_EXTERNAL_FORM_ID,
} from '@/domain/externalForms/fieldMapping';

/** Manors Jotform integration (case-first architecture, 2026-09). The two
    real Manors form configurations, discovered via the read-only Jotform
    API audit — never hardcoded elsewhere in application logic. `fieldMap`
    here is a display/debugging-only serialization; the authoritative,
    type-safe field map used for actual extraction always comes from
    domain/externalForms/fieldMapping.ts#fieldMapForForm — see that
    module's own comment for why these are deliberately not the same
    source of truth. */
export const VITAL_STATISTICS_FORM_CONFIG_ID = 'extform-config-managed-cremations-jotform-vital-statistics';
export const ARRANGEMENT_FORMS_FORM_CONFIG_ID = 'extform-config-managed-cremations-jotform-arrangement-forms';

/** Automated intake (2026-10). Manors First Call Sheet — the first form
    configured with `purpose: 'case_create'`, i.e. the first form whose
    submissions may allocate a Solis case number. */
export const FIRST_CALL_SHEET_FORM_CONFIG_ID = 'extform-config-managed-cremations-jotform-first-call-sheet';

function flattenForDisplay(entries: { qid: string; solisField: string }[]): string {
  return JSON.stringify(Object.fromEntries(entries.map((e) => [e.qid, e.solisField])));
}

export const externalFormConfigFixtures: ExternalFormConfig[] = [
  {
    id: VITAL_STATISTICS_FORM_CONFIG_ID,
    organizationId: DEFAULT_ORGANIZATION_ID,
    provider: 'jotform',
    externalFormId: '262605621454050',
    label: 'Vital Statistics',
    audience: 'family',
    purpose: 'case_update',
    fieldMap: flattenForDisplay(FIELD_MAP_VITAL_STATISTICS),
    // The hidden field's real Jotform NAME — URL prefill keys on this,
    // and Jotform lowercased it (live-verified 2026-10).
    linkTokenFieldName: 'solislinktoken',
    linkTokenFieldQid: '44',
    webhookAuthFieldQid: '45',
    isEnabled: true,
    createdAt: '2026-09-24T00:00:00.000Z',
    updatedAt: '2026-09-24T00:00:00.000Z',
  },
  {
    id: ARRANGEMENT_FORMS_FORM_CONFIG_ID,
    organizationId: DEFAULT_ORGANIZATION_ID,
    provider: 'jotform',
    externalFormId: '261945978664175',
    label: 'Arrangement Forms',
    audience: 'staff',
    purpose: 'case_update',
    fieldMap: flattenForDisplay(FIELD_MAP_ARRANGEMENT_FORMS),
    // Auto-generated placeholder name on the live form — nothing like its
    // display name, which is why prefill cannot derive it (live-verified).
    linkTokenFieldName: 'input274',
    linkTokenFieldQid: '274',
    webhookAuthFieldQid: '275',
    isEnabled: true,
    createdAt: '2026-09-24T00:00:00.000Z',
    updatedAt: '2026-09-24T00:00:00.000Z',
  },
  {
    id: FIRST_CALL_SHEET_FORM_CONFIG_ID,
    organizationId: DEFAULT_ORGANIZATION_ID,
    provider: 'jotform',
    externalFormId: FIRST_CALL_SHEET_EXTERNAL_FORM_ID,
    label: 'Manors First Call Sheet',
    audience: 'staff',
    // The ONLY config in this codebase that may create a case.
    purpose: 'case_create',
    fieldMap: flattenForDisplay(FIELD_MAP_FIRST_CALL_SHEET),
    linkTokenFieldName: 'solisLinkToken',
    // A first-call submission has no case to link to yet, so no link-token
    // field exists on this form. The empty qid means
    // `extractHiddenFieldByQid` can never match anything, which is exactly
    // right: every submission from this form arrives unlinked and is
    // routed by `purpose`, never by a token.
    linkTokenFieldQid: '',
    // VERIFIED against the live form (2026-10): the hidden
    // `solisWebhookAuth` short-text field was created through the Jotform
    // API and Jotform assigned it qid 26. Not a guess — read back from
    // /form/262664842044055/questions after creation.
    webhookAuthFieldQid: '26',
    isEnabled: true,
    createdAt: '2026-10-06T00:00:00.000Z',
    updatedAt: '2026-10-06T00:00:00.000Z',
  },
];

export const caseFormLinkFixtures: CaseFormLink[] = [];
export const externalFormSubmissionFixtures: ExternalFormSubmission[] = [];
