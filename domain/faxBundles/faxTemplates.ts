/**
 * Fax Settings (2026-11) — the email subject and (optional) message
 * templates. Plain text only. Placeholders come from a fixed list, all of
 * them bundle-level and non-sensitive: a fax email never names a decedent,
 * a case or a family, so no such placeholder exists or can be added by a
 * template. Anything in braces that is not on the list is refused.
 */

export const FAX_TEMPLATE_PLACEHOLDERS = {
  reference: 'The bundle reference, e.g. DC-7Q4K9M (required in the subject)',
  organizationName: 'Your organization’s name as it appears on fax emails',
  applicationCount: 'How many applications are in the bundle',
  pageCount: 'How many pages the bundle PDF has',
} as const;

export type FaxTemplatePlaceholder = keyof typeof FAX_TEMPLATE_PLACEHOLDERS;
export type FaxTemplateValues = Record<FaxTemplatePlaceholder, string | number>;

export const SUBJECT_TEMPLATE_MAX = 150;
export const BODY_TEMPLATE_MAX = 2000;

export class FaxTemplateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FaxTemplateError';
  }
}

const PLACEHOLDER = /\{([^{}]*)\}/g;
// Anything that reads like person or case data gets a clearer refusal.
const SENSITIVE = /decedent|deceased|name|ssn|social|birth|death|dob|dod|family|kin|informant|case|address|phone/i;

function placeholdersIn(template: string): string[] {
  return [...template.matchAll(PLACEHOLDER)].map((m) => m[1]);
}

function checkPlaceholders(template: string, what: string): void {
  for (const raw of placeholdersIn(template)) {
    const key = raw.trim();
    if (key in FAX_TEMPLATE_PLACEHOLDERS && key === raw) continue;
    if (SENSITIVE.test(key)) {
      throw new FaxTemplateError(`{${raw}} is not allowed in the ${what}: fax emails never include decedent or case information.`);
    }
    throw new FaxTemplateError(`{${raw}} is not a placeholder SOLIS knows. Use ${Object.keys(FAX_TEMPLATE_PLACEHOLDERS).map((p) => `{${p}}`).join(', ')}.`);
  }
  // A lone brace would be sent as written and hide a typo.
  if (template.replace(PLACEHOLDER, '').match(/[{}]/)) throw new FaxTemplateError(`The ${what} has an unmatched { or }.`);
}

/** Validates and returns the subject template (trimmed). */
export function validateSubjectTemplate(value: unknown): string {
  if (typeof value !== 'string') throw new FaxTemplateError('The subject is required.');
  const template = value.trim();
  if (!template) throw new FaxTemplateError('The subject is required.');
  // One header line: no line breaks or other control characters, ever.
  if (/[\u0000-\u001f\u007f]/.test(template)) throw new FaxTemplateError('The subject must be a single line of plain text.');
  if (template.length > SUBJECT_TEMPLATE_MAX) throw new FaxTemplateError(`The subject can be at most ${SUBJECT_TEMPLATE_MAX} characters.`);
  checkPlaceholders(template, 'subject');
  // Each fax must be matchable to its NuSo confirmation.
  if (!placeholdersIn(template).includes('reference')) throw new FaxTemplateError('The subject must include {reference}, so each fax can be matched to its NuSo confirmation.');
  return template;
}

/** Validates and returns the message template: plain text, \n line endings, may be empty. */
export function validateBodyTemplate(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw new FaxTemplateError('The message must be plain text.');
  const template = value.replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '').trim();
  if (/[\u0000-\u0008\u000b-\u001f\u007f]/.test(template)) throw new FaxTemplateError('The message must be plain text.');
  if (/<\s*\/?\s*[a-z][^>]*>/i.test(template)) throw new FaxTemplateError('The message must be plain text — HTML is not sent.');
  if (template.length > BODY_TEMPLATE_MAX) throw new FaxTemplateError(`The message can be at most ${BODY_TEMPLATE_MAX} characters.`);
  checkPlaceholders(template, 'message');
  return template;
}

/** Fills a validated template. Unknown placeholders cannot reach here. */
export function renderFaxTemplate(template: string, values: FaxTemplateValues): string {
  return template.replace(PLACEHOLDER, (whole, key: string) => (key in values ? String(values[key as FaxTemplatePlaceholder]) : whole));
}

/** The subject every organization starts with — exactly the subject sent before Fax Settings existed. */
export const defaultSubjectTemplate = (emailOrganizationName: string) => `${emailOrganizationName} - DC Application Bundle {reference}`;
