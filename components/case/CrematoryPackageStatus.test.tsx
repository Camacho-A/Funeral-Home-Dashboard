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
/** The permit PDF preview (2026-10) — pdf.js cannot draw in jsdom, so it is
    stood in for: it reports the stored checksum as shown, or fails. Its own
    behaviour is tested in PermitPdfPreview.test.tsx. */
const { preview } = vi.hoisted(() => ({ preview: { result: 'shown' as 'shown' | 'failed' | 'pending' } }));
vi.mock('@/components/crematory/PermitPdfPreview', async () => {
  const { useEffect } = await import('react');
  return {
    PermitPdfPreview: ({ source, fileName, onVerified, onFailed }: { source: { kind: string; expectedChecksumSha256?: string; url?: string }; fileName: string; onVerified: (c: string) => void; onFailed: () => void }) => {
      useEffect(() => {
        if (preview.result === 'shown') onVerified(source.kind === 'stored' ? source.expectedChecksumSha256! : 'sha-local-file');
        if (preview.result === 'failed') onFailed();
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, []);
      return <div data-testid="permit-preview" data-url={source.url ?? ''}>{preview.result === 'failed' ? 'The permit could not be shown.' : `Showing ${fileName}`}</div>;
    },
  };
});
const { CrematoryPackageStatus, preparationDue, packageHeadline } = await import('./CrematoryPackageStatus');

const req = (key: string, ok: boolean, detail: string | null = null) => ({ key: key as CrematoryRequirementKey, label: key, ok, detail });
const OK = ['cremation', 'permit_uploaded', 'permit_verified', 'crematory_form', 'workflow_2', 'package_name', 'ready_date', 'not_sent', 'package', 'permission'].map((k) => req(k, true));
const summary = (over: Partial<CrematoryCaseSummary> = {}): CrematoryCaseSummary =>
  ({
    caseId: '1042', caseNumber: 'B2026-901', decedentDisplayName: 'Richard Reynolds',
    packageName: { confirmed: { first: 'Richard', last: 'Reynolds' }, suggested: null, suggestedFrom: null }, subjectName: 'Richard Reynolds',
    readiness: { requirements: OK, readyToBuild: true, readyToSend: true },
    permit: null, readyDate: { suggested: '11/06/2026', confirmed: '11/06/2026' },
    package: { documentId: 'pkg', version: 2, fileName: 'REYNOLDS_RICHARD_CREMATORY_PACKAGE_11-06-2026.pdf', current: true },
    expectedFileName: 'REYNOLDS_RICHARD_CREMATORY_PACKAGE_11-06-2026.pdf', lastSubmission: null, untypedDocuments: [],
    workflow2: { displayStage: 2, medicalExaminer: false, missing: [] }, previousSend: { indicated: false, recorded: null }, ...over,
  }) as CrematoryCaseSummary;
const show = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <CrematoryPackageStatus organizationId="managed-cremations" caseId="1042" />
    </QueryClientProvider>,
  );

