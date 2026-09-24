import type { ExternalFormConfig } from '@/types/externalFormConfig';
import type { CaseFormLink } from '@/types/caseFormLink';
import type { ExternalFormSubmission } from '@/types/externalFormSubmission';
import { DEFAULT_ORGANIZATION_ID } from './organizationIds';
import { FIELD_MAP_VITAL_STATISTICS, FIELD_MAP_ARRANGEMENT_FORMS } from '@/domain/externalForms/fieldMapping';

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
    fieldMap: flattenForDisplay(FIELD_MAP_VITAL_STATISTICS),
    linkTokenFieldName: 'solisLinkToken',
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
    fieldMap: flattenForDisplay(FIELD_MAP_ARRANGEMENT_FORMS),
    linkTokenFieldName: 'solisLinkToken',
    linkTokenFieldQid: '274',
    webhookAuthFieldQid: '275',
    isEnabled: true,
    createdAt: '2026-09-24T00:00:00.000Z',
    updatedAt: '2026-09-24T00:00:00.000Z',
  },
];

export const caseFormLinkFixtures: CaseFormLink[] = [];
export const externalFormSubmissionFixtures: ExternalFormSubmission[] = [];
