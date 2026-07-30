import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { DocumentTemplateCategory } from '@/types/documentTemplate';
import {
  fetchDocumentTemplates,
  createDocumentTemplate,
  createDocumentTemplateVersion,
  cloneDocumentTemplate,
  archiveDocumentTemplate,
  restoreDocumentTemplate,
  previewDocumentTemplate,
} from '@/lib/documentTemplatesClient';

/**
 * Phase 25 (Document Generation & Template Management). Query/mutation
 * hooks for the org-wide Document Template Library — bundled in one file
 * matching `hooks/useRbac.ts`'s convention (everything sharing the same
 * `documentTemplates` cache entry lives together).
 */
const templatesKey = (organizationId: string) => ['documentTemplates', organizationId];

export function useDocumentTemplates(organizationId: string) {
  return useQuery({ queryKey: templatesKey(organizationId), queryFn: () => fetchDocumentTemplates(organizationId), enabled: Boolean(organizationId) });
}

export function useCreateDocumentTemplate(organizationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: { name: string; documentTypeKey: string; category: DocumentTemplateCategory; body: string }) =>
      createDocumentTemplate({ organizationId, ...params }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: templatesKey(organizationId) }),
  });
}

export function useCreateDocumentTemplateVersion(organizationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: { templateId: string; body: string }) => createDocumentTemplateVersion({ organizationId, ...params }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: templatesKey(organizationId) }),
  });
}

export function useCloneDocumentTemplate(organizationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: { sourceTemplateId: string; name: string }) => cloneDocumentTemplate({ organizationId, ...params }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: templatesKey(organizationId) }),
  });
}

export function useArchiveDocumentTemplate(organizationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (templateId: string) => archiveDocumentTemplate({ organizationId, templateId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: templatesKey(organizationId) }),
  });
}

export function useRestoreDocumentTemplate(organizationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (templateId: string) => restoreDocumentTemplate({ organizationId, templateId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: templatesKey(organizationId) }),
  });
}

/** Not cached — a preview is recomputed fresh on demand, never reused
    across an edit (the whole point is showing the *current* draft). */
export function usePreviewDocumentTemplate(organizationId: string) {
  return useMutation({
    mutationFn: (params: { templateId: string; body?: string; caseId?: string }) => previewDocumentTemplate({ organizationId, ...params }),
  });
}
