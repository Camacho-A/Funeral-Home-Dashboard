import { DOCUMENT_TYPES } from '@/domain/documents/documentTypeRegistry';

/**
 * Cremation Label (2026-10). The saved, filled DYMO label is an ordinary
 * case document: stored in the case's document storage, listed in the
 * Documents tab, versioned and audited like the Envelope. Kept apart from
 * manorsLabel.ts so code that only needs to recognise a label never loads
 * the template itself.
 */
export const CREMATION_LABEL_DOCUMENT_TYPE_KEY = DOCUMENT_TYPES.CREMATION_FORM_CREMATION_LABEL.key;
export const CREMATION_LABEL_DISPLAY_NAME = DOCUMENT_TYPES.CREMATION_FORM_CREMATION_LABEL.displayName;
/** No registered type exists for DYMO Connect files; this vendor type makes
    a browser download the file rather than try to show it. */
export const CREMATION_LABEL_MIME_TYPE = 'application/vnd.dymo.label+xml';
export const CREMATION_LABEL_FILE_NAME = 'Cremation Label.dymo';

export function isCremationLabelDocument(document: { documentTypeKey: string | null }): boolean {
  return document.documentTypeKey === CREMATION_LABEL_DOCUMENT_TYPE_KEY;
}
