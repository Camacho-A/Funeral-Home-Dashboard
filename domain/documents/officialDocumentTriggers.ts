import type { Case } from '../../types/case';
import { MANORS_ORGANIZATION_ID } from '../organization/organizationProfiles';
import { composeDecedentName } from '../cases/decedentName';

/**
 * Which of an organization's own official documents a case change should
 * regenerate (2026-10). Pure — the service decides HOW; this decides WHEN.
 *
 *   Envelope                  needs the decedent's name. Generated when the
 *                             case is created, regenerated when the name
 *                             changes.
 *   Certificate of Cremation  needs the date of cremation. Generated once it
 *                             is recorded, regenerated when it, the name,
 *                             the tag number or the date of death changes.
 *
 * An archived case is history and is never regenerated. Only an
 * organization that has these templates gets them (Manors).
 */
export type OfficialDocumentKind = 'envelope' | 'certificate_of_cremation';

const ORGANIZATIONS_WITH_OFFICIAL_DOCUMENTS: Record<string, readonly OfficialDocumentKind[]> = {
  [MANORS_ORGANIZATION_ID]: ['envelope', 'certificate_of_cremation'],
};

export function officialDocumentsFor(organizationId: string): readonly OfficialDocumentKind[] {
  return ORGANIZATIONS_WITH_OFFICIAL_DOCUMENTS[organizationId] ?? [];
}

type Relevant = Pick<
  Case,
  'organizationId' | 'decedentName' | 'decedentMiddleName' | 'tagNumber' | 'dateOfDeath' | 'dateOfCremation' | 'isDeleted'
>;

function present(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim() !== '' && value.trim() !== '—';
}

const fullName = (c: Relevant) => composeDecedentName(c.decedentName ?? '', c.decedentMiddleName ?? null).trim();

export function officialDocumentsToRegenerate(before: Relevant | null, after: Relevant): OfficialDocumentKind[] {
  const offered = officialDocumentsFor(after.organizationId);
  if (offered.length === 0 || after.isDeleted) return [];

  const kinds: OfficialDocumentKind[] = [];
  const nameChanged = before === null || fullName(before) !== fullName(after);

  if (offered.includes('envelope') && present(after.decedentName) && nameChanged) kinds.push('envelope');

  if (offered.includes('certificate_of_cremation') && present(after.decedentName) && present(after.dateOfCremation)) {
    const changed =
      before === null ||
      nameChanged ||
      (before.dateOfCremation ?? null) !== (after.dateOfCremation ?? null) ||
      (before.tagNumber ?? null) !== (after.tagNumber ?? null) ||
      (before.dateOfDeath ?? null) !== (after.dateOfDeath ?? null);
    if (changed) kinds.push('certificate_of_cremation');
  }
  return kinds;
}
