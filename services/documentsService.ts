import type { OrganizationContext } from '../types/organization';
import type { CaseDocument, NewDocumentInput } from '../types/document';
import { documentFixtures, documentFilesById } from './__mocks__/fixtures';

export async function list(context: OrganizationContext, caseId: string): Promise<CaseDocument[]> {
  return documentFixtures.filter((d) => d.organizationId === context.organizationId && d.caseId === caseId);
}

/**
 * `file` is the browser File the user picked — kept only in the mock's
 * in-memory documentFilesById map (see fixtures.ts), not on CaseDocument
 * itself, matching how a real backend would separate object storage from
 * the document record. Used only to support Print (getFile below).
 */
export async function upload(
  context: OrganizationContext,
  caseId: string,
  input: NewDocumentInput,
  file?: File,
): Promise<CaseDocument> {
  const document: CaseDocument = {
    id: `doc-${documentFixtures.length + 1}`,
    organizationId: context.organizationId,
    caseId,
    documentType: input.documentType ?? 'other',
    fileName: input.fileName,
    status: 'active',
    uploadedBy: input.uploadedBy,
    uploadedAt: new Date().toISOString(),
  };
  documentFixtures.push(document);
  if (file) documentFilesById.set(document.id, file);
  return document;
}

export async function remove(context: OrganizationContext, documentId: string): Promise<void> {
  const index = documentFixtures.findIndex(
    (d) => d.id === documentId && d.organizationId === context.organizationId,
  );
  if (index === -1) return;
  documentFixtures.splice(index, 1);
  documentFilesById.delete(documentId);
}

export function getFile(documentId: string): File | undefined {
  return documentFilesById.get(documentId);
}

export const documentsService = { list, upload, remove, getFile };
