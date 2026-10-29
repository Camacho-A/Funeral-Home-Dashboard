import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { CrematoryCaseSummary, CrematoryOverview } from '@/lib/crematoryClient';

/** Send to Crematory (2026-10). The window with the server faked; fictional cases and recipients. */
const { client } = vi.hoisted(() => ({
  client: { fetchCrematoryOverview: vi.fn(), crematoryCaseAction: vi.fn(), sendToCrematory: vi.fn(), reviewCrematorySend: vi.fn() },
}));
vi.mock('@/lib/crematoryClient', async () => {
  const actual = await vi.importActual<typeof import('@/lib/crematoryClient')>('@/lib/crematoryClient');
  return { ...actual, ...client };
});
vi.mock('@/lib/caseDocumentsClient', async () => {
  const actual = await vi.importActual<typeof import('@/lib/caseDocumentsClient')>('@/lib/caseDocumentsClient');
  return { ...actual, uploadCaseDocument: vi.fn(), extractArrangementPage: vi.fn() };
});

const { router } = vi.hoisted(() => ({ router: { push: vi.fn(), replace: vi.fn() } }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
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
const { SendToCrematoryDialog } = await import('./SendToCrematoryDialog');
const { CrematoryRequestError } = await import('@/lib/crematoryClient');

const requirement = (key: string, ok: boolean, detail: string | null = null) => ({ key, label: key, ok, detail });
const ALL_OK = ['cremation', 'permit_uploaded', 'permit_verified', 'crematory_form', 'workflow_2', 'ready_date', 'package', 'permission'].map((k) => requirement(k, true));

function readyCase(caseId: string, name: string, number: string, date = '11/06/2026', fileName?: string): CrematoryCaseSummary {
  const [first, ...rest] = name.split(' ');
  return {
    caseId,
    caseNumber: number,
    decedentDisplayName: name,
    packageName: { confirmed: { first, last: rest.join(' ') }, suggested: null, suggestedFrom: null, recordedFrom: 'staff' },
    subjectName: name,
    readiness: { requirements: ALL_OK as never, readyToBuild: true, readyToSend: true },
    permit: { documentId: `permit-${caseId}`, fileName: 'State Permit.pdf', createdAt: '2026-10-27T15:00:00.000Z', uploadedBy: 'Dana', checksumSha256: `sha-permit-${caseId}`, version: 1 },
    readyDate: { suggested: date, confirmed: date, recordedFrom: 'expected_pickup' },
    package: { documentId: `pkg-${caseId}`, version: 1, fileName: fileName ?? `${rest.join(' ')}_${first}_${date.replace(/\//g, '-')}.pdf`, current: true },
    expectedFileName: null,
    lastSubmission: null,
    untypedDocuments: [],
    workflow2: { displayStage: 2, medicalExaminer: false, missing: [] },
    previousSend: { indicated: false, recorded: null },
  };
}

const notReady: CrematoryCaseSummary = {
  ...readyCase('1050', 'Walter Boone', 'B2026-903'),
  readiness: {
    requirements: [requirement('permit_uploaded', true), requirement('permit_verified', false, 'Confirm the uploaded permit is the approved permit for this decedent.'), requirement('ready_date', false, 'Enter or confirm the expected cremation ready date.')] as never,
    readyToBuild: false,
    readyToSend: false,
  },
  readyDate: { suggested: '11/06/2026', confirmed: null, recordedFrom: null },
  package: null,
};

const overview = (candidates: CrematoryCaseSummary[], over: Partial<CrematoryOverview> = {}): CrematoryOverview => ({
  candidates,
  settings: { to: ['intake@crematory.example'], cc: [] },
  mailbox: { connected: true, configured: true, accountEmail: 'office@funeralhome.example', status: 'connected', connectedAt: '2026-10-27T15:00:00.000Z', connectedBy: 'identity-admin' },
  organizationName: 'Manors Cremation',
  canSend: true,
  canPrepare: true,
  ...over,
});

afterEach(() => {
  vi.clearAllMocks();
  preview.result = 'shown';
});
// The server's final review (2026-10): only its fingerprint is used by this window.
beforeEach(() => client.reviewCrematorySend.mockResolvedValue({ fingerprint: 'v1:reviewed', cases: [], to: [], cc: [], subject: '', message: '', mailbox: null }));
const onClose = vi.fn();
const open = (props: { caseId?: string; preselectedCaseIds?: string[]; onResolveWorkflow?: (caseId: string, stage: number) => void } = {}) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SendToCrematoryDialog open onClose={onClose} organizationId="managed-cremations" {...props} />
    </QueryClientProvider>,
  );

describe('SendToCrematoryDialog', () => {
  it('shows what a case still needs, with the action for it; a case that is not ready cannot be selected', async () => {
    client.fetchCrematoryOverview.mockResolvedValue(overview([notReady]));
    client.crematoryCaseAction.mockResolvedValue({});
    open();
    expect(await screen.findByRole('button', { name: 'Confirm permit' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Select Walter Boone' })).toBeDisabled();
    expect(screen.getByText('1 of 7 done')).toBeInTheDocument();
    // Steps that wait on earlier ones say so instead of offering an action —
    // the package does; page 3 never waits on the permit (2026-10).
    expect(screen.getByText('After the steps above')).toBeInTheDocument();
    expect(screen.queryByText('After the step above')).toBeNull();

    // The date is suggested from the Expected Pickup but has to be confirmed.
    expect(screen.getByLabelText('Expected ready date for Walter Boone')).toHaveValue('2026-11-06');
    fireEvent.click(screen.getByRole('button', { name: 'Confirm date' }));
    await waitFor(() => expect(client.crematoryCaseAction).toHaveBeenCalledWith('managed-cremations', '1050', { action: 'confirm_ready_date', date: '2026-11-06' }));

    // The permit is confirmed only after an explicit yes naming the decedent.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Confirm permit' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Confirm permit' }));
    const question = screen.getByText((_, element) => element?.tagName === 'P' && /approved state cremation permit for/.test(element.textContent ?? ''));
    expect(question).toHaveTextContent('Is State Permit.pdf (uploaded by Dana');
    expect(question).toHaveTextContent('the approved state cremation permit for Walter Boone (B2026-903)?');
    fireEvent.click(screen.getByRole('button', { name: 'Yes, this is the approved permit' }));
    await waitFor(() => expect(client.crematoryCaseAction).toHaveBeenCalledWith('managed-cremations', '1050', { action: 'confirm_permit', documentId: 'permit-1050', displayedChecksumSha256: 'sha-permit-1050' }));
    expect(screen.getByRole('button', { name: 'Review email' })).toBeDisabled();
  });

  it('several ready cases: one email, one PDF each, the shared-date subject — and sends only after review', async () => {
    client.fetchCrematoryOverview.mockResolvedValue(overview([readyCase('1042', 'Richard Reynolds', 'B2026-901'), readyCase('1044', 'Estela Salas Rueda', 'B2026-902')]));
    client.sendToCrematory.mockResolvedValue({
      status: 'submitted',
      duplicate: false,
      mailbox: 'office@funeralhome.example',
      internetMessageId: '<m@x>',
      to: ['intake@crematory.example'],
      cc: [],
      attachments: [
        { caseId: '1042', caseNumber: 'B2026-901', decedentDisplayName: 'Richard Reynolds', attachmentName: 'Reynolds_Richard_11-06-2026.pdf', packageDocumentId: 'pkg-1042', packageVersion: 1 },
        { caseId: '1044', caseNumber: 'B2026-902', decedentDisplayName: 'Estela Salas Rueda', attachmentName: 'Salas Rueda_Estela_11-06-2026.pdf', packageDocumentId: 'pkg-1044', packageVersion: 1 },
      ],
    });
    open({ preselectedCaseIds: ['1042'] });
    expect(await screen.findByRole('checkbox', { name: 'Select Richard Reynolds' })).toBeChecked();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Estela Salas Rueda' }));
    fireEvent.click(screen.getByRole('button', { name: 'Review email (2)' }));
    await screen.findByLabelText('Subject');

    expect(screen.getByLabelText('Subject')).toHaveValue('Manors Cremation — 2 Cases for Crematory — Expected 11/06/2026');
    expect(screen.getByLabelText('To')).toHaveValue('intake@crematory.example');
    expect(screen.getByText('Reynolds_Richard_11-06-2026.pdf')).toBeInTheDocument();
    expect(screen.getByText('Salas Rueda_Estela_11-06-2026.pdf')).toBeInTheDocument();
    expect(screen.getByText(/From/)).toHaveTextContent('office@funeralhome.example');

    const sendButton = screen.getByRole('button', { name: 'Send to Crematory (2)' });
    expect(sendButton).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: /I reviewed the recipients/ }));
    fireEvent.click(sendButton);
    expect(await screen.findByText(/Submitted to Outlook from office@funeralhome.example/)).toHaveTextContent('not that the crematory received it');
    expect(client.sendToCrematory).toHaveBeenCalledTimes(1);
    expect(client.sendToCrematory.mock.calls[0][0]).toMatchObject({ caseIds: ['1042', '1044'], to: ['intake@crematory.example'], cc: [], confirmResend: false, subject: 'Manors Cremation — 2 Cases for Crematory — Expected 11/06/2026' });
    // Sent only as reviewed: the server's review fingerprint, and the staff member's acknowledgment.
    expect(client.reviewCrematorySend).toHaveBeenCalledWith('managed-cremations', ['1042', '1044']);
    expect(client.sendToCrematory.mock.calls[0][0]).toMatchObject({ reviewFingerprint: 'v1:reviewed', acknowledged: true });
  });

  it('if the server will not prepare the review (a case changed or is still being prepared), the email is not shown and nothing is sent', async () => {
    client.fetchCrematoryOverview.mockResolvedValue(overview([readyCase('1042', 'Richard Reynolds', 'B2026-901')]));
    client.reviewCrematorySend.mockRejectedValueOnce(new CrematoryRequestError('Nothing was sent. B2026-901 is still being prepared. Try again in a moment.', 409));
    open({ caseId: '1042' });
    fireEvent.click(await screen.findByRole('button', { name: 'Review email (1)' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('still being prepared');
    expect(screen.queryByLabelText('Subject')).toBeNull();
    expect(client.sendToCrematory).not.toHaveBeenCalled();
  });

  it('one case from the case page: the single-decedent subject', async () => {
    client.fetchCrematoryOverview.mockResolvedValue(overview([readyCase('1042', 'Richard Reynolds', 'B2026-901')]));
    open({ caseId: '1042' });
    fireEvent.click(await screen.findByRole('button', { name: 'Review email (1)' }));
    await screen.findByLabelText('Subject');
    expect(screen.getByLabelText('Subject')).toHaveValue('Manors Cremation — Richard Reynolds — Expected 11/06/2026');
    expect(client.fetchCrematoryOverview).toHaveBeenCalledWith('managed-cremations', '1042');
  });

  it('different dates never share a date in the subject', async () => {
    client.fetchCrematoryOverview.mockResolvedValue(overview([readyCase('1042', 'Richard Reynolds', 'B2026-901'), readyCase('1044', 'Estela Salas Rueda', 'B2026-902', '11/07/2026')]));
    open({ preselectedCaseIds: ['1042', '1044'] });
    fireEvent.click(await screen.findByRole('button', { name: 'Review email (2)' }));
    await screen.findByLabelText('Subject');
    expect(screen.getByLabelText('Subject')).toHaveValue('Manors Cremation — 2 Cases for Crematory');
  });

  it('opening the window prepares, once, the cases whose page 3 or package can be brought up to date — never sends', async () => {
    const needsPage3: CrematoryCaseSummary = {
      ...readyCase('1050', 'Walter Boone', 'B2026-903'),
      readiness: { requirements: [...ALL_OK.filter((r) => r.key !== 'crematory_form'), requirement('crematory_form', false, 'A newer Arrangement Form arrived.')] as never, readyToBuild: false, readyToSend: false },
      package: null,
    };
    const outdated: CrematoryCaseSummary = {
      ...readyCase('1044', 'Estela Salas Rueda', 'B2026-902'),
      readiness: { requirements: ALL_OK as never, readyToBuild: true, readyToSend: false },
      package: { documentId: 'pkg-1044', version: 1, fileName: 'x.pdf', current: false },
    };
    const ready = readyCase('1042', 'Richard Reynolds', 'B2026-901');
    client.fetchCrematoryOverview.mockResolvedValue(overview([ready, outdated, needsPage3]));
    client.crematoryCaseAction.mockResolvedValue({});
    open();
    await waitFor(() => expect(client.crematoryCaseAction).toHaveBeenCalledTimes(2));
    expect(client.crematoryCaseAction.mock.calls.map(([, caseId, action]) => [caseId, action])).toEqual([
      ['1044', { action: 'prepare' }],
      ['1050', { action: 'prepare' }],
    ]);
    // Refetched afterwards; still only those two, once each.
    await waitFor(() => expect(client.fetchCrematoryOverview.mock.calls.length).toBeGreaterThan(1));
    expect(client.crematoryCaseAction).toHaveBeenCalledTimes(2);
    expect(client.sendToCrematory).not.toHaveBeenCalled();
  });

  it('a permit uploaded without a type: staff choose it from the case\'s documents — likely match first, never pre-selected', async () => {
    const needsPermit: CrematoryCaseSummary = {
      ...readyCase('1050', 'Walter Boone', 'B2026-903'),
      readiness: { requirements: [...ALL_OK.filter((r) => !['permit_uploaded', 'permit_verified', 'package'].includes(r.key)), requirement('permit_uploaded', false, 'Upload the approved state cremation permit.'), requirement('permit_verified', false, 'Upload the permit first.'), requirement('package', false)] as never, readyToBuild: false, readyToSend: false },
      permit: null,
      package: null,
      untypedDocuments: [
        { documentId: 'doc-pay', fileName: 'BOONE PAYMENT.pdf', createdAt: '2026-10-01T10:00:00.000Z', suggestedAs: null, checksumSha256: 'sha-doc-pay' },
        { documentId: 'doc-permit', fileName: 'BOONE PERMIT.pdf', createdAt: '2026-10-02T10:00:00.000Z', suggestedAs: 'state_permit', checksumSha256: 'sha-doc-permit' },
      ],
    };
    client.fetchCrematoryOverview.mockResolvedValue(overview([needsPermit]));
    client.crematoryCaseAction.mockResolvedValue({});
    open();
    fireEvent.click(await screen.findByRole('button', { name: 'Choose from this case’s documents' }));
    const dialog = await screen.findByRole('dialog', { name: 'Choose the State Cremation Permit' });
    const options = within(dialog).getAllByRole('radio');
    expect(options.map((o) => (o.closest('label') as HTMLElement).textContent?.trim())).toEqual(['BOONE PERMIT.pdf', 'BOONE PAYMENT.pdf']);
    expect(options.every((o) => !(o as HTMLInputElement).checked)).toBe(true);
    expect(within(dialog).getByText(/Suggested — its name mentions a permit/)).toBeInTheDocument();
    const use = within(dialog).getByRole('button', { name: 'Use as the State Cremation Permit' });
    expect(use).toBeDisabled();
    fireEvent.click(options[0]);
    fireEvent.click(use);
    await waitFor(() => expect(client.crematoryCaseAction).toHaveBeenCalledWith('managed-cremations', '1050', { action: 'assign_document', documentId: 'doc-permit', as: 'state_permit', displayedChecksumSha256: 'sha-doc-permit' }));
  });

  it('while a case is prepared its checklist shows "Preparing…", then refreshes; a failure says so and can be retried', async () => {
    const outdated: CrematoryCaseSummary = {
      ...readyCase('1044', 'Estela Salas Rueda', 'B2026-902'),
      readiness: { requirements: ALL_OK as never, readyToBuild: true, readyToSend: false },
      package: { documentId: 'pkg-1044', version: 1, fileName: 'x.pdf', current: false },
    };
    client.fetchCrematoryOverview.mockResolvedValue(overview([outdated]));
    let finish: (value: unknown) => void = () => undefined;
    client.crematoryCaseAction.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
    open();
    const row = (await screen.findByRole('checkbox', { name: 'Select Estela Salas Rueda' })).closest('li') as HTMLElement;
    await waitFor(() => expect(within(row).getAllByText('Preparing…').length).toBeGreaterThan(0));
    expect(within(row).queryByText(/of 7 done/)).toBeNull();
    const loads = client.fetchCrematoryOverview.mock.calls.length;
    finish({ result: { crematoryForm: 'unchanged', package: 'failed' } });
    await waitFor(() => expect(within(row).getByRole('alert')).toHaveTextContent('SOLIS could not prepare the Crematory Package. Nothing was sent. Try again.'));
    expect(client.fetchCrematoryOverview.mock.calls.length).toBeGreaterThan(loads);
    client.crematoryCaseAction.mockResolvedValue({ result: { crematoryForm: 'unchanged', package: 'saved' } });
    fireEvent.click(within(row).getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(client.crematoryCaseAction).toHaveBeenLastCalledWith('managed-cremations', '1044', { action: 'prepare' }));
    await waitFor(() => expect(within(row).queryByRole('alert')).toBeNull());
    expect(client.sendToCrematory).not.toHaveBeenCalled();
  });

  it('a staff member who cannot prepare packages triggers nothing', async () => {
    const outdated: CrematoryCaseSummary = {
      ...readyCase('1044', 'Estela Salas Rueda', 'B2026-902'),
      readiness: { requirements: ALL_OK as never, readyToBuild: true, readyToSend: false },
      package: { documentId: 'pkg-1044', version: 1, fileName: 'x.pdf', current: false },
    };
    client.fetchCrematoryOverview.mockResolvedValue(overview([outdated], { canPrepare: false, canSend: false }));
    open();
    await screen.findByRole('checkbox', { name: 'Select Estela Salas Rueda' });
    expect(client.crematoryCaseAction).not.toHaveBeenCalled();
  });

  it('the review lists each attachment under the current name, even for a package built under the old one', async () => {
    client.fetchCrematoryOverview.mockResolvedValue(
      overview([{ ...readyCase('1042', 'Hannelore Willson', 'B2026-901', '10/30/2026'), expectedFileName: 'WILLSON_HANNELORE_CREMATORY_PACKAGE_10-30-2026.pdf' }]),
    );
    open({ preselectedCaseIds: ['1042'] });
    await screen.findByRole('checkbox', { name: 'Select Hannelore Willson' });
    fireEvent.click(screen.getByRole('button', { name: 'Review email (1)' }));
    await screen.findByLabelText('Subject');
    expect(screen.getByText('WILLSON_HANNELORE_CREMATORY_PACKAGE_10-30-2026.pdf')).toBeInTheDocument();
    expect(screen.queryByText('Willson_Hannelore_10-30-2026.pdf')).toBeNull();
  });

  it('Replace permit is offered on a case not yet sent (2026-10), and refreshes the case afterwards', async () => {
    const caseDocs = await import('@/lib/caseDocumentsClient');
    vi.mocked(caseDocs.uploadCaseDocument).mockResolvedValue({ id: 'permit-v2' } as never);
    client.fetchCrematoryOverview.mockResolvedValue(overview([{ ...readyCase('1042', 'Richard Reynolds', 'B2026-901'), permit: { documentId: 'permit-1042', fileName: 'FICTIONAL PERMIT.pdf', createdAt: '2026-10-20T10:00:00.000Z', uploadedBy: null, checksumSha256: 'sha-permit-1042', version: 1 } }]));
    open({ caseId: '1042' });
    await screen.findByRole('button', { name: 'Replace permit' });
    const loads = client.fetchCrematoryOverview.mock.calls.length;
    fireEvent.change(screen.getByLabelText('New State Cremation Permit for Richard Reynolds'), { target: { files: [new File([new Uint8Array([1])], 'CORRECTED.pdf', { type: 'application/pdf' })] } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Replace permit' }).at(-1)!);
    await waitFor(() => expect(caseDocs.uploadCaseDocument).toHaveBeenCalledWith(expect.objectContaining({ caseId: '1042', documentTypeKey: 'cremation_form.state_permit', replacesDocumentId: 'permit-1042' })));
    await waitFor(() => expect(client.fetchCrematoryOverview.mock.calls.length).toBeGreaterThan(loads));
  });

  it('an untyped PDF that looks like the permit is shown in the permit step to open and check; "Use as permit" picks it in the chooser — staff still choose it there (2026-10)', async () => {
    const untypedPermit: CrematoryCaseSummary = {
      ...readyCase('1050', 'Walter Gollis', 'B2026-903'),
      readiness: { requirements: [...ALL_OK.filter((r) => r.key !== 'permit_uploaded' && r.key !== 'permit_verified' && r.key !== 'package'), requirement('permit_uploaded', false, 'Upload the approved state cremation permit.'), requirement('permit_verified', false, 'Upload the permit first.'), requirement('package', false)] as never, readyToBuild: false, readyToSend: false },
      permit: null,
      package: null,
      untypedDocuments: [
        { documentId: 'doc-payment', fileName: 'GOLLIS PAYMENT.pdf', createdAt: '2026-10-13T19:00:00.000Z', suggestedAs: null, checksumSha256: 'sha-doc-payment' },
        { documentId: 'doc-permit', fileName: 'GOLLIS PERMIT.pdf', createdAt: '2026-10-14T16:36:00.000Z', suggestedAs: 'state_permit', checksumSha256: 'sha-doc-permit' },
      ],
    };
    client.fetchCrematoryOverview.mockResolvedValue(overview([untypedPermit]));
    client.crematoryCaseAction.mockResolvedValue({});
    open({ caseId: '1050' });
    const line = (await screen.findByText('GOLLIS PERMIT.pdf', { selector: 'strong' })).parentElement!;
    expect(line).toHaveTextContent('GOLLIS PERMIT.pdf may be the permit');
    expect(within(line).getByRole('link', { name: 'Open' })).toHaveAttribute('href', expect.stringContaining('doc-permit'));
    expect(screen.queryByText(/GOLLIS PAYMENT\.pdf may be/)).toBeNull();
    // Nothing is classified until staff choose it.
    expect(client.crematoryCaseAction).not.toHaveBeenCalledWith('managed-cremations', '1050', expect.objectContaining({ action: 'assign_document' }));
    fireEvent.click(within(line).getByRole('button', { name: 'Use as permit' }));
    expect(screen.getByRole('radio', { name: /GOLLIS PERMIT\.pdf/ })).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: /Use as the State Cremation Permit/ }));
    await waitFor(() => expect(client.crematoryCaseAction).toHaveBeenCalledWith('managed-cremations', '1050', { action: 'assign_document', documentId: 'doc-permit', as: 'state_permit', displayedChecksumSha256: 'sha-doc-permit' }));
  });

  describe('the permit PDF is shown before it is confirmed or chosen (2026-10)', () => {
    it('Confirm stays disabled until the stored PDF is shown; a preview that fails never allows confirming', async () => {
      client.fetchCrematoryOverview.mockResolvedValue(overview([notReady]));
      preview.result = 'pending';
      const { unmount } = open();
      fireEvent.click(await screen.findByRole('button', { name: 'Confirm permit' }));
      expect(screen.getByTestId('permit-preview')).toHaveAttribute('data-url', expect.stringContaining('permit-1050'));
      expect(screen.queryByRole('link', { name: /Open the permit/ })).toBeNull();
      expect(screen.getByRole('button', { name: 'Yes, this is the approved permit' })).toBeDisabled();
      unmount();

      preview.result = 'failed';
      open();
      fireEvent.click(await screen.findByRole('button', { name: 'Confirm permit' }));
      expect(screen.getByText('The permit could not be shown.')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Yes, this is the approved permit' })).toBeDisabled();
      expect(client.crematoryCaseAction).not.toHaveBeenCalledWith('managed-cremations', '1050', expect.objectContaining({ action: 'confirm_permit' }));
    });

    it('choosing an untyped PDF as the permit also needs it shown first', async () => {
      const untyped: CrematoryCaseSummary = {
        ...notReady,
        readiness: { requirements: [requirement('permit_uploaded', false, 'Upload the approved state cremation permit.'), requirement('permit_verified', false)] as never, readyToBuild: false, readyToSend: false },
        permit: null,
        untypedDocuments: [{ documentId: 'doc-permit', fileName: 'BOONE PERMIT.pdf', createdAt: '2026-10-02T10:00:00.000Z', suggestedAs: 'state_permit', checksumSha256: 'sha-doc-permit' }],
      };
      client.fetchCrematoryOverview.mockResolvedValue(overview([untyped]));
      preview.result = 'pending';
      open();
      fireEvent.click(await screen.findByRole('button', { name: 'Use as permit' }));
      expect(screen.getByTestId('permit-preview')).toHaveAttribute('data-url', expect.stringContaining('doc-permit'));
      expect(screen.getByRole('button', { name: /Use as the State Cremation Permit/ })).toBeDisabled();
    });
  });

  describe('correcting an earlier-send record (2026-10)', () => {
    const outside: CrematoryCaseSummary = {
      ...readyCase('1042', 'Richard Reynolds', 'B2026-901'),
      readiness: { requirements: [...ALL_OK, requirement('previous_send', false, 'Recorded as already sent to the crematory outside SOLIS (Email, 10/21/2026). It is not sent again through the first send.')] as never, readyToBuild: true, readyToSend: false },
      previousSend: { indicated: false, recorded: { decision: 'sent_outside_solis', method: 'email', sentOn: '10/21/2026', verification: 'Found in Sent Items', recordedBy: 'staff', recordedAt: '2026-10-29T15:00:00.000Z' } },
    };

    it('only administrators see Correct record; a written reason and the corrected answer are required', async () => {
      client.fetchCrematoryOverview.mockResolvedValue(overview([outside], { canManage: false }));
      const { unmount } = open({ preselectedCaseIds: ['1042'] });
      await screen.findByText('Sent outside SOLIS');
      expect(screen.queryByRole('button', { name: 'Correct record' })).toBeNull();
      unmount();

      client.fetchCrematoryOverview.mockResolvedValue(overview([outside], { canManage: true }));
      client.crematoryCaseAction.mockResolvedValue({});
      open({ preselectedCaseIds: ['1042'] });
      fireEvent.click(await screen.findByRole('button', { name: 'Correct record' }));
      expect(screen.getByText(/Recorded now:/)).toHaveTextContent('already sent outside SOLIS');
      fireEvent.click(screen.getByLabelText(/They were not previously sent/));
      fireEvent.change(screen.getByLabelText('Which sending records you checked'), { target: { value: 'Outlook Sent Items and the fax log again' } });
      fireEvent.click(screen.getByLabelText(/I checked the available sending records/));
      const record = screen.getByRole('button', { name: 'Record correction' });
      expect(record).toBeDisabled();
      fireEvent.change(screen.getByLabelText('Why the record is being corrected'), { target: { value: 'Entered on the wrong case' } });
      fireEvent.click(record);
      await waitFor(() =>
        expect(client.crematoryCaseAction).toHaveBeenCalledWith('managed-cremations', '1042', {
          action: 'correct_previous_send',
          reason: 'Entered on the wrong case',
          decision: 'not_previously_sent',
          verification: 'Outlook Sent Items and the fax log again',
          confirmedChecked: true,
        }),
      );
    });
  });

  describe('Workflow 2 (2026-10)', () => {
    const meCase: CrematoryCaseSummary = {
      ...readyCase('1042', 'Louis Fictional', 'B2026-901'),
      readiness: {
        requirements: [...ALL_OK.filter((r) => r.key !== 'workflow_2'), requirement('workflow_2', false, 'Medical Examiner case — not yet checked on the case: Medical Examiner EDRS entry verified · Required ME information confirmed.')] as never,
        readyToBuild: true,
        readyToSend: false,
      },
      workflow2: { displayStage: 2, medicalExaminer: true, missing: ['Medical Examiner EDRS entry verified', 'Required ME information confirmed'] },
    };

    it('lists the exact steps still unchecked, in Medical Examiner wording, and the package is still prepared', async () => {
      client.fetchCrematoryOverview.mockResolvedValue(overview([meCase]));
      open({ preselectedCaseIds: ['1042'] });
      expect(await screen.findByText(/Medical Examiner case — to check: Medical Examiner EDRS entry verified · Required ME information confirmed/)).toBeInTheDocument();
      expect(screen.queryByText(/sent to doctor/i)).toBeNull();
      expect(screen.queryByText(/Finish it on the/)).toBeNull();
      expect(screen.getByRole('checkbox', { name: 'Select Louis Fictional' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Review email' })).toBeDisabled();
    });

    it('Resolve Workflow 2 from All Cases closes this window and opens the case on its Workflow 2 step', async () => {
      client.fetchCrematoryOverview.mockResolvedValue(overview([meCase]));
      open({ preselectedCaseIds: ['1042'] });
      fireEvent.click(await screen.findByRole('button', { name: 'Resolve Workflow 2' }));
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(router.push).toHaveBeenCalledWith('/cases/1042?workflowStage=2');
      expect(client.crematoryCaseAction).not.toHaveBeenCalled();
    });

    it("Resolve Workflow 2 on the case's own page hands over to the page (no navigation to the same address)", async () => {
      const onResolveWorkflow = vi.fn();
      client.fetchCrematoryOverview.mockResolvedValue(overview([meCase]));
      open({ caseId: '1042', onResolveWorkflow });
      fireEvent.click(await screen.findByRole('button', { name: 'Resolve Workflow 2' }));
      expect(onResolveWorkflow).toHaveBeenCalledWith('1042', 2);
      expect(router.push).not.toHaveBeenCalled();
    });
  });

  describe('a possible earlier send outside SOLIS (2026-10)', () => {
    const WARNING = 'This case indicates that documents may already have been sent to the crematory outside SOLIS. Verify the previous send before continuing.';
    const flagged: CrematoryCaseSummary = {
      ...readyCase('1042', 'Richard Reynolds', 'B2026-901'),
      readiness: { requirements: [...ALL_OK, requirement('not_sent', true), requirement('previous_send', false, WARNING)] as never, readyToBuild: true, readyToSend: false },
      previousSend: { indicated: true, recorded: null },
    };

    it('warns, cannot be selected, and is resolved only by recording what the sending records show', async () => {
      client.fetchCrematoryOverview.mockResolvedValue(overview([flagged]));
      client.crematoryCaseAction.mockResolvedValue({});
      open({ preselectedCaseIds: ['1042'] });
      expect(await screen.findByRole('alert')).toHaveTextContent(WARNING);
      expect(screen.getByText('Verify previous send', { selector: '.sx-status' })).toBeInTheDocument();
      expect(screen.getByRole('checkbox', { name: 'Select Richard Reynolds' })).toBeDisabled();

      fireEvent.click(screen.getByRole('button', { name: 'Verify previous send' }));
      const record = screen.getByRole('button', { name: 'Record' });
      expect(record).toBeDisabled();
      fireEvent.click(screen.getByLabelText(/They were not previously sent/));
      fireEvent.change(screen.getByLabelText('Which sending records you checked'), { target: { value: 'Outlook Sent Items and the fax log, 10/01–10/29' } });
      // A note alone is not enough: the explicit confirmation is required.
      expect(record).toBeDisabled();
      fireEvent.click(screen.getByLabelText(/I checked the available sending records/));
      expect(record).toBeEnabled();
      fireEvent.click(record);
      await waitFor(() =>
        expect(client.crematoryCaseAction).toHaveBeenCalledWith('managed-cremations', '1042', {
          action: 'record_previous_send',
          decision: 'not_previously_sent',
          verification: 'Outlook Sent Items and the fax log, 10/01–10/29',
          confirmedChecked: true,
        }),
      );
    });

    it('sent outside SOLIS: the method and how it was verified are required; the date is optional', async () => {
      client.fetchCrematoryOverview.mockResolvedValue(overview([flagged]));
      client.crematoryCaseAction.mockResolvedValue({});
      open({ preselectedCaseIds: ['1042'] });
      fireEvent.click(await screen.findByRole('button', { name: 'Verify previous send' }));
      fireEvent.click(screen.getByLabelText(/They were already sent outside SOLIS/));
      fireEvent.change(screen.getByLabelText('How you verified the earlier send'), { target: { value: 'Found in Outlook Sent Items, 10/21' } });
      expect(screen.getByRole('button', { name: 'Record' })).toBeDisabled();
      fireEvent.change(screen.getByLabelText('How they were sent'), { target: { value: 'email' } });
      fireEvent.click(screen.getByRole('button', { name: 'Record' }));
      await waitFor(() =>
        expect(client.crematoryCaseAction).toHaveBeenCalledWith('managed-cremations', '1042', { action: 'record_previous_send', decision: 'sent_outside_solis', method: 'email', sentOn: undefined, verification: 'Found in Outlook Sent Items, 10/21' }),
      );
    });

    it('staff without the send permission see the warning but cannot resolve it; a case recorded as sent outside SOLIS is not sent again', async () => {
      client.fetchCrematoryOverview.mockResolvedValue(overview([flagged], { canSend: false }));
      const { unmount } = open({ preselectedCaseIds: ['1042'] });
      expect(await screen.findByText(/must verify it/)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Verify previous send' })).toBeNull();
      unmount();

      const outside: CrematoryCaseSummary = {
        ...flagged,
        readiness: { ...flagged.readiness, requirements: [...ALL_OK, requirement('previous_send', false, 'Recorded as already sent to the crematory outside SOLIS (Email, 10/21/2026). It is not sent again through the first send.')] as never },
        previousSend: { indicated: false, recorded: { decision: 'sent_outside_solis', method: 'email', sentOn: '10/21/2026', verification: 'Found in Sent Items', recordedBy: 'staff', recordedAt: '2026-10-29T15:00:00.000Z' } },
      };
      client.fetchCrematoryOverview.mockResolvedValue(overview([outside]));
      open({ preselectedCaseIds: ['1042'] });
      expect(await screen.findByText('Sent outside SOLIS')).toBeInTheDocument();
      expect(screen.getByRole('status')).toHaveTextContent('It is not sent again through the first send.');
      expect(screen.queryByRole('button', { name: 'Verify previous send' })).toBeNull();
      expect(screen.getByRole('checkbox', { name: 'Select Richard Reynolds' })).toBeDisabled();
    });
  });

  it('a case already sent shows "Sent" on one line and can never be selected again', async () => {
    const sent: CrematoryCaseSummary = {
      ...readyCase('1042', 'Richard Reynolds', 'B2026-901'),
      readiness: { requirements: [...ALL_OK, requirement('not_sent', false, 'Already sent to the crematory. Each case is sent only once.')] as never, readyToBuild: true, readyToSend: false },
      lastSubmission: {
        submissionId: 's1', status: 'submitted', packageDocumentId: 'pkg-1042', packageVersion: 1, attachmentName: 'Reynolds_Richard_11-06-2026.pdf',
        to: ['intake@crematory.example'], cc: [], mailbox: 'office@funeralhome.example', internetMessageId: null, error: null, at: '2026-10-27T15:00:00.000Z', by: 'identity-admin',
      },
    };
    client.fetchCrematoryOverview.mockResolvedValue(overview([sent]));
    open({ preselectedCaseIds: ['1042'] });
    expect(await screen.findByText('Sent')).toBeInTheDocument();
    expect(screen.getByText(/Sent .* to intake@crematory.example · Reynolds_Richard_11-06-2026.pdf/)).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Select Richard Reynolds' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Build package' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Replace permit' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Review email' })).toBeDisabled();
  });

  it('a send that may have gone out is retried only after confirming it is not in Sent Items', async () => {
    client.fetchCrematoryOverview.mockResolvedValue(overview([readyCase('1042', 'Richard Reynolds', 'B2026-901')]));
    client.sendToCrematory
      .mockRejectedValueOnce(new CrematoryRequestError('Nothing was sent. The last send for Richard Reynolds (B2026-901) may have been sent. Check Sent Items in the mailbox, then confirm it was not sent to try again.', 409))
      .mockResolvedValueOnce({ status: 'submitted', duplicate: false, mailbox: 'office@funeralhome.example', internetMessageId: null, to: ['intake@crematory.example'], cc: [], attachments: [] });
    open({ caseId: '1042' });
    fireEvent.click(await screen.findByRole('button', { name: 'Review email (1)' }));
    await screen.findByLabelText('Subject');
    fireEvent.click(screen.getByRole('checkbox', { name: /I reviewed the recipients/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Send to Crematory (1)' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('may have been sent');
    const send = screen.getByRole('button', { name: 'Send to Crematory (1)' });
    expect(send).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: 'I checked Sent Items — it was not sent' }));
    fireEvent.click(send);
    await waitFor(() => expect(client.sendToCrematory).toHaveBeenCalledTimes(2));
    expect(client.sendToCrematory.mock.calls[1][0]).toMatchObject({ confirmResend: true });
  });

  it('with nothing to fill it from, staff type the name for the file and confirm it', async () => {
    const unnamed: CrematoryCaseSummary = {
      ...notReady,
      decedentDisplayName: 'Mary Ann Smith',
      packageName: { confirmed: null, suggested: null, suggestedFrom: null, recordedFrom: null },
      readiness: { requirements: [requirement('package_name', false, "Enter or confirm the decedent's last name and first name(s) exactly as they should appear in the file name.")] as never, readyToBuild: false, readyToSend: false },
    };
    client.fetchCrematoryOverview.mockResolvedValue(overview([unnamed]));
    client.crematoryCaseAction.mockResolvedValue({});
    open();
    const last = await screen.findByLabelText('Last name for Mary Ann Smith');
    expect(last).toHaveValue('');
    fireEvent.change(last, { target: { value: 'Smith' } });
    fireEvent.change(screen.getByLabelText('First name(s) for Mary Ann Smith'), { target: { value: 'Mary Ann' } });
    expect(screen.getByText('File: SMITH_MARY ANN_CREMATORY_PACKAGE_11-06-2026.pdf')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm name' }));
    await waitFor(() => expect(client.crematoryCaseAction).toHaveBeenCalledWith('managed-cremations', '1050', { action: 'confirm_package_name', first: 'Mary Ann', last: 'Smith' }));
  });

  it('staff who can prepare but not send see why, and cannot open the email', async () => {
    client.fetchCrematoryOverview.mockResolvedValue(overview([readyCase('1042', 'Richard Reynolds', 'B2026-901')], { canSend: false }));
    open({ preselectedCaseIds: ['1042'] });
    expect(await screen.findByText(/sending them needs the Send Crematory Packages permission/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Review email/ })).toBeDisabled();
  });

  it('staff without document permission get no prepare actions', async () => {
    client.fetchCrematoryOverview.mockResolvedValue(overview([notReady], { canSend: false, canPrepare: false }));
    open();
    await screen.findByText('Confirm the uploaded permit is the approved permit for this decedent.');
    expect(screen.queryByRole('button', { name: 'Confirm permit' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Upload PDF' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Confirm date' })).toBeNull();
  });

  it('the name arrives filled in from the family\'s form — staff check it and confirm', async () => {
    const filled: CrematoryCaseSummary = {
      ...notReady,
      decedentDisplayName: 'Mary Ann Smith',
      packageName: { confirmed: null, suggested: { first: 'Mary Ann', last: 'Smith' }, suggestedFrom: 'form', recordedFrom: null },
      readiness: { requirements: [requirement('package_name', false, 'x')] as never, readyToBuild: false, readyToSend: false },
    };
    client.fetchCrematoryOverview.mockResolvedValue(overview([filled]));
    client.crematoryCaseAction.mockResolvedValue({});
    open();
    expect(await screen.findByLabelText('Last name for Mary Ann Smith')).toHaveValue('Smith');
    expect(screen.getByLabelText('First name(s) for Mary Ann Smith')).toHaveValue('Mary Ann');
    expect(screen.getByText("Filled in from the family's form — check, then confirm.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm name' }));
    await waitFor(() => expect(client.crematoryCaseAction).toHaveBeenCalledWith('managed-cremations', '1050', { action: 'confirm_package_name', first: 'Mary Ann', last: 'Smith' }));
  });

  it('says when no Outlook mailbox is connected', async () => {
    client.fetchCrematoryOverview.mockResolvedValue(overview([], { mailbox: { connected: false, configured: true } }));
    open();
    expect(await screen.findByText(/No Outlook mailbox is connected/)).toBeInTheDocument();
    expect(within(document.body).getByText('No open cremation cases.')).toBeInTheDocument();
  });
});
