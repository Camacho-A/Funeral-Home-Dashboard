import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { CrematoryCaseSummary } from '@/lib/crematoryClient';
import type { CrematoryRequirementKey } from '@/domain/crematory/crematoryReadiness';

/** Crematory Package status on the Documents tab (2026-10). Fictional case. */
const { fetchCrematoryCaseSummary } = vi.hoisted(() => ({ fetchCrematoryCaseSummary: vi.fn() }));
vi.mock('@/lib/crematoryClient', async () => ({ ...(await vi.importActual<object>('@/lib/crematoryClient')), fetchCrematoryCaseSummary }));
const { uploadCaseDocument } = vi.hoisted(() => ({ uploadCaseDocument: vi.fn() }));
vi.mock('@/lib/caseDocumentsClient', async () => ({ ...(await vi.importActual<object>('@/lib/caseDocumentsClient')), uploadCaseDocument }));
const { CrematoryPackageStatus } = await import('./CrematoryPackageStatus');

const req = (key: string, ok: boolean, detail: string | null = null) => ({ key: key as CrematoryRequirementKey, label: key, ok, detail });
const OK = ['cremation', 'permit_uploaded', 'permit_verified', 'crematory_form', 'workflow_2', 'package_name', 'ready_date', 'not_sent', 'package', 'permission'].map((k) => req(k, true));
const summary = (over: Partial<CrematoryCaseSummary> = {}): CrematoryCaseSummary =>
  ({
    caseId: '1042', caseNumber: 'B2026-901', decedentDisplayName: 'Richard Reynolds',
    packageName: { confirmed: { first: 'Richard', last: 'Reynolds' }, suggested: null, suggestedFrom: null }, subjectName: 'Richard Reynolds',
    readiness: { requirements: OK, readyToBuild: true, readyToSend: true },
    permit: null, readyDate: { suggested: '11/06/2026', confirmed: '11/06/2026' },
    package: { documentId: 'pkg', version: 2, fileName: 'REYNOLDS_RICHARD_CREMATORY_PACKAGE_11-06-2026.pdf', current: true },
    expectedFileName: 'REYNOLDS_RICHARD_CREMATORY_PACKAGE_11-06-2026.pdf', lastSubmission: null, untypedDocuments: [], ...over,
  }) as CrematoryCaseSummary;
const show = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <CrematoryPackageStatus organizationId="managed-cremations" caseId="1042" />
    </QueryClientProvider>,
  );

describe('CrematoryPackageStatus', () => {
  it('a current package: Ready, its file name and version, every source ticked', async () => {
    fetchCrematoryCaseSummary.mockResolvedValue(summary());
    show();
    expect(await screen.findByText('Ready')).toBeInTheDocument();
    expect(screen.getByText(/REYNOLDS_RICHARD_CREMATORY_PACKAGE_11-06-2026\.pdf · v2/)).toBeInTheDocument();
    expect(screen.getByText(/Arrangement Form page 3 \(Crematory Form\)/)).toBeInTheDocument();
  });

  it('something missing: Needs attention, with what to do', async () => {
    fetchCrematoryCaseSummary.mockResolvedValue(
      summary({
        readiness: { requirements: [...OK.filter((r) => r.key !== 'permit_verified' && r.key !== 'package'), req('permit_verified', false, 'Confirm the uploaded permit is the approved permit for this decedent.'), req('package', false)], readyToBuild: false, readyToSend: false },
        package: null,
      }),
    );
    show();
    expect(await screen.findByText('Needs attention')).toBeInTheDocument();
    expect(screen.getByText(/Confirm the uploaded permit is the approved permit/)).toBeInTheDocument();
  });

  describe('Replace permit (2026-10)', () => {
    const PERMIT = { documentId: 'permit-1042', fileName: 'FICTIONAL PERMIT.pdf', createdAt: '2026-10-20T10:00:00.000Z', uploadedBy: 'Dana' };
    const choose = (name = 'FICTIONAL PERMIT CORRECTED.pdf') =>
      fireEvent.change(screen.getByLabelText('New State Cremation Permit for Richard Reynolds'), { target: { files: [new File([new Uint8Array([1])], name, { type: 'application/pdf' })] } });

    it('staff who prepare replace the permit of a case not yet sent — naming the permit it replaces, after confirming', async () => {
      uploadCaseDocument.mockResolvedValue({ id: 'permit-1042-v2' });
      fetchCrematoryCaseSummary.mockResolvedValue(summary({ permit: PERMIT, canPrepare: true }));
      show();
      expect(await screen.findByText(/FICTIONAL PERMIT\.pdf/)).toBeInTheDocument();
      choose();
      expect(screen.getByText(/The current permit is kept as an earlier version/)).toBeInTheDocument();
      expect(uploadCaseDocument).not.toHaveBeenCalled();
      // The confirmation's own Replace permit button (the last one).
      fireEvent.click(screen.getAllByRole('button', { name: 'Replace permit' }).at(-1)!);
      await waitFor(() => expect(uploadCaseDocument).toHaveBeenCalledTimes(1));
      expect(uploadCaseDocument.mock.calls[0][0]).toMatchObject({ organizationId: 'managed-cremations', caseId: '1042', documentTypeKey: 'cremation_form.state_permit', replacesDocumentId: 'permit-1042' });
      await waitFor(() => expect(screen.queryByText(/The current permit is kept as an earlier version/)).toBeNull());
    });

    it('a refused replacement (the same file, or another replacement first) says why and changes nothing', async () => {
      uploadCaseDocument.mockRejectedValue(new Error("This file is already this case's State Cremation Permit (\"FICTIONAL PERMIT.pdf\"). Nothing was uploaded."));
      fetchCrematoryCaseSummary.mockResolvedValue(summary({ permit: PERMIT, canPrepare: true }));
      show();
      await screen.findByText(/FICTIONAL PERMIT\.pdf/);
      choose('FICTIONAL PERMIT.pdf');
      fireEvent.click(screen.getAllByRole('button', { name: 'Replace permit' }).at(-1)!);
      expect(await screen.findByRole('alert')).toHaveTextContent('Nothing was uploaded');
    });

    it('not offered once the case is sent (or its send is unclear), nor to staff who cannot prepare', async () => {
      const sent = { submissionId: 's', status: 'submitted' as const, packageDocumentId: 'pkg', packageVersion: 2, attachmentName: 'x.pdf', to: [], cc: [], mailbox: null, internetMessageId: null, error: null, at: '2026-10-27T15:00:00.000Z', by: null };
      for (const over of [{ permit: PERMIT, canPrepare: true, lastSubmission: sent }, { permit: PERMIT, canPrepare: true, lastSubmission: { ...sent, status: 'uncertain' as const } }, { permit: PERMIT, canPrepare: false }]) {
        fetchCrematoryCaseSummary.mockResolvedValue(summary(over));
        const { unmount } = show();
        expect(await screen.findByText(/FICTIONAL PERMIT\.pdf/)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Replace permit' })).toBeNull();
        unmount();
      }
    });
  });

  it('not a cremation case: nothing shown', async () => {
    fetchCrematoryCaseSummary.mockResolvedValue(summary({ readiness: { requirements: [req('cremation', false), ...OK.slice(1)], readyToBuild: false, readyToSend: false } }));
    const { container } = show();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(container).toBeEmptyDOMElement();
  });
});
