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
  /** 2026-10. Filled automatically from the organization's own signed
      certificate (services/officialDocumentTemplates.ts), never authored
      through the template-merge path. */
  CREMATION_FORM_CERTIFICATE_OF_CREMATION: { key: 'cremation_form.certificate_of_cremation', category: 'cremation_form' as DocumentTemplateCategory, displayName: 'Certificate of Cremation' },
  /** 2026-10. The filled DYMO label for the cremated remains, saved from
      Print Label (domain/labels/) as a .dymo file — never generated from a
      DocumentTemplate. */
  CREMATION_FORM_CREMATION_LABEL: { key: 'cremation_form.cremation_label', category: 'cremation_form' as DocumentTemplateCategory, displayName: 'Cremation Label' },

  BURIAL_FORM_PERMIT_APPLICATION: { key: 'burial_form.permit_application', category: 'burial_form' as DocumentTemplateCategory, displayName: 'Burial Permit Application' },
  BURIAL_FORM_INTERMENT_ORDER: { key: 'burial_form.interment_order', category: 'burial_form' as DocumentTemplateCategory, displayName: 'Interment Order' },

  FINANCIAL_INVOICE: { key: 'financial.invoice', category: 'financial' as DocumentTemplateCategory, displayName: 'Invoice' },
  FINANCIAL_ESTIMATE: { key: 'financial.estimate', category: 'financial' as DocumentTemplateCategory, displayName: 'Estimate' },

  FINANCIAL_RECEIPT: { key: 'financial.receipt', category: 'receipt' as DocumentTemplateCategory, displayName: 'Receipt' },

  STATEMENT_ACCOUNT: { key: 'statement.account', category: 'statement' as DocumentTemplateCategory, displayName: 'Account Statement' },

  /** Phase 39 (Family Billing & FTC Compliance). System-rendered FTC
      documents — NOT authored via the template-merge path (their itemized,
      legally-mandated content is generated deterministically from case/order
      data + the system-locked compliance registry). */
  FINANCIAL_STATEMENT_GOODS_SERVICES: { key: 'financial.statement_goods_services', category: 'statement' as DocumentTemplateCategory, displayName: 'Statement of Funeral Goods and Services Selected' },
  PRICE_LIST_GENERAL: { key: 'pricelist.general', category: 'financial' as DocumentTemplateCategory, displayName: 'General Price List' },

  LETTER_GENERAL: { key: 'letter.general', category: 'letter' as DocumentTemplateCategory, displayName: 'General Letter' },
  LETTER_CONDOLENCE: { key: 'letter.condolence', category: 'letter' as DocumentTemplateCategory, displayName: 'Condolence Letter' },
  /** 2026-10. The #10 envelope the family's important documents go out in,
      filled from the organization's own envelope (officialDocumentTemplates.ts). */
  LETTER_ENVELOPE: { key: 'letter.envelope', category: 'letter' as DocumentTemplateCategory, displayName: 'Envelope' },

  INTERNAL_CHECKLIST: { key: 'internal.checklist', category: 'internal_form' as DocumentTemplateCategory, displayName: 'Internal Checklist' },

  OBITUARY: { key: 'obituary', category: 'miscellaneous' as DocumentTemplateCategory, displayName: 'Obituary' },

  /** Manors Jotform integration (case-first architecture, 2026-09). The
      original, populated Smart PDF Form retrieved from Jotform for a
      matched external-form submission — never generated from a
      DocumentTemplate (origin: 'uploaded', not 'generated' — see
      services/externalFormPdfService.ts). `external_form.*` rather than
      `intake.*` deliberately — "intake" implied Jotform was the
      case-intake system, which the case-first redesign rejected; a case
      always exists first, a submission only ever attaches to it. */
  EXTERNAL_FORM_VITAL_STATISTICS: { key: 'external_form.vital_statistics', category: 'cremation_form' as DocumentTemplateCategory, displayName: 'Vital Statistics Information Sheet' },
  EXTERNAL_FORM_ARRANGEMENT_FORMS: { key: 'external_form.arrangement_forms', category: 'authorization' as DocumentTemplateCategory, displayName: 'Arrangement Forms' },
  /** 2026-10. Before this, the First Call Sheet's PDF had no type and was
      filed under its bare form id (`{formId}.pdf`). */
  EXTERNAL_FORM_FIRST_CALL: { key: 'external_form.first_call', category: 'internal_form' as DocumentTemplateCategory, displayName: 'First Call' },
  /** 2026-10. Single pages copied unchanged out of the case's completed
      Arrangement Forms PDF (services/arrangementPageExtractService.ts):
      page 2, the Release Authorization for Removal of Decedent, for the
      Medical Examiner; page 3, the Authorization for Cremation and
      Disposition, for the crematory once the permit is available. */
  EXTERNAL_FORM_ME_FORM: { key: 'external_form.me_form', category: 'authorization' as DocumentTemplateCategory, displayName: 'Release Form' },
  EXTERNAL_FORM_CREMATORY_FORM: { key: 'external_form.crematory_form', category: 'cremation_form' as DocumentTemplateCategory, displayName: 'Crematory Form' },
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
