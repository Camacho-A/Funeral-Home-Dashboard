import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { NewDocumentInput } from '@/types/document';
import { documentsService } from '@/services/documentsService';
import { useOrganization } from './useOrganization';

export function useCaseDocuments(caseId: string) {
  const organization = useOrganization();
  const queryClient = useQueryClient();
  const queryKey = ['caseDocuments', organization.organizationId, caseId];

  const query = useQuery({
    queryKey,
    queryFn: () => documentsService.list(organization, caseId),
  });

  const upload = useMutation({
    mutationFn: ({ input, file }: { input: NewDocumentInput; file?: File }) =>
      documentsService.upload(organization, caseId, input, file),
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });

  const remove = useMutation({
    mutationFn: (documentId: string) => documentsService.remove(organization, documentId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });

  return { ...query, upload: upload.mutate, remove: remove.mutate, getFile: documentsService.getFile };
}
