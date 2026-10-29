import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

/** Uploads and archives refresh the Crematory Package status too (2026-10). Fictional ids. */
vi.mock('@/lib/caseDocumentsClient', async () => ({
  ...(await vi.importActual<object>('@/lib/caseDocumentsClient')),
  uploadCaseDocument: vi.fn().mockResolvedValue({ id: 'doc-new' }),
  archiveCaseDocument: vi.fn().mockResolvedValue({ id: 'doc-old' }),
}));
const { useUploadCaseDocument, useArchiveCaseDocument, caseDocumentsKey } = await import('./useCaseDocumentLibrary');

function setup() {
  const queryClient = new QueryClient();
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  return { invalidate, wrapper };
}

describe('useCaseDocumentLibrary — refreshing after a change', () => {
  it('an upload refreshes the documents and the Crematory Package status', async () => {
    const { invalidate, wrapper } = setup();
    const { result } = renderHook(() => useUploadCaseDocument('managed-cremations', 'case-1'), { wrapper });
    await act(() => result.current.mutateAsync({ file: new File([new Uint8Array([1])], 'x.pdf', { type: 'application/pdf' }), documentTypeKey: 'cremation_form.state_permit' }));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: caseDocumentsKey('managed-cremations', 'case-1') });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['crematory', 'managed-cremations'] });
  });

  it('an archive does too', async () => {
    const { invalidate, wrapper } = setup();
    const { result } = renderHook(() => useArchiveCaseDocument('managed-cremations', 'case-1'), { wrapper });
    await act(() => result.current.mutateAsync({ documentId: 'doc-old' }));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['crematory', 'managed-cremations'] });
  });
});