describe('CrematoryPackageStatus', () => {
  it('a current package with nothing else outstanding: ready for final review and sending, its file name and version, every source ticked', async () => {
    fetchCrematoryCaseSummary.mockResolvedValue(summary());
    show();
    expect(await screen.findByText('Ready for final review and sending')).toBeInTheDocument();
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
    const PERMIT = { documentId: 'permit-1042', fileName: 'FICTIONAL PERMIT.pdf', createdAt: '2026-10-20T10:00:00.000Z', uploadedBy: 'Dana', checksumSha256: 'sha-permit-1042', version: 1 };
    const choose = (name = 'FICTIONAL PERMIT CORRECTED.pdf') =>
      fireEvent.change(screen.getByLabelText('New State Cremation Permit for Richard Reynolds'), { target: { files: [new File([new Uint8Array([1])], name, { type: 'application/pdf' })] } });

    it('staff who prepare replace the permit of a case not yet sent — naming the permit it replaces, after confirming', async () => {
      uploadCaseDocument.mockResolvedValue({ id: 'permit-1042-v2' });
      fetchCrematoryCaseSummary.mockResolvedValue(summary({ permit: PERMIT, canPrepare: true }));
      show();
      expect(await screen.findByText(/FICTIONAL PERMIT\.pdf/)).toBeInTheDocument();
      choose();
      expect(screen.getByText(/The current permit is kept as an earlier version/)).toBeInTheDocument();
      // The new PDF itself is shown in the window before it can replace the permit (2026-10).
      expect(screen.getByTestId('permit-preview')).toHaveTextContent('Showing FICTIONAL PERMIT CORRECTED.pdf');
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

    it('a new PDF that cannot be shown cannot replace the permit (2026-10)', async () => {
      preview.result = 'failed';
      fetchCrematoryCaseSummary.mockResolvedValue(summary({ permit: PERMIT, canPrepare: true }));
      show();
      await screen.findByText(/FICTIONAL PERMIT\.pdf/);
      choose();
      expect(screen.getAllByRole('button', { name: 'Replace permit' }).at(-1)).toBeDisabled();
      preview.result = 'shown';
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

  it('a possible earlier send outside SOLIS is flagged here too (2026-10)', async () => {
    fetchCrematoryCaseSummary.mockResolvedValue(summary({ previousSend: { indicated: true, recorded: null } }));
    show();
    expect(await screen.findByRole('alert')).toHaveTextContent('may already have been sent to the crematory outside SOLIS');
  });

  it('checks again while SOLIS is due to prepare something — page 3 from an Arrangement Form on the case, or the package — and not once it is current or sent (2026-10)', () => {
    expect(preparationDue(summary())).toBe(false);
    expect(preparationDue(summary({ package: { documentId: 'pkg', version: 1, fileName: 'x.pdf', current: false } }))).toBe(true);
    const page3 = (detail: string) => summary({ readiness: { requirements: [...OK.filter((r) => r.key !== 'crematory_form'), req('crematory_form', false, detail)], readyToBuild: false, readyToSend: false } });
    expect(preparationDue(page3('Extract the Crematory Form (page 3) from the Arrangement Form.'))).toBe(true);
    expect(preparationDue(page3('The completed Arrangement Form has not been received yet.'))).toBe(false);
    const sent = { submissionId: 's', status: 'submitted' as const, packageDocumentId: 'pkg', packageVersion: 1, attachmentName: 'x.pdf', to: [], cc: [], mailbox: null, internetMessageId: null, error: null, at: '2026-10-27T15:00:00.000Z', by: null };
    expect(preparationDue(summary({ package: { documentId: 'pkg', version: 1, fileName: 'x.pdf', current: false }, lastSubmission: sent }))).toBe(false);
  });

  describe('the status line follows the server\'s readiness, never the PDF alone (2026-10)', () => {
    const without = (...keys: string[]) => [...OK.filter((r) => !keys.includes(r.key)), ...keys.map((k) => req(k, false))];
    const sent = { submissionId: 's', status: 'submitted' as const, packageDocumentId: 'pkg', packageVersion: 2, attachmentName: 'x.pdf', to: [], cc: [], mailbox: null, internetMessageId: null, error: null, at: '2026-10-27T15:00:00.000Z', by: null };
    it.each([
      ['prepared, Workflow 2 outstanding', summary({ readiness: { requirements: without('workflow_2'), readyToBuild: true, readyToSend: false } }), 'Package prepared — Workflow 2 required before sending.', 'warn'],
      ['prepared, something else outstanding', summary({ readiness: { requirements: without('previous_send'), readyToBuild: true, readyToSend: false } }), 'Package prepared — previous_send required before sending.', 'warn'],
      ['ready for the final review', summary(), 'Ready for final review and sending', 'ok'],
      ['ready, though this viewer may not send', summary({ readiness: { requirements: without('permission'), readyToBuild: true, readyToSend: false } }), 'Ready for final review and sending', 'ok'],
      ['being prepared', summary({ package: { documentId: 'pkg', version: 1, fileName: 'x.pdf', current: false } }), 'Being prepared', 'neutral'],
      ['missing information', summary({ package: null, readiness: { requirements: without('permit_uploaded', 'permit_verified', 'package'), readyToBuild: false, readyToSend: false } }), 'Needs attention', 'warn'],
      ['sent through SOLIS', summary({ lastSubmission: sent }), 'Sent to the crematory', 'ok'],
      ['send unclear', summary({ lastSubmission: { ...sent, status: 'uncertain' as const } }), 'Send outcome unclear', 'warn'],
      ['last send failed', summary({ lastSubmission: { ...sent, status: 'failed' as const } }), 'Ready for final review and sending (the last send failed)', 'ok'],
      ['recorded as sent outside SOLIS', summary({ previousSend: { indicated: false, recorded: { decision: 'sent_outside_solis', method: 'email', sentOn: null, verification: 'x', recordedBy: null, recordedAt: '2026-10-29T00:00:00.000Z' } } }), 'Recorded as sent outside SOLIS', 'neutral'],
      ['possible earlier send', summary({ previousSend: { indicated: true, recorded: null } }), 'Possible earlier send', 'warn'],
    ] as const)('%s', (_name, s_, text, tone) => {
      const headline = packageHeadline(s_ as CrematoryCaseSummary);
      expect(headline.text).toContain(text);
      expect(headline.tone).toBe(tone);
    });
  });

  it('not a cremation case: nothing shown', async () => {
    fetchCrematoryCaseSummary.mockResolvedValue(summary({ readiness: { requirements: [req('cremation', false), ...OK.slice(1)], readyToBuild: false, readyToSend: false } }));
    const { container } = show();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(container).toBeEmptyDOMElement();
  });
});
