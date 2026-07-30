import type { DocumentTemplate, DocumentTemplateCategory } from '@/types/documentTemplate';

/**
 * Phase 25 (Document Generation & Template Management). Client-side fetch
 * wrappers around `/api/document-templates*` — matching
 * `lib/identityAuthClient.ts`'s exact reasoning: `services/documentTemplatesService.ts`
 * imports `lib/wixDataApi.ts` (server-only) and can never be imported into
 * a Client Component directly.
 */

async function parseJsonOrThrow(response: Response): Promise<Record<string, unknown>> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof body.error === 'string' ? body.error : 'Something went wrong. Please try again.';
    throw new Error(message);
  }
  return body;
}

export async function fetchDocumentTemplates(organizationId: string): Promise<DocumentTemplate[]> {
  const response = await fetch(`/api/document-templates?organizationId=${encodeURIComponent(organizationId)}`);
  const body = await parseJsonOrThrow(response);
  return (body.templates as DocumentTemplate[]) ?? [];
}

export async function createDocumentTemplate(params: {
  organizationId: string;
  name: string;
  documentTypeKey: string;
  category: DocumentTemplateCategory;
  body: string;
}): Promise<DocumentTemplate> {
  const response = await fetch('/api/document-templates', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  const responseBody = await parseJsonOrThrow(response);
  return responseBody.template as DocumentTemplate;
}

export async function createDocumentTemplateVersion(params: { organizationId: string; templateId: string; body: string }): Promise<DocumentTemplate> {
  const { templateId, ...rest } = params;
  const response = await fetch(`/api/document-templates/${encodeURIComponent(templateId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(rest),
  });
  const body = await parseJsonOrThrow(response);
  return body.template as DocumentTemplate;
}

export async function cloneDocumentTemplate(params: { organizationId: string; sourceTemplateId: string; name: string }): Promise<DocumentTemplate> {
  const response = await fetch(`/api/document-templates/${encodeURIComponent(params.sourceTemplateId)}/clone`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ organizationId: params.organizationId, name: params.name }),
  });
  const body = await parseJsonOrThrow(response);
  return body.template as DocumentTemplate;
}

export async function archiveDocumentTemplate(params: { organizationId: string; templateId: string }): Promise<void> {
  const response = await fetch(`/api/document-templates/${encodeURIComponent(params.templateId)}/archive`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ organizationId: params.organizationId }),
  });
  await parseJsonOrThrow(response);
}

export async function restoreDocumentTemplate(params: { organizationId: string; templateId: string }): Promise<void> {
  const response = await fetch(`/api/document-templates/${encodeURIComponent(params.templateId)}/restore`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ organizationId: params.organizationId }),
  });
  await parseJsonOrThrow(response);
}

export async function previewDocumentTemplate(params: { organizationId: string; templateId: string; body?: string; caseId?: string }): Promise<string> {
  const { templateId, ...rest } = params;
  const response = await fetch(`/api/document-templates/${encodeURIComponent(templateId)}/preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(rest),
  });
  const body = await parseJsonOrThrow(response);
  return body.html as string;
}
