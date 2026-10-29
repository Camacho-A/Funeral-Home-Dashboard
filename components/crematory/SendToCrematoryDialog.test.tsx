import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { CrematoryCaseSummary, CrematoryOverview } from '@/lib/crematoryClient';

/** Send to Crematory (2026-10). The window with the server faked; fictional cases and recipients. */
const { client } = vi.hoisted(() => ({
  client: { fetchCrematoryOverview: vi.fn(), crematoryCaseAction: vi.fn(), sendToCrematory: vi.fn() },
}));
vi.mock('@/lib/crematoryClient', async () => {
  const actual = await vi.importActual<typeof import('@/lib/crematoryClient')>('@/lib/crematoryClient');
  return { ...actual, ...client };
});
vi.mock('@/lib/caseDocumentsClient', async () => {
  const actual = await vi.importActual<typeof import('@/lib/caseDocumentsClient')>('@/lib/caseDocumentsClient');
  return { ...actual, uploadCaseDocument: vi.fn(), extractArrangementPage: vi.fn() };
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
    packageName: { confirmed: { first, last: rest.join(' ') }, suggested: null, suggestedFrom: null },
    subjectName: name,
    readiness: { requirements: ALL_OK as never, readyToBuild: true, readyToSend: true },
    permit: { documentId: `permit-${caseId}`, fileName: 'State Permit.pdf', createdAt: '2026-10-27T15:00:00.000Z', uploadedBy: 'Dana' },
    readyDate: { suggested: date, confirmed: date },
    package: { documentId: `pkg-${caseId}`, version: 1, fileName: fileName ?? `${rest.join(' ')}_${first}_${date.replace(/\//g, '-')}.pdf`, current: true },
    expectedFileName: null,
    lastSubmission: null,
  };
}

const notReady: CrematoryCaseSummary = {
  ...readyCase('1050', 'Walter Boone', 'B2026-903'),
  readiness: {
    requirements: [requirement('permit_uploaded', true), requirement('permit_verified', false, 'Confirm the uploaded permit is the approved permit for this decedent.'), requirement('ready_date', false, 'Enter or confirm the expected cremation ready date.')] as never,
    readyToBuild: false,
    readyToSend: false,
  },
  readyDate: { suggested: '11/06/2026', confirmed: null },
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

afterEach(() => vi.clearAllMocks());
const open = (props: { caseId?: string; preselectedCaseIds?: string[] } = {}) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SendToCrematoryDialog open onClose={() => {}} organizationId="managed-cremations" {...props} />
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
    // Steps that wait on an earlier one say so instead of offering an action.
    expect(screen.getAllByText('After the step above').length).toBeGreaterThan(0);

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
    await waitFor(() => expect(client.crematoryCaseAction).toHaveBeenCalledWith('managed-cremations', '1050', { action: 'confirm_permit', documentId: 'permit-1050' }));
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
  });

  it('one case from the case page: the single-decedent subject', async () => {
    client.fetchCrematoryOverview.mockResolvedValue(overview([readyCase('1042', 'Richard Reynolds', 'B2026-901')]));
    open({ caseId: '1042' });
    fireEvent.click(await screen.findByRole('button', { name: 'Review email (1)' }));
    expect(screen.getByLabelText('Subject')).toHaveValue('Manors Cremation — Richard Reynolds — Expected 11/06/2026');
    expect(client.fetchCrematoryOverview).toHaveBeenCalledWith('managed-cremations', '1042');
  });

  it('different dates never share a date in the subject', async () => {
    client.fetchCrematoryOverview.mockResolvedValue(overview([readyCase('1042', 'Richard Reynolds', 'B2026-901'), readyCase('1044', 'Estela Salas Rueda', 'B2026-902', '11/07/2026')]));
    open({ preselectedCaseIds: ['1042', '1044'] });
    fireEvent.click(await screen.findByRole('button', { name: 'Review email (2)' }));
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
    expect(screen.getByText('WILLSON_HANNELORE_CREMATORY_PACKAGE_10-30-2026.pdf')).toBeInTheDocument();
    expect(screen.queryByText('Willson_Hannelore_10-30-2026.pdf')).toBeNull();
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
    expect(screen.getByRole('button', { name: 'Review email' })).toBeDisabled();
  });

  it('a send that may have gone out is retried only after confirming it is not in Sent Items', async () => {
    client.fetchCrematoryOverview.mockResolvedValue(overview([readyCase('1042', 'Richard Reynolds', 'B2026-901')]));
    client.sendToCrematory
      .mockRejectedValueOnce(new CrematoryRequestError('Nothing was sent. The last send for Richard Reynolds (B2026-901) may have been sent. Check Sent Items in the mailbox, then confirm it was not sent to try again.', 409))
      .mockResolvedValueOnce({ status: 'submitted', duplicate: false, mailbox: 'office@funeralhome.example', internetMessageId: null, to: ['intake@crematory.example'], cc: [], attachments: [] });
    open({ caseId: '1042' });
    fireEvent.click(await screen.findByRole('button', { name: 'Review email (1)' }));
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
      packageName: { confirmed: null, suggested: null, suggestedFrom: null },
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
      packageName: { confirmed: null, suggested: { first: 'Mary Ann', last: 'Smith' }, suggestedFrom: 'form' },
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
