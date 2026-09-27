import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useGenerateStatement } from './useBilling';
import { OrganizationProvider } from './useOrganization';
import * as billingClient from '@/lib/billingClient';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import type { CaseDocument } from '@/types/caseDocument';

/**
 * Item #1 fix (2026-09). `useGenerateStatement` used to invalidate the
 * obsolete `['caseDocuments', caseId]` key — a stale reference to the
 * removed Overview DocumentsCard's own cache, which never matched the
 * real Documents tab's `['caseDocumentLibrary', organizationId, caseId]`
 * key at all. This is a cache-level fact (which keys got invalidated),
 * not something visible in any one component's rendered DOM, so it's
 * tested at the hook level directly — mirroring useCaseTasks.test.tsx's
 * own precedent for exactly this kind of assertion.
 */
vi.mock('@/lib/billingClient', () => ({
  generateStatement: vi.fn(),
}));

const CASE_ID = 'case-1';
const DOCUMENT: CaseDocument = {
  id: 'doc-1',
  organizationId: DEFAULT_ORGANIZATION_ID,
  caseId: CASE_ID,
  origin: 'generated',
  documentTypeKey: 'financial.statement_goods_services',
  category: 'statement',
  fileName: 'Statement of Funeral Goods and Services Selected.pdf',
  mimeType: 'application/pdf',
  fileSizeBytes: 1,
  checksumSha256: 'abc',
  storageKey: 'key',
  status: 'active',
  templateId: null,
  templateVersion: null,
  version: 1,
  supersedesId: null,
  signatureStatus: null,
  familyVisible: false,
  generatedBy: 'staff-1',
  uploadedBy: null,
  createdAt: '2026-09-01T00:00:00.000Z',
  correlationId: 'corr-1',
};

function renderWithClient() {
  const queryClient = new QueryClient();
  const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <OrganizationProvider organizationId={DEFAULT_ORGANIZATION_ID}>{children}</OrganizationProvider>
    </QueryClientProvider>
  );

  const rendered = renderHook(() => useGenerateStatement(DEFAULT_ORGANIZATION_ID, CASE_ID), { wrapper });
  return { ...rendered, queryClient, invalidateSpy };
}

beforeEach(() => {
  vi.mocked(billingClient.generateStatement).mockResolvedValue(DOCUMENT);
});

describe('useGenerateStatement — Documents-tab cache invalidation (item #1, 2026-09)', () => {
  it('5: invalidates the real Documents tab key [\'caseDocumentLibrary\', organizationId, caseId]', async () => {
    const { result, invalidateSpy } = renderWithClient();

    await act(async () => {
      await result.current.mutateAsync({});
    });

    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['caseDocumentLibrary', DEFAULT_ORGANIZATION_ID, CASE_ID] }),
    );
  });

  it("6: no longer invalidates the obsolete ['caseDocuments', caseId] key", async () => {
    const { result, invalidateSpy } = renderWithClient();

    await act(async () => {
      await result.current.mutateAsync({});
    });

    const invalidatedKeys = invalidateSpy.mock.calls.map((call) => (call[0] as { queryKey: unknown[] }).queryKey);
    expect(invalidatedKeys).not.toContainEqual(['caseDocuments', CASE_ID]);
    expect(invalidatedKeys.some((k) => k[0] === 'caseDocuments')).toBe(false);
  });
});
