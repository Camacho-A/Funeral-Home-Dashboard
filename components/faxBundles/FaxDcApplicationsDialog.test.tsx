import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { FaxBundleView, FaxEligibility } from '@/lib/faxBundlesClient';

/** Fictional cases. The dialog never builds or sends anything itself — the server does. */
const client = vi.hoisted(() => ({ fetchFaxEligibility: vi.fn(), previewFaxBundle: vi.fn(), sendFaxBundle: vi.fn() }));
vi.mock('@/lib/faxBundlesClient', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/faxBundlesClient')>()), ...client }));
vi.mock('@/components/documents/DocumentPreview', () => ({ DocumentPreview: ({ url }: { url: string }) => <div data-testid="pdf">{url}</div> }));
const { FaxDcApplicationsDialog } = await import('./FaxDcApplicationsDialog');
const { FaxRequestError } = await import('@/lib/faxBundlesClient');

const row = (n: number, overrides: Partial<FaxEligibility['cases'][number]> = {}) => ({
  caseId: `case-${n}`, caseNumber: `B2026-90${n}`, decedentDisplayName: ['Alpha Testcase', 'Bravo Testcase', 'Charlie Testcase', 'Delta Testcase'][n - 1],
  documentId: `doc-${n}`, documentVersion: 1, savedAt: '2026-11-03T12:00:00.000Z', expectedPickupDate: '2026-11-10', targetDate: '2026-11-09', available: true, reason: null, ...overrides,
});
const eligibility = (overrides: Partial<FaxEligibility> = {}): FaxEligibility => ({
  cases: [row(1), row(2), row(3), row(4, { available: false, reason: 'Faxed in DC-AAAAAA — waiting for delivery confirmation.' })],
  destinationName: 'Manatee County Vital Statistics', destinationFax: '941-554-5490', sendingEnabled: true, maxApplications: 20, ...overrides,
});
const bundle = (ids: string[], overrides: Partial<FaxBundleView> = {}): FaxBundleView => ({
  id: 'fxb-1', reference: 'DC-7Q4K9M', state: 'ready', stateLabel: 'Ready to Send', applicationCount: ids.length, pageCount: ids.length, sizeBytes: 220_000,
  destinationName: 'Manatee County Vital Statistics', destinationFax: '941-554-5490', destinationAddress: '9415545490@fax.nuso.io',
  subject: 'Manors Cremation - DC Application Bundle DC-7Q4K9M', senderAddress: 'office@funeralhome.example', createdAt: '2026-11-04T12:00:00.000Z',
  submittedAt: null, deliveredAt: null, confirmedAt: null, nusoReference: null, failureMessage: null, sendingEnabled: true,
  items: ids.map((id, i) => ({ position: i + 1, caseId: id, caseNumber: `B2026-90${id.slice(-1)}`, decedentDisplayName: `Case ${id}`, documentVersion: 1, numbering: 'filled_blank' as const })),
  ...overrides,
});

const renderDialog = (preselected: string[] = []) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <FaxDcApplicationsDialog organizationId="managed-cremations" onClose={() => undefined} preselectedCaseIds={preselected} />
    </QueryClientProvider>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  client.fetchFaxEligibility.mockResolvedValue(eligibility());
});

