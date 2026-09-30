/**
 * Next of Kin name/phone legacy corruption cleanup (2026-09, Task #5 final
 * fix). Some existing cases have `Case.nextOfKinName` corrupted to the old
 * combined "NAME — PHONE" form (the legacy Family Contact checklist value
 * that used to get written wholesale into nextOfKinName — see
 * domain/workflow/resolveIntake.ts#findCaseFieldForChecklistIndex's
 * ambiguous-index fix, which stops this from happening again going
 * forward). This is the ONE shared place that derives the safe display/
 * edit value for the name, so ChecklistCard's structured Family Contact
 * editor and CaseInformationCard's "Next of kin" field can never implement
 * two different, silently-diverging parsers.
 *
 * Deliberately conservative: only strips a trailing " — <phone>" suffix
 * when that suffix's digits actually match the case's OWN
 * nextOfKinPhone — never a blind "everything after the em dash" strip,
 * which would corrupt a legitimate name that happens to contain one (or
 * silently invent a phone number that was never actually stored). Phone
 * comparison ignores formatting (spaces/parens/dashes) so "(954) 901-4165",
 * "954-901-4165", and "9549014165" are all treated as the same number.
 */
const FAMILY_CONTACT_SEPARATOR = ' — ';

function phoneDigits(phone: string): string {
  return phone.replace(/\D/g, '');
}

export function normalizeNextOfKinName(nextOfKinName: string, nextOfKinPhone: string): string {
  const sepIndex = nextOfKinName.lastIndexOf(FAMILY_CONTACT_SEPARATOR);
  if (sepIndex === -1) return nextOfKinName;

  const expectedDigits = phoneDigits(nextOfKinPhone);
  if (expectedDigits === '') return nextOfKinName;

  const suffixDigits = phoneDigits(nextOfKinName.slice(sepIndex + FAMILY_CONTACT_SEPARATOR.length));
  if (suffixDigits === '' || suffixDigits !== expectedDigits) return nextOfKinName;

  const cleanedName = nextOfKinName.slice(0, sepIndex).trim();
  return cleanedName !== '' ? cleanedName : nextOfKinName;
}
