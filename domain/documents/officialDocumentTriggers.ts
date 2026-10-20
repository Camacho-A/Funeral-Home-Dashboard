import type { Case } from '../../types/case';
import { MANORS_ORGANIZATION_ID } from '../organization/organizationProfiles';
import { composeDecedentName } from '../cases/decedentName';
import { caseDateToIso, isoToCaseDate } from '../cases/cremationDates';

/**
 * Which of an organization's own official documents a case change should
 * regenerate (2026-10). Pure — the service decides HOW; this decides WHEN.
 *
 *   Envelope                  needs the decedent's name and a valid Tag
 *                             Number. Generated when a Tag Number is saved
 *                             (or changed), regenerated when the name changes
 *                             on a case that has one. Never merely because a
 *                             case was created.
 *   Certificate of Cremation  needs the name, a valid Tag Number, the date
 *                             of death and the date of cremation — every
 *                             value the official form prints. Generated once
 *                             all four are recorded, regenerated when any of
 *                             them changes.
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

const normalizedTag = (c: Pick<Relevant, 'tagNumber'>) => (present(c.tagNumber) ? c.tagNumber!.trim().toUpperCase() : null);

/** A Tag Number is valid when one has actually been entered (not blank,
    not the "—" placeholder). */
export function hasValidTagNumber(c: Pick<Relevant, 'tagNumber'>): boolean {
  return normalizedTag(c) !== null;
}

/** A real calendar date, stored MM/DD/YYYY (or YYYY-MM-DD) — 02/30 is not. */
function isRealDate(value: string | null | undefined): boolean {
  const trimmed = value?.trim() ?? '';
  return isoToCaseDate(caseDateToIso(trimmed) || trimmed.slice(0, 10)) !== null;
}

/** Labels of the case information a document still needs, in the order
    staff see them on the case; empty when it can be generated. */
export function missingOfficialDocumentFields(kind: OfficialDocumentKind, c: Omit<Relevant, 'organizationId' | 'isDeleted'>): string[] {
  const missing: string[] = [];
  if (!present(c.decedentName)) missing.push("Decedent's name");
  if (!hasValidTagNumber(c)) missing.push('Tag Number');
  if (kind === 'certificate_of_cremation') {
    if (!isRealDate(c.dateOfDeath)) missing.push('Date of Death');
    if (!isRealDate(c.dateOfCremation)) missing.push('Date of Cremation');
  }
  return missing;
}

const fullName = (c: Relevant) => composeDecedentName(c.decedentName ?? '', c.decedentMiddleName ?? null).trim();

export function officialDocumentsToRegenerate(before: Relevant | null, after: Relevant): OfficialDocumentKind[] {
  const offered = officialDocumentsFor(after.organizationId);
  if (offered.length === 0 || after.isDeleted) return [];

  const kinds: OfficialDocumentKind[] = [];
  const nameChanged = before === null || fullName(before) !== fullName(after);

  if (offered.includes('envelope') && missingOfficialDocumentFields('envelope', after).length === 0) {
    const tagSaved = before === null || normalizedTag(before) !== normalizedTag(after);
    if (tagSaved || nameChanged) kinds.push('envelope');
  }

  if (offered.includes('certificate_of_cremation') && missingOfficialDocumentFields('certificate_of_cremation', after).length === 0) {
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
