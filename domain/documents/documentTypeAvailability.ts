import { getRegisteredOrganizationProfile } from '../organization/organizationProfiles';
import { DOCUMENT_TYPES, UPLOADABLE_DOCUMENT_TYPES, type DocumentTypeDefinition } from './documentTypeRegistry';

/**
 * Document types by organization (2026-11). The registry is one canonical
 * list; a type that belongs to one organization's own feature is offered
 * only to that organization — in the upload type list, the template
 * editor, and every server route that accepts a type. Existing documents
 * are never touched: this decides what can be chosen from now on.
 */
const FEATURE_DOCUMENT_TYPES: Readonly<Record<string, (organizationId: string) => boolean>> = {
  // Manors' Manatee County death certificate application.
  [DOCUMENT_TYPES.VITAL_RECORDS_MANATEE_DEATH_CERTIFICATE_APPLICATION.key]: (organizationId) =>
    getRegisteredOrganizationProfile(organizationId).features.manateeDeathCertificateApplication,
};

export function isDocumentTypeAvailable(organizationId: string | null | undefined, documentTypeKey: string): boolean {
  const gate = FEATURE_DOCUMENT_TYPES[documentTypeKey];
  if (!gate) return true;
  return Boolean(organizationId) && gate(organizationId!);
}

/** The upload type list for one organization. */
export function uploadableDocumentTypesFor(organizationId: string | null | undefined): readonly DocumentTypeDefinition[] {
  return UPLOADABLE_DOCUMENT_TYPES.filter((type) => isDocumentTypeAvailable(organizationId, type.key));
}

/** Every document type one organization can choose (template editor). */
export function documentTypesFor(organizationId: string | null | undefined): readonly DocumentTypeDefinition[] {
  return Object.values(DOCUMENT_TYPES).filter((type) => isDocumentTypeAvailable(organizationId, type.key));
}
