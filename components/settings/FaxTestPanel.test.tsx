import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { FaxTestOverview, FaxTestView } from '@/lib/faxTestsClient';

/** Fax test transmissions panel (2026-11). The server decides; the panel asks for explicit confirmation and records outcomes. Fictional values. */
const client = vi.hoisted(() => ({ fetchFaxTests: vi.fn(), sendFaxTest: vi.fn(), recordFaxTestOutcome: vi.fn() }));
vi.mock('@/lib/faxTestsClient', () => client);
const { FaxTestPanel } = await import('./FaxTestPanel');

const CHECKS = [
  { key: 'fromConnectedMailbox', label: 'From the connected mailbox' },
  { key: 'subjectAsExpected', label: 'Subject exactly as shown here' },
  { key: 'emptyPlainTextBody', label: 'Body is empty plain text' },
  { key: 'exactlyOnePdf', label: 'Exactly one attachment' },
  { key: 'checksumMatches', label: 'Checksum matches' },
] as FaxTestOverview['dryRunChecks'];
const overview = (o: Partial<FaxTestOverview> = {}): FaxTestOverview => ({
  enabled: true,
  sendingEnabled: false,
  recipients: [
    { key: 'email:dry-run@example.test', kind: 'email_dry_run', display: 'dry-run@example.test' },
    { key: 'fax:3055550101', kind: 'fax', display: '305-555-0101' },
  ],
  invalidRecipients: 0,
  mailbox: { connected: true, accountEmail: 'office@funeralhome.example' },
  steps: [
    { step: 0, label: 'Email dry run (1-page PDF, no fax)', kind: 'email_dry_run', pages: 1, available: true, passed: false, reason: null },
    { step: 1, label: 'One-page fax test', kind: 'fax', pages: 1, available: false, passed: false, reason: 'Step 0 must pass first.' },
    { step: 2, label: 'Two-page fax test', kind: 'fax', pages: 2, available: false, passed: false, reason: 'Step 1 must pass first.' },
  ],
  openTransmissionId: null,
  transmissions: [],
  expectedChecksums: { 1: 'a'.repeat(64), 2: 'b'.repeat(64) },
  dryRunChecks: CHECKS,
  ...o,
});
const transmission = (o: Partial<FaxTestView> = {}): FaxTestView =>
  ({
    id: 'fxt-' + '1'.repeat(40), organizationId: 'managed-cremations', submissionId: 's-1', step: 0, kind: 'email_dry_run', pages: 1,
    recipientKey: 'email:dry-run@example.test', recipientAddress: 'dry-run@example.test', recipientDisplay: 'dry-run@example.test', senderAddress: 'office@funeralhome.example',
    subject: 'Manors Cremation - DC Application Bundle TEST-ABCDEF', attachmentName: 'SOLIS-FAX-TEST-1-PAGE.pdf', pdfChecksumSha256: 'a'.repeat(64), pdfSizeBytes: 1900,
    status: 'submitted', statusLabel: 'Submitted to Outlook', revision: 1, requestedBy: 'identity-admin', createdAt: '2026-11-05T20:00:00.000Z', outlookContactedAt: '2026-11-05T20:00:00.000Z',
    submittedAt: '2026-11-05T20:00:01.000Z', outlookDraftId: 'd', internetMessageId: '<t@example>', failureMessage: null, nusoAcceptedAt: null, nusoReference: null, outcomeAt: null,
    pagesReceived: null, checks: null, passed: null, note: null, updatedAt: '2026-11-05T20:00:01.000Z', updatedBy: 'identity-admin', history: [], next: ['delivered', 'failed'], open: true, ...o,
  }) as FaxTestView;

const renderPanel = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <FaxTestPanel organizationId="managed-cremations" />
    </QueryClientProvider>,
  );

beforeEach(() => vi.clearAllMocks());

