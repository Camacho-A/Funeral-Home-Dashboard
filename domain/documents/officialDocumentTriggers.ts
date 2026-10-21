import type { Case } from '../../types/case';
import { MANORS_ORGANIZATION_ID } from '../organization/organizationProfiles';
import { composeDecedentName } from '../cases/decedentName';
import { caseDateToIso, isoToCaseDate } from '../cases/cremationDates';

/**
 * Which of an organization's own official documents a case change should
 * regenerate (2026-10). Pure — the service decides HOW; this decides WHEN.
 *
 *   Envelope                  needs only the decedent's name — it prints
 *                             "<Name> (Deceased)" and nothing else, so a
 *                             Tag Number is NOT required (2026-10). Created
 *                             automatically when a Tag Number is first
 *                             saved and the case has no Envelope yet;
 *                             regenerated when the name changes. Never
 *                             merely because a case was created, and never
 *                             a second copy because a Tag Number changed
 *                             (see envelopeTrigger + the service).
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
  // The Certificate prints the Tag Number; the Envelope does not.
  if (kind === 'certificate_of_cremation' && !hasValidTagNumber(c)) missing.push('Tag Number');
  if (kind === 'certificate_of_cremation') {
    if (!isRealDate(c.dateOfDeath)) missing.push('Date of Death');
    if (!isRealDate(c.dateOfCremation)) missing.push('Date of Cremation');
  }
  return missing;
}

const fullName = (c: Relevant) => composeDecedentName(c.decedentName ?? '', c.decedentMiddleName ?? null).trim();

/**
 * Why a case change might call for an Envelope, before checking whether the
 * case already has one (the service does, see automaticCaseDocuments.ts):
 *
 *   'name_changed'  the printed name changed on an existing case — keep an
 *                   existing Envelope current (or, as before, create one
 *                   once the case has a Tag Number);
 *   'tag_saved'     a valid Tag Number was newly saved or changed (or the
 *                   case was created with one) — the moment the business
 *                   prepares the Envelope; only creates one when the case
 *                   has none, since the Tag Number is not on it.
 *
 * Null when nothing affecting the Envelope happened, the name is missing,
 * or the case is archived.
 */
export function envelopeTrigger(before: Relevant | null, after: Relevant): 'name_changed' | 'tag_saved' | null {
  if (after.isDeleted || !present(after.decedentName)) return null;
  if (before !== null && fullName(before) !== fullName(after)) return 'name_changed';
  const tagSaved = hasValidTagNumber(after) && (before === null || normalizedTag(before) !== normalizedTag(after));
  return tagSaved ? 'tag_saved' : null;
}

export function officialDocumentsToRegenerate(before: Relevant | null, after: Relevant): OfficialDocumentKind[] {
  const offered = officialDocumentsFor(after.organizationId);
  if (offered.length === 0 || after.isDeleted) return [];

  const kinds: OfficialDocumentKind[] = [];
  const nameChanged = before === null || fullName(before) !== fullName(after);

  if (offered.includes('envelope') && envelopeTrigger(before, after) !== null) kinds.push('envelope');

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
