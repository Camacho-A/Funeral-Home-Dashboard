/**
 * Staff-facing names for the Case fields a derived checklist item can be
 * completed by (`ChecklistItemTemplate.requiredCaseFields`). Used where an
 * administrator needs to see WHAT completes such an item — e.g. the
 * Workflow Editor, where a v6 and a v7 "Certifier Information" item
 * otherwise look identical. An unknown key is shown as-is rather than
 * hidden.
 */
const REQUIRED_CASE_FIELD_LABELS: Record<string, string> = {
  certifierName: 'Certifier name',
  certifierPhone: 'Certifier phone',
  certifierFax: 'Certifier fax',
  nextOfKinName: 'Next of kin',
  nextOfKinPhone: 'NOK phone',
  nextOfKinEmail: 'NOK email',
};

export function requiredCaseFieldsSummary(fields: readonly string[] | undefined): string | null {
  if (!fields || fields.length === 0) return null;
  return fields.map((field) => REQUIRED_CASE_FIELD_LABELS[field] ?? field).join(' + ');
}