describe('FaxDcApplicationsDialog', () => {
  it('shows the destination, each saved application with its target day, and why an application cannot be selected', async () => {
    renderDialog();
    expect((await screen.findByText(/Manatee County Vital Statistics/)).textContent).toBe('Manatee County Vital Statistics · Fax 941-554-5490');
    expect(screen.getAllByText(/send by Nov 9/)).toHaveLength(4);
    const unavailable = screen.getByLabelText(/Delta Testcase/) as HTMLInputElement;
    expect(unavailable.disabled).toBe(true);
    expect(screen.getByText(/Faxed in DC-AAAAAA/)).toBeTruthy();
    expect((screen.getByRole('button', { name: /Preview bundle/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('one application is enough: tick one, preview one bundle', async () => {
    client.previewFaxBundle.mockResolvedValue(bundle(['case-2']));
    renderDialog();
    fireEvent.click(await screen.findByLabelText(/Bravo Testcase/));
    expect(screen.getByText('1 application in one fax')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Preview bundle (1)' }));
    await screen.findByTestId('pdf');
    expect(client.previewFaxBundle).toHaveBeenCalledWith('managed-cremations', ['case-2']);
  });

  it('the order is the order ticked, and can be changed or trimmed before previewing', async () => {
    client.previewFaxBundle.mockResolvedValue(bundle(['case-1', 'case-3']));
    renderDialog();
    fireEvent.click(await screen.findByLabelText(/Charlie Testcase/));
    fireEvent.click(screen.getByLabelText(/Alpha Testcase/));
    fireEvent.click(screen.getByLabelText(/Bravo Testcase/));
    const order = within(screen.getByRole('region', { name: 'Bundle order' }));
    expect(order.getAllByRole('listitem').map((li) => li.textContent)).toEqual([expect.stringContaining('1 of 3 Charlie'), expect.stringContaining('2 of 3 Alpha'), expect.stringContaining('3 of 3 Bravo')]);
    fireEvent.click(order.getByRole('button', { name: 'Move Alpha Testcase up' }));
    fireEvent.click(order.getByRole('button', { name: 'Remove Bravo Testcase' }));
    fireEvent.click(screen.getByRole('button', { name: 'Preview bundle (2)' }));
    await waitFor(() => expect(client.previewFaxBundle).toHaveBeenCalledWith('managed-cremations', ['case-1', 'case-3']));
  });

  it('cases ticked on the Cases list arrive selected (only those that can be faxed)', async () => {
    client.previewFaxBundle.mockResolvedValue(bundle(['case-1', 'case-2']));
    renderDialog(['case-2', 'case-4', 'case-1']);
    fireEvent.click(await screen.findByRole('button', { name: 'Preview bundle (2)' }));
    await waitFor(() => expect(client.previewFaxBundle).toHaveBeenCalledWith('managed-cremations', ['case-2', 'case-1']));
  });

  it('the preview shows the exact stored PDF, the destination, the sender and the order; Send Fax sends it once', async () => {
    client.previewFaxBundle.mockResolvedValue(bundle(['case-1', 'case-2']));
    let release: (value: unknown) => void = () => undefined;
    client.sendFaxBundle.mockReturnValue(new Promise((resolve) => (release = resolve)));
    renderDialog(['case-1', 'case-2']);
    fireEvent.click(await screen.findByRole('button', { name: 'Preview bundle (2)' }));
    expect((await screen.findByTestId('pdf')).textContent).toBe('/api/fax-bundles/fxb-1/pdf?organizationId=managed-cremations');
    expect(screen.getByText(/DC-7Q4K9M · 2 applications · 2 pages/)).toBeTruthy();
    expect(screen.getByText('Sent with no message, so the fax should be exactly 2 pages.')).toBeTruthy();
    expect(screen.getByText(/Manatee County Vital Statistics/).textContent).toBe('Manatee County Vital Statistics · Fax 941-554-5490');
    expect(screen.getByText('office@funeralhome.example (Outlook → NuSo)')).toBeTruthy();
    // No confirmation box to tick, nothing to type.
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();

    const sendButton = screen.getByRole('button', { name: 'Send Fax' });
    fireEvent.click(sendButton);
    fireEvent.click(sendButton);
    expect((screen.getByRole('button', { name: 'Sending…' }) as HTMLButtonElement).disabled).toBe(true);
    release({ duplicate: false, recorded: true, bundle: bundle(['case-1', 'case-2'], { state: 'submitted', stateLabel: 'Submitted to NuSo' }) });
    expect(await screen.findByText('Submitted to NuSo')).toBeTruthy();
    expect(screen.getByText(/not yet confirmed delivery/)).toBeTruthy();
    expect(client.sendFaxBundle).toHaveBeenCalledTimes(1);
  });

  it('while sending is not turned on, bundles can be previewed but Send Fax is unavailable', async () => {
    client.fetchFaxEligibility.mockResolvedValue(eligibility({ sendingEnabled: false }));
    client.previewFaxBundle.mockResolvedValue(bundle(['case-1'], { sendingEnabled: false }));
    renderDialog(['case-1']);
    expect(await screen.findByText(/Fax sending isn.t turned on yet/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Preview bundle (1)' }));
    await screen.findByTestId('pdf');
    expect((screen.getByRole('button', { name: 'Send Fax' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('a refused preview marks each case with its reason', async () => {
    client.previewFaxBundle.mockRejectedValue(new FaxRequestError('One selected case cannot be included.', 422, [{ caseId: 'case-2', reason: 'No saved Manatee County application. Create and save it first.' }]));
    renderDialog(['case-1', 'case-2']);
    fireEvent.click(await screen.findByRole('button', { name: 'Preview bundle (2)' }));
    expect(await screen.findByText('One selected case cannot be included.')).toBeTruthy();
    expect(screen.getByText(/No saved Manatee County application/)).toBeTruthy();
  });

  it('a send that may have gone out cannot be pressed again from here', async () => {
    client.previewFaxBundle.mockResolvedValue(bundle(['case-1']));
    client.sendFaxBundle.mockRejectedValue(new FaxRequestError('Outlook could not send the email. The fax may still have been sent.', 502));
    renderDialog(['case-1']);
    fireEvent.click(await screen.findByRole('button', { name: 'Preview bundle (1)' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Send Fax' }));
    expect(await screen.findByText(/may still have been sent/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Send Fax' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('after a failure that sent nothing, Send Fax can be pressed again — as a new request', async () => {
    client.previewFaxBundle.mockResolvedValue(bundle(['case-1']));
    client.sendFaxBundle.mockRejectedValueOnce(new FaxRequestError('Outlook could not create the email. Nothing was sent; press Send Fax to try again.', 502));
    client.sendFaxBundle.mockResolvedValueOnce({ duplicate: false, recorded: true, bundle: bundle(['case-1'], { state: 'submitted', stateLabel: 'Submitted to NuSo' }) });
    renderDialog(['case-1']);
    fireEvent.click(await screen.findByRole('button', { name: 'Preview bundle (1)' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Send Fax' }));
    await screen.findByText(/Nothing was sent/);
    fireEvent.click(screen.getByRole('button', { name: 'Send Fax' }));
    await screen.findByText(/not yet confirmed delivery/);
    const [first, second] = client.sendFaxBundle.mock.calls.map((c) => c[2]);
    expect(first).not.toBe(second);
  });
});
