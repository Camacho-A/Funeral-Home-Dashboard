import type { DocumentTemplateCategory } from '@/types/documentTemplate';

/**
 * Phase 25 (Document Generation & Template Management). The stable,
 * machine-readable document-type taxonomy every `DocumentTemplate` picks
 * exactly one entry from (`DocumentTemplate.documentTypeKey`) — mirrors
 * `types/activityEvent.ts`'s `ACTIVITY_EVENT_TYPES` registry convention
 * exactly: dot-notation identifiers, a separate `displayName` (never
 * derived from the key), and this registry (not free text on a template)
 * is the source of truth for what a template "is." `category` groups
 * entries into the ten broad, UI-facing categories this phase's own spec
 * named (`types/documentTemplate.ts`'s `DocumentTemplateCategory`) — the
 * Template Library's filter dropdown groups by `category`; anything that
 * needs to know a template's precise identity (a future report, a Phase
 * 26 signature integration keying off "this is a cremation authorization
 * specifically") reads `documentTypeKey`.
 *
 * This list is deliberately extensible — adding a document type later is
 * a new entry here, never a data-model change (the same "reserved slot in
 * the registry" discipline `ACTIVITY_EVENT_TYPES` established), and an
 * organization is never limited to only these: any string could in
 * principle be stored, but every template-creation code path in this
 * phase only ever offers a value from this registry, so in practice every
 * real template's `documentTypeKey` is one of these.
 */
export const DOCUMENT_TYPES = {
  CONTRACT_FUNERAL: { key: 'contract.funeral', category: 'contract' as DocumentTemplateCategory, displayName: 'Funeral Contract' },
  CONTRACT_PRENEED: { key: 'contract.preneed', category: 'contract' as DocumentTemplateCategory, displayName: 'Pre-Need Contract' },

  AUTHORIZATION_CREMATION: { key: 'authorization.cremation', category: 'authorization' as DocumentTemplateCategory, displayName: 'Cremation Authorization' },
  AUTHORIZATION_EMBALMING: { key: 'authorization.embalming', category: 'authorization' as DocumentTemplateCategory, displayName: 'Embalming Authorization' },
  AUTHORIZATION_DISPOSITION: { key: 'authorization.disposition', category: 'authorization' as DocumentTemplateCategory, displayName: 'Disposition Authorization' },

  CREMATION_FORM_PERMIT_APPLICATION: { key: 'cremation_form.permit_application', category: 'cremation_form' as DocumentTemplateCategory, displayName: 'Cremation Permit Application' },
  CREMATION_FORM_WITNESS_STATEMENT: { key: 'cremation_form.witness_statement', category: 'cremation_form' as DocumentTemplateCategory, displayName: 'Cremation Witness Statement' },

  BURIAL_FORM_PERMIT_APPLICATION: { key: 'burial_form.permit_application', category: 'burial_form' as DocumentTemplateCategory, displayName: 'Burial Permit Application' },
  BURIAL_FORM_INTERMENT_ORDER: { key: 'burial_form.interment_order', category: 'burial_form' as DocumentTemplateCategory, displayName: 'Interment Order' },

  FINANCIAL_INVOICE: { key: 'financial.invoice', category: 'financial' as DocumentTemplateCategory, displayName: 'Invoice' },
  FINANCIAL_ESTIMATE: { key: 'financial.estimate', category: 'financial' as DocumentTemplateCategory, displayName: 'Estimate' },

  FINANCIAL_RECEIPT: { key: 'financial.receipt', category: 'receipt' as DocumentTemplateCategory, displayName: 'Receipt' },

  STATEMENT_ACCOUNT: { key: 'statement.account', category: 'statement' as DocumentTemplateCategory, displayName: 'Account Statement' },

  LETTER_GENERAL: { key: 'letter.general', category: 'letter' as DocumentTemplateCategory, displayName: 'General Letter' },
  LETTER_CONDOLENCE: { key: 'letter.condolence', category: 'letter' as DocumentTemplateCategory, displayName: 'Condolence Letter' },

  INTERNAL_CHECKLIST: { key: 'internal.checklist', category: 'internal_form' as DocumentTemplateCategory, displayName: 'Internal Checklist' },

  OBITUARY: { key: 'obituary', category: 'miscellaneous' as DocumentTemplateCategory, displayName: 'Obituary' },
} as const;

export type DocumentTypeDefinition = (typeof DOCUMENT_TYPES)[keyof typeof DOCUMENT_TYPES];
export type DocumentTypeKey = DocumentTypeDefinition['key'];

const DOCUMENT_TYPES_BY_KEY: Record<string, DocumentTypeDefinition> = Object.fromEntries(
  Object.values(DOCUMENT_TYPES).map((entry) => [entry.key, entry]),
);

export function isValidDocumentTypeKey(key: string): key is DocumentTypeKey {
  return key in DOCUMENT_TYPES_BY_KEY;
}

export function getDocumentTypeDefinition(key: string): DocumentTypeDefinition | null {
  return DOCUMENT_TYPES_BY_KEY[key] ?? null;
}

/** Display labels for the ten broad `DocumentTemplateCategory` values —
    a domain decision, kept out of UI components per `Badge`'s own
    convention (see `domain/activity/activityDisplay.ts` for the same
    pattern applied to `ActivityEventCategory`). */
export const DOCUMENT_TEMPLATE_CATEGORY_LABEL: Record<DocumentTemplateCategory, string> = {
  contract: 'Contracts',
  authorization: 'Authorizations',
  cremation_form: 'Cremation Forms',
  burial_form: 'Burial Forms',
  financial: 'Financial Documents',
  receipt: 'Receipts',
  statement: 'Statements',
  letter: 'Letters',
  internal_form: 'Internal Forms',
  miscellaneous: 'Miscellaneous',
};
