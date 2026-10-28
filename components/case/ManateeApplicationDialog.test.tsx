import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ManateeApplicationDialog } from './ManateeApplicationDialog';
import type { ManateeDraft } from '@/domain/documents/manateeDeathCertificateApplication';

/** Fictional. The SSN on file never reaches this window — only its last four. */
const client = vi.hoisted(() => ({ fetchManateeDraft: vi.fn(), previewManateeApplication: vi.fn(), saveManateeApplication: vi.fn() }));
vi.mock('@/lib/manateeApplicationClient', () => client);
vi.mock('@/components/documents/DocumentPreview', () => ({ DocumentPreview: () => <div>PDF preview</div> }));

const draft = (overrides: Partial<ManateeDraft> = {}): ManateeDraft => ({
  values: {
    decedentFirst: 'Mary Ann', decedentMiddle: 'Louise', decedentLast: 'Salas Rueda', ssnNotKnown: false, dateOfDeath: '10/04/2026',
    placeOfDeathCity: 'Pembroke Pines', placeOfDeathCounty: 'BROWARD', spouseFirst: '', spouseMiddle: '', spouseLast: '',
    representedName: 'TERESA SALAS RUEDA', representedRelationship: 'Daughter', withCause: 0, withoutCause: 0, fedexFee: false,
    requestNumber: '', requestOf: '',
  },
  ssn: { onFile: true, masked: '•••-••-3456', source: 'arrangement_form', locked: false },
  sources: { decedentFirst: 'arrangement_form', placeOfDeathCounty: null },
  issues: [],
  template: 'available',
  pricing: { perCertificateCents: 800, fedexCents: 1500, maxPerLine: 99 },
  latest: null,
  ...overrides,
});

const renderDialog = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ManateeApplicationDialog organizationId="managed-cremations" caseId="1042" onClose={() => undefined} />
    </QueryClientProvider>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  globalThis.URL.createObjectURL = vi.fn(() => 'blob:preview');
  globalThis.URL.revokeObjectURL = vi.fn();
});

describe('ManateeApplicationDialog', () => {
  it('shows what was found, the SSN only as its last four, and blocks Preview until certificates are chosen', async () => {
    client.fetchManateeDraft.mockResolvedValue(draft());
    renderDialog();
    expect(await screen.findByDisplayValue('Mary Ann')).toBeTruthy();
    expect(screen.getByText(/On file: •••-••-3456/)).toBeTruthy();
    expect(screen.getByText('From the Arrangement Form')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Preview' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Order at least one death certificate.')).toBeTruthy();
  });

  it('totals the fees as staff type, FedEx only when ticked', async () => {
    client.fetchManateeDraft.mockResolvedValue(draft());
    renderDialog();
    await screen.findByDisplayValue('Mary Ann');
    fireEvent.change(screen.getByLabelText('With cause of death'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('Without cause of death'), { target: { value: '3' } });
    expect(screen.getByText('$40.00')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('FedEx fee applies'));
    expect(screen.getByText('$55.00')).toBeTruthy();
  });

  it('previews, then saves the reviewed values — sending an SSN only when staff typed one', async () => {
    client.fetchManateeDraft.mockResolvedValue(draft());
    client.previewManateeApplication.mockResolvedValue(new Blob(['%PDF'], { type: 'application/pdf' }));
    client.saveManateeApplication.mockResolvedValue({ id: 'doc-1' });
    renderDialog();
    await screen.findByDisplayValue('Mary Ann');
    fireEvent.change(screen.getByLabelText('With cause of death'), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    expect(await screen.findByText('PDF preview')).toBeTruthy();
    expect(client.previewManateeApplication.mock.calls[0][2]).toMatchObject({ withCause: 1, ssn: null, decedentLast: 'Salas Rueda' });
    fireEvent.click(screen.getByRole('button', { name: 'Save to Documents' }));
    expect(await screen.findByText(/It has not been sent anywhere/)).toBeTruthy();
    expect(client.saveManateeApplication).toHaveBeenCalledTimes(1);
  });

  it('missing values must be entered here; a typed SSN must have 9 digits', async () => {
    client.fetchManateeDraft.mockResolvedValue(draft({ values: { ...draft().values, decedentLast: '', withCause: 1 }, ssn: { onFile: false, masked: null, source: null, locked: false } }));
    renderDialog();
    await screen.findByDisplayValue('Mary Ann');
    expect(screen.getByText("Enter the decedent's last name.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Last name'), { target: { value: 'Salas Rueda' } });
    fireEvent.change(screen.getByLabelText('Social Security number'), { target: { value: '12345' } });
    expect(screen.getByText('A Social Security number has 9 digits.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Preview' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Social Security number'), { target: { value: '000-12-3456' } });
    await waitFor(() => expect((screen.getByRole('button', { name: 'Preview' }) as HTMLButtonElement).disabled).toBe(false));
  });

  it('Request ___ of ___ is optional, and needs both numbers once started', async () => {
    client.fetchManateeDraft.mockResolvedValue(draft({ values: { ...draft().values, withCause: 1 } }));
    renderDialog();
    await screen.findByDisplayValue('Mary Ann');
    expect(screen.getByText('Left blank on the form unless you enter both numbers.')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Request'), { target: { value: '1' } });
    expect(screen.getByText(/enter both numbers/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Preview' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('of'), { target: { value: '2' } });
    await waitFor(() => expect((screen.getByRole('button', { name: 'Preview' }) as HTMLButtonElement).disabled).toBe(false));
  });

  it('a locked SSN is shown as its last four, locked — with nothing to type and no "not known"', async () => {
    client.fetchManateeDraft.mockResolvedValue(draft({ values: { ...draft().values, withCause: 1 }, ssn: { onFile: true, masked: '•••-••-3456', source: 'case', locked: true } }));
    client.previewManateeApplication.mockResolvedValue(new Blob(['%PDF'], { type: 'application/pdf' }));
    renderDialog();
    expect(await screen.findByText('Locked on the case')).toBeTruthy();
    expect(screen.queryByLabelText('Social Security number')).toBeNull();
    expect(screen.queryByText('Not known — leave the box blank')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    await waitFor(() => expect(client.previewManateeApplication).toHaveBeenCalled());
    expect(client.previewManateeApplication.mock.calls[0][2]).toMatchObject({ ssn: null, ssnNotKnown: false });
  });

  it('says plainly when the form is not set up', async () => {
    client.fetchManateeDraft.mockResolvedValue(draft({ template: 'not_configured' }));
    renderDialog();
    expect(await screen.findByText(/The Manatee County form is not set up yet/)).toBeTruthy();
  });
});