describe('FaxTestPanel', () => {
  it('off: says so, and offers nothing to send', async () => {
    client.fetchFaxTests.mockResolvedValue(overview({ enabled: false, recipients: [], steps: overview().steps.map((s) => ({ ...s, available: false })) }));
    renderPanel();
    expect(await screen.findByText(/Test transmissions are off/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Send test…' })).toBeNull();
  });

  it('only the unlocked step can be started; each send needs the confirmation ticked, and goes once with one submission id', async () => {
    client.fetchFaxTests.mockResolvedValue(overview());
    client.sendFaxTest.mockResolvedValue({ duplicate: false, transmission: transmission() });
    renderPanel();
    const buttons = (await screen.findAllByRole('button', { name: 'Send test…' })) as HTMLButtonElement[];
    expect(buttons.map((b) => b.disabled)).toEqual([false, true, true]);
    expect(screen.getByText('Step 0 must pass first.')).toBeTruthy();
    fireEvent.click(buttons[0]);
    const dialog = within(screen.getByRole('dialog', { name: 'Send test step 0?' }));
    expect(dialog.getByText('dry-run@example.test')).toBeTruthy();
    expect(dialog.getByText(/SHA-256 a{64}/)).toBeTruthy();
    const send = dialog.getByRole('button', { name: 'Send test' }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    fireEvent.click(dialog.getByRole('checkbox'));
    fireEvent.click(send);
    fireEvent.click(send);
    await waitFor(() => expect(client.sendFaxTest).toHaveBeenCalled());
    const [org, input] = client.sendFaxTest.mock.calls[0];
    expect(org).toBe('managed-cremations');
    expect(input).toMatchObject({ step: 0, recipientKey: 'email:dry-run@example.test', confirm: { acknowledged: true, recipient: 'dry-run@example.test', pages: 1 } });
    expect(client.sendFaxTest.mock.calls.every((c) => c[1].submissionId === input.submissionId)).toBe(true);
    expect(await screen.findByText(/Submitted to Outlook. This is not delivery/)).toBeTruthy();
  });

  it('an open test blocks every new send and asks for its outcome; a dry run is recorded with its inspection checks', async () => {
    const open = transmission();
    client.fetchFaxTests.mockResolvedValue(overview({ openTransmissionId: open.id, transmissions: [open] }));
    client.recordFaxTestOutcome.mockResolvedValue({ ...open, status: 'delivered', passed: true, open: false });
    renderPanel();
    const buttons = (await screen.findAllByRole('button', { name: 'Send test…' })) as HTMLButtonElement[];
    expect(buttons.every((b) => b.disabled)).toBe(true);
    const section = within(screen.getByRole('region', { name: /Open test — step 0/ }));
    fireEvent.click(section.getByLabelText('Received — inspected'));
    for (const c of CHECKS.slice(0, 4)) fireEvent.click(section.getByLabelText(c.label));
    fireEvent.click(section.getByRole('button', { name: 'Record result' }));
    await waitFor(() =>
      expect(client.recordFaxTestOutcome).toHaveBeenCalledWith('managed-cremations', open.id, {
        status: 'delivered',
        expectedRevision: 1,
        checks: { fromConnectedMailbox: true, subjectAsExpected: true, emptyPlainTextBody: true, exactlyOnePdf: true, checksumMatches: false },
      }),
    );
  });

  it('a fax delivery needs the pages actually received; "needs review" explains it is never retried and "not sent" needs a reason', async () => {
    const fax = transmission({ step: 1, kind: 'fax', recipientDisplay: '305-555-0101', status: 'needs_review', statusLabel: 'Needs review — may have been sent', next: ['not_sent', 'nuso_accepted', 'delivered', 'failed'] });
    client.fetchFaxTests.mockResolvedValue(overview({ openTransmissionId: fax.id, transmissions: [fax] }));
    client.recordFaxTestOutcome.mockResolvedValue({ ...fax, status: 'delivered', passed: false, open: false });
    renderPanel();
    const section = within(await screen.findByRole('region', { name: /Open test — step 1/ }));
    expect(section.getByText(/It is never retried/)).toBeTruthy();
    fireEvent.click(section.getByLabelText('Not sent'));
    const record = section.getByRole('button', { name: 'Record result' }) as HTMLButtonElement;
    expect(record.disabled).toBe(true);
    fireEvent.click(section.getByLabelText('Delivered'));
    expect(record.disabled).toBe(true);
    fireEvent.change(section.getByLabelText(/Pages actually received/), { target: { value: '3' } });
    fireEvent.change(section.getByLabelText('NuSo reference (optional)'), { target: { value: 'NS-1' } });
    fireEvent.click(record);
    await waitFor(() => expect(client.recordFaxTestOutcome).toHaveBeenCalledWith('managed-cremations', fax.id, { status: 'delivered', expectedRevision: 1, pagesReceived: 3, nusoReference: 'NS-1' }));
    expect(await screen.findByText(/did not pass/)).toBeTruthy();
  });
});
