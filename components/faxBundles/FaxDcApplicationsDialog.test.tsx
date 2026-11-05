import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { FaxBundleView, FaxEligibility } from '@/lib/faxBundlesClient';

/** Fictional cases. The dialog never builds or sends anything itself — the server does. */
const client = vi.hoisted(() => ({ fetchFaxEligibility: vi.fn(), previewFaxBundle: vi.fn(), sendFaxBundle: vi.fn() }));
vi.mock('@/lib/faxBundlesClient', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/faxBundlesClient')>()), ...client }));
vi.mock('@/components/documents/PdfViewer', () => ({ PdfViewer: ({ url, sections }: { url: string; sections?: Array<{ label: string; pageCount: number }> }) => <div data-testid="pdf" data-sections={JSON.stringify(sections ?? null)}>{url}</div> }));
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
  destinationId: null, destinationName: 'Manatee County Vital Statistics', destinationFax: '941-554-5490', destinationAddress: '9415545490@fax.nuso.io',
  subject: 'Manors Cremation - DC Application Bundle DC-7Q4K9M', senderAddress: 'office@funeralhome.example', createdAt: '2026-11-04T12:00:00.000Z',
  submittedAt: null, deliveredAt: null, confirmedAt: null, nusoReference: null, failureMessage: null, sendingEnabled: true,
  items: ids.map((id, i) => ({ position: i + 1, caseId: id, caseNumber: `B2026-90${id.slice(-1)}`, decedentDisplayName: `Case ${id}`, documentVersion: 1, numbering: 'filled_blank' as const, pageCount: 1 })),
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

/** Step 1 → 2: press Review fax (n) and wait for the stored PDF. */
async function review(n: number) {
  fireEvent.click(await screen.findByRole('button', { name: `Review fax (${n})` }));
  return screen.findByTestId('pdf');
}
/** Step 2 → 3. */
const toConfirm = () => fireEvent.click(screen.getByRole('button', { name: 'Continue to confirm' }));
const confirmBox = () => screen.getByRole('checkbox', { name: /I reviewed all/ }) as HTMLInputElement;
const sendButton = () => screen.getByRole('button', { name: /^(Send Fax|Sending…)$/ }) as HTMLButtonElement;
const currentStep = () => document.querySelector('[aria-current="step"]')?.textContent;

describe('FaxDcApplicationsDialog — three steps', () => {
  it('step 1 shows the destination, each saved application with its case number and target day, the count, and why one cannot be selected', async () => {
    renderDialog();
    expect((await screen.findByText(/Manatee County Vital Statistics/)).closest('div')!.textContent).toBe('Faxing toManatee County Vital Statistics Fax 941-554-5490');
    expect(currentStep()).toMatch(/Step 1 of 3: Select cases/);
    expect(screen.getAllByText(/send by Nov 9/)).toHaveLength(4);
    expect(screen.getByText('B2026-901')).toBeTruthy();
    const unavailable = screen.getByLabelText(/Delta Testcase/) as HTMLInputElement;
    expect(unavailable.disabled).toBe(true);
    expect(screen.getByText(/Faxed in DC-AAAAAA/)).toBeTruthy();
    expect(screen.getByText('0 of 3 selected')).toBeTruthy();
    expect((screen.getByRole('button', { name: /Review fax/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('one application is enough: tick one, review one bundle', async () => {
    client.previewFaxBundle.mockResolvedValue(bundle(['case-2']));
    renderDialog();
    fireEvent.click(await screen.findByLabelText(/Bravo Testcase/));
    expect(screen.getByText('1 application in one fax')).toBeTruthy();
    expect(screen.getByText('1 of 3 selected')).toBeTruthy();
    await review(1);
    expect(client.previewFaxBundle).toHaveBeenCalledWith('managed-cremations', ['case-2'], 'builtin');
    expect(currentStep()).toMatch(/Review fax/);
  });

  it('the order is the order ticked, and can be changed or trimmed before reviewing', async () => {
    client.previewFaxBundle.mockResolvedValue(bundle(['case-1', 'case-3']));
    renderDialog();
    fireEvent.click(await screen.findByLabelText(/Charlie Testcase/));
    fireEvent.click(screen.getByLabelText(/Alpha Testcase/));
    fireEvent.click(screen.getByLabelText(/Bravo Testcase/));
    const order = within(screen.getByRole('region', { name: 'Bundle order' }));
    expect(order.getAllByRole('listitem').map((li) => li.textContent)).toEqual([expect.stringContaining('1 of 3 Charlie'), expect.stringContaining('2 of 3 Alpha'), expect.stringContaining('3 of 3 Bravo')]);
    fireEvent.click(order.getByRole('button', { name: 'Move Alpha Testcase up' }));
    fireEvent.click(order.getByRole('button', { name: 'Remove Bravo Testcase' }));
    await review(2);
    expect(client.previewFaxBundle).toHaveBeenCalledWith('managed-cremations', ['case-1', 'case-3'], 'builtin');
  });

  it('cases ticked on the Cases list arrive selected (only those that can be faxed)', async () => {
    client.previewFaxBundle.mockResolvedValue(bundle(['case-2', 'case-1']));
    renderDialog(['case-2', 'case-4', 'case-1']);
    await review(2);
    expect(client.previewFaxBundle).toHaveBeenCalledWith('managed-cremations', ['case-2', 'case-1'], 'builtin');
  });

  it('step 2 shows the exact stored PDF with the destination, document, application and page counts — and no Send', async () => {
    client.previewFaxBundle.mockResolvedValue(bundle(['case-1', 'case-2']));
    renderDialog(['case-1', 'case-2']);
    expect((await review(2)).textContent).toBe('/api/fax-bundles/fxb-1/pdf?organizationId=managed-cremations');
    const details = within(screen.getByRole('complementary', { name: 'Fax details' }));
    expect(details.getByText('DC-7Q4K9M.pdf')).toBeTruthy();
    expect(details.getByText('Applications').nextElementSibling!.textContent).toBe('2');
    expect(details.getByText('PDF pages').nextElementSibling!.textContent).toBe('2');
    expect(details.getByText(/Fax 941-554-5490/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Send Fax' })).toBeNull();
  });

  it('the viewer is told which pages are which request, so every application in the bundle can be paged to', async () => {
    const view = bundle(['case-1', 'case-2', 'case-3']);
    view.items[1].pageCount = 2;
    client.previewFaxBundle.mockResolvedValue({ ...view, pageCount: 4 });
    renderDialog(['case-1', 'case-2', 'case-3']);
    expect(JSON.parse((await review(3)).getAttribute('data-sections')!)).toEqual([
      { label: 'Request 1 of 3 — Case case-1 (B2026-901)', pageCount: 1 },
      { label: 'Request 2 of 3 — Case case-2 (B2026-902)', pageCount: 2 },
      { label: 'Request 3 of 3 — Case case-3 (B2026-903)', pageCount: 1 },
    ]);
  });

  it('back to cases with nothing changed reuses the prepared bundle; changing the selection prepares a new one', async () => {
    client.previewFaxBundle.mockResolvedValueOnce(bundle(['case-1', 'case-2'])).mockResolvedValueOnce(bundle(['case-1']));
    renderDialog(['case-1', 'case-2']);
    await review(2);
    fireEvent.click(screen.getByRole('button', { name: '‹ Back to cases' }));
    await review(2);
    expect(client.previewFaxBundle).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: '‹ Back to cases' }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Bravo Testcase/ }));
    await review(1);
    expect(client.previewFaxBundle).toHaveBeenCalledTimes(2);
    expect(client.sendFaxBundle).not.toHaveBeenCalled();
  });

  it('step 3 names the destination, number, document and counts, says it is not confirmed delivery, and sends only once ticked — once', async () => {
    client.previewFaxBundle.mockResolvedValue(bundle(['case-1', 'case-2']));
    let release: (value: unknown) => void = () => undefined;
    client.sendFaxBundle.mockReturnValue(new Promise((resolve) => (release = resolve)));
    renderDialog(['case-1', 'case-2']);
    await review(2);
    toConfirm();
    expect(currentStep()).toMatch(/Confirm & send/);
    const card = within(screen.getByRole('region', { name: 'Send this fax?' }));
    expect(card.getByText('Manatee County Vital Statistics')).toBeTruthy();
    expect(card.getByText('Fax 941-554-5490')).toBeTruthy();
    expect(card.getByText('DC-7Q4K9M.pdf')).toBeTruthy();
    expect(card.getByText(/2 applications · 2 PDF pages/)).toBeTruthy();
    expect(card.getByText(/not confirmed delivery/)).toBeTruthy();
    expect(card.getByText(/office@funeralhome.example/)).toBeTruthy();

    expect(sendButton().disabled).toBe(true);
    fireEvent.click(sendButton());
    expect(client.sendFaxBundle).not.toHaveBeenCalled();
    fireEvent.click(confirmBox());
    fireEvent.click(sendButton());
    fireEvent.click(sendButton());
    expect(screen.getByRole('button', { name: 'Sending…' }).hasAttribute('disabled')).toBe(true);
    release({ duplicate: false, recorded: true, bundle: bundle(['case-1', 'case-2'], { state: 'submitted', stateLabel: 'Submitted to NuSo' }) });
    expect(await screen.findByText('Submitted to NuSo')).toBeTruthy();
    expect(screen.getByText(/not yet confirmed delivery/)).toBeTruthy();
    expect(client.sendFaxBundle).toHaveBeenCalledTimes(1);
  });

  it('back from confirm unticks the confirmation', async () => {
    client.previewFaxBundle.mockResolvedValue(bundle(['case-1']));
    renderDialog(['case-1']);
    await review(1);
    toConfirm();
    fireEvent.click(confirmBox());
    fireEvent.click(screen.getByRole('button', { name: '‹ Back to review' }));
    toConfirm();
    expect(confirmBox().checked).toBe(false);
    expect(sendButton().disabled).toBe(true);
  });

  it('while sending is not turned on, cases can be selected and reviewed but nothing can be confirmed or sent', async () => {
    client.fetchFaxEligibility.mockResolvedValue(eligibility({ sendingEnabled: false }));
    client.previewFaxBundle.mockResolvedValue(bundle(['case-1'], { sendingEnabled: false }));
    renderDialog(['case-1']);
    expect(await screen.findByText(/Fax sending isn.t turned on yet/)).toBeTruthy();
    await review(1);
    toConfirm();
    expect(confirmBox().disabled).toBe(true);
    expect(sendButton().disabled).toBe(true);
  });

  it('with no Outlook mailbox connected, Send Fax is unavailable', async () => {
    client.previewFaxBundle.mockResolvedValue(bundle(['case-1'], { senderAddress: null }));
    renderDialog(['case-1']);
    await review(1);
    toConfirm();
    expect(screen.getByText(/No Outlook mailbox is connected —/)).toBeTruthy();
    expect(confirmBox().disabled).toBe(true);
    expect(sendButton().disabled).toBe(true);
  });

  it('a refused preview stays on step 1 and marks each case with its reason', async () => {
    client.previewFaxBundle.mockRejectedValue(new FaxRequestError('One selected case cannot be included.', 422, [{ caseId: 'case-2', reason: 'No saved Manatee County application. Create and save it first.' }]));
    renderDialog(['case-1', 'case-2']);
    fireEvent.click(await screen.findByRole('button', { name: 'Review fax (2)' }));
    expect(await screen.findByText('One selected case cannot be included.')).toBeTruthy();
    expect(screen.getByText(/No saved Manatee County application/)).toBeTruthy();
    expect(currentStep()).toMatch(/Select cases/);
  });

  it('the saved applications failing to load says so and offers to try again', async () => {
    client.fetchFaxEligibility.mockRejectedValueOnce(new FaxRequestError('SOLIS could not reach the case records.', 503)).mockResolvedValueOnce(eligibility());
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <FaxDcApplicationsDialog organizationId="managed-cremations" onClose={() => undefined} />
      </QueryClientProvider>,
    );
    expect(await screen.findByText(/could not be loaded/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByLabelText(/Alpha Testcase/)).toBeTruthy();
  });

  it('a send that may have gone out can never be sent again from this dialog, whichever step staff return to', async () => {
    client.previewFaxBundle.mockResolvedValue(bundle(['case-1']));
    client.sendFaxBundle.mockRejectedValue(new FaxRequestError('Outlook could not send the email. The fax may still have been sent.', 502));
    renderDialog(['case-1']);
    await review(1);
    toConfirm();
    fireEvent.click(confirmBox());
    fireEvent.click(sendButton());
    expect(await screen.findByText(/may still have been sent/)).toBeTruthy();
    expect(screen.getByText(/Do not send this fax again/)).toBeTruthy();
    expect(sendButton().disabled).toBe(true);
    expect(confirmBox().disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '‹ Back to review' }));
    expect(screen.getByText(/DC-7Q4K9M may already have been sent/)).toBeTruthy();
    toConfirm();
    expect(confirmBox().disabled).toBe(true);
    expect(sendButton().disabled).toBe(true);
    expect(client.sendFaxBundle).toHaveBeenCalledTimes(1);
  });

  it('after a failure that sent nothing, Send Fax can be pressed again — as a new request', async () => {
    client.previewFaxBundle.mockResolvedValue(bundle(['case-1']));
    client.sendFaxBundle.mockRejectedValueOnce(new FaxRequestError('Outlook could not create the email. Nothing was sent; press Send Fax to try again.', 502));
    client.sendFaxBundle.mockResolvedValueOnce({ duplicate: false, recorded: true, bundle: bundle(['case-1'], { state: 'submitted', stateLabel: 'Submitted to NuSo' }) });
    renderDialog(['case-1']);
    await review(1);
    toConfirm();
    fireEvent.click(confirmBox());
    fireEvent.click(sendButton());
    await screen.findByText(/Nothing was sent/);
    await waitFor(() => expect(sendButton().disabled).toBe(false));
    fireEvent.click(sendButton());
    await screen.findByText(/not yet confirmed delivery/);
    const [first, second] = client.sendFaxBundle.mock.calls.map((c) => c[2]);
    expect(first).not.toBe(second);
  });

  it('several destinations: the default is preselected, staff can choose another before reviewing, and it is shown on every step', async () => {
    client.fetchFaxEligibility.mockResolvedValue(
      eligibility({
        destinations: [
          { id: 'fxd-manatee', name: 'Manatee County Vital Statistics', faxNumberDisplay: '941-554-5490', isDefault: true },
          { id: 'fxd-sarasota', name: 'Sarasota County Records', faxNumberDisplay: '941-555-0177', isDefault: false },
        ],
      }),
    );
    const sarasota = { destinationId: 'fxd-sarasota', destinationName: 'Sarasota County Records', destinationFax: '941-555-0177', destinationAddress: '9415550177@fax.nuso.io' };
    client.previewFaxBundle.mockResolvedValueOnce(bundle(['case-1'], { destinationId: 'fxd-manatee' })).mockResolvedValueOnce(bundle(['case-1'], sarasota));
    renderDialog(['case-1']);
    const menu = (await screen.findByLabelText('Faxing to')) as HTMLSelectElement;
    expect(menu.value).toBe('fxd-manatee');
    expect([...menu.options].map((o) => o.text)).toEqual(['Manatee County Vital Statistics — Fax 941-554-5490 (default)', 'Sarasota County Records — Fax 941-555-0177']);
    await review(1);
    expect(client.previewFaxBundle).toHaveBeenLastCalledWith('managed-cremations', ['case-1'], 'fxd-manatee');

    // Back, choose Sarasota: a different destination is a different fax — a new preview, never the old bundle.
    fireEvent.click(screen.getByRole('button', { name: '‹ Back to cases' }));
    fireEvent.change(screen.getByLabelText('Faxing to'), { target: { value: 'fxd-sarasota' } });
    expect(screen.getByText('Not the default destination')).toBeTruthy();
    await review(1);
    expect(client.previewFaxBundle).toHaveBeenCalledTimes(2);
    expect(client.previewFaxBundle).toHaveBeenLastCalledWith('managed-cremations', ['case-1'], 'fxd-sarasota');
    expect(within(screen.getByRole('complementary', { name: 'Fax details' })).getByText('Sarasota County Records')).toBeTruthy();
    toConfirm();
    const card = within(screen.getByRole('region', { name: 'Send this fax?' }));
    expect(card.getByText('Sarasota County Records')).toBeTruthy();
    expect(card.getByText('Fax 941-555-0177')).toBeTruthy();
    expect(confirmBox().closest('label')!.textContent).toMatch(/to Sarasota County Records at 941-555-0177/);
  });

  it('phones get full-width destination choices (whole name, number, Default tag) that drive the same selection as the menu', async () => {
    client.fetchFaxEligibility.mockResolvedValue(
      eligibility({
        destinations: [
          { id: 'fxd-manatee', name: 'Manatee County Vital Statistics', faxNumberDisplay: '941-554-5490', isDefault: true },
          { id: 'fxd-long', name: 'Charlotte County Office of Vital Records and Statistics (fictional)', faxNumberDisplay: '941-555-0199', isDefault: false },
        ],
      }),
    );
    client.previewFaxBundle.mockResolvedValue(bundle(['case-1'], { destinationId: 'fxd-long' }));
    renderDialog(['case-1']);
    const group = within((await screen.findByRole('group', { name: 'Faxing to' })) as HTMLElement);
    const [manatee, long] = group.getAllByRole('radio') as HTMLInputElement[];
    expect(manatee.checked).toBe(true);
    expect(manatee.closest('label')!.textContent).toBe('Manatee County Vital StatisticsFax 941-554-5490Default');
    fireEvent.click(long);
    expect((screen.getByLabelText('Faxing to') as HTMLSelectElement).value).toBe('fxd-long');
    expect(long.closest('label')!.textContent).toContain('Charlotte County Office of Vital Records and Statistics (fictional)');
    await review(1);
    expect(client.previewFaxBundle).toHaveBeenLastCalledWith('managed-cremations', ['case-1'], 'fxd-long');
  });

  it('one destination: no menu, just the destination', async () => {
    renderDialog();
    expect(await screen.findByText('Manatee County Vital Statistics')).toBeTruthy();
    expect(screen.queryByLabelText('Faxing to')).toBeNull();
    expect(screen.queryByRole('group', { name: 'Faxing to' })).toBeNull();
  });
});
