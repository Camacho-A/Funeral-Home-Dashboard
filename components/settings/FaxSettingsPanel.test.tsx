import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { FaxSettingsOverview } from '@/lib/faxSettingsClient';

/** Fax Settings panel (2026-11). The server decides everything; the panel shows it and sends changes. Fictional values. */
vi.mock('@/hooks/useOrganization', () => ({ useOrganization: () => ({ organizationId: 'managed-cremations' }) }));
const client = vi.hoisted(() => ({
  fetchFaxSettings: vi.fn(),
  fetchFaxConfigurationHistory: vi.fn(),
  saveFaxSettings: vi.fn(),
  addFaxDestination: vi.fn(),
  editFaxDestination: vi.fn(),
  archiveFaxDestination: vi.fn(),
  makeDefaultFaxDestination: vi.fn(),
}));
vi.mock('@/lib/faxSettingsClient', () => client);
const { FaxSettingsPanel } = await import('./FaxSettingsPanel');

const nuso = { key: 'nuso' as const, label: 'NuSo IPFax', gatewayDomain: 'fax.nuso.io', emailBody: 'unverified' as const, coverPage: 'unsupported' as const, notes: 'Email-to-fax.' };
const overview = (overrides: Partial<FaxSettingsOverview> = {}): FaxSettingsOverview => ({
  organizationName: 'Manors Cremation',
  sendingEnabled: false,
  provider: nuso,
  providers: [nuso],
  settings: { exists: false, revision: null, providerKey: 'nuso', subjectTemplate: 'Manors Cremation - DC Application Bundle {reference}', bodyEnabled: false, bodyTemplate: '', coverPageEnabled: false, updatedAt: null },
  destinations: [
    { id: 'builtin', name: 'Manatee County Vital Statistics', faxNumber: '9415545490', faxNumberDisplay: '941-554-5490', address: '9415545490@fax.nuso.io', purpose: 'Built-in default', status: 'active', isDefault: true, builtIn: true, revision: null, updatedAt: null },
  ],
  effective: { destinationName: 'Manatee County Vital Statistics', address: '9415545490@fax.nuso.io', subjectExample: 'Manors Cremation - DC Application Bundle DC-7Q4K9M', bodyInUse: false },
  problem: null,
  mailbox: { connected: true, configured: true, accountEmail: 'office@funeralhome.example', needsReconnect: false },
  placeholders: [{ key: 'reference', description: 'The bundle reference' }, { key: 'organizationName', description: 'Your name' }],
  warning: 'An email message, a signature or a cover page can be faxed as extra pages.',
  ...overrides,
});

const renderPanel = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <FaxSettingsPanel />
    </QueryClientProvider>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  client.fetchFaxSettings.mockResolvedValue(overview());
  client.fetchFaxConfigurationHistory.mockResolvedValue([]);
});

describe('FaxSettingsPanel', () => {
  it('shows the five sections, the Manors defaults, the mailbox and that sending is off', async () => {
    renderPanel();
    for (const name of ['Fax Destinations', 'Provider & Sending Mailbox', 'Email Subject & Message Templates', 'Cover Page Options', 'Fax Configuration History']) {
      expect(await screen.findByRole('heading', { name })).toBeTruthy();
    }
    expect(screen.getByText(/Fax sending is off/)).toBeTruthy();
    expect(screen.getByText(/not from this page/)).toBeTruthy();
    expect(screen.getByText('Manatee County Vital Statistics')).toBeTruthy();
    expect(screen.getByText('Fax 941-554-5490')).toBeTruthy();
    expect(screen.getByText('Default')).toBeTruthy();
    expect(screen.getByText('office@funeralhome.example')).toBeTruthy();
    expect((screen.getByLabelText('Email subject') as HTMLInputElement).value).toBe('Manors Cremation - DC Application Bundle {reference}');
    expect(screen.getByText('Manors Cremation - DC Application Bundle DC-7Q4K9M')).toBeTruthy();
    expect(screen.getByText(/extra pages/)).toBeTruthy();
    // The built-in destination cannot be archived; it is the default.
    expect(screen.queryByRole('button', { name: 'Archive' })).toBeNull();
    expect(screen.getByText(/No changes yet/)).toBeTruthy();
  });

  it('an unverified provider: the message can be drafted but not switched on; a cover page is not available', async () => {
    renderPanel();
    const message = (await screen.findByLabelText(/Include a message/)) as HTMLInputElement;
    expect(message.disabled).toBe(true);
    expect(screen.getByText(/has not been verified to fax a message/)).toBeTruthy();
    expect((screen.getByLabelText(/Message/, { selector: 'textarea' }) as HTMLTextAreaElement).disabled).toBe(false);
    expect((screen.getByLabelText(/cover page/i, { selector: 'input' }) as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText(/never creates a cover page itself/)).toBeTruthy();
  });

  it('checks the subject as it is typed, with the server\'s own rules — a subject without {reference} or with case details cannot be saved', async () => {
    renderPanel();
    const subject = (await screen.findByLabelText('Email subject')) as HTMLInputElement;
    const save = screen.getByRole('button', { name: 'Save settings' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(subject, { target: { value: 'DC applications' } });
    expect(screen.getByText(/must include \{reference\}/)).toBeTruthy();
    expect(subject.getAttribute('aria-invalid')).toBe('true');
    expect(save.disabled).toBe(true);
    fireEvent.change(subject, { target: { value: 'DC applications for {decedentName} {reference}' } });
    expect(screen.getByText(/never include decedent or case information/)).toBeTruthy();
    expect(save.disabled).toBe(true);
    expect(client.saveFaxSettings).not.toHaveBeenCalled();
  });

  it('saves the subject with the revision it was loaded at; the server\'s refusal is shown', async () => {
    client.saveFaxSettings.mockRejectedValueOnce(new Error('Fax Settings were changed by someone else. Reload to see them.'));
    renderPanel();
    const subject = (await screen.findByLabelText('Email subject')) as HTMLInputElement;
    const save = screen.getByRole('button', { name: 'Save settings' }) as HTMLButtonElement;
    fireEvent.change(subject, { target: { value: 'DC applications {reference}' } });
    expect(screen.getByText('Unsaved changes')).toBeTruthy();
    fireEvent.click(save);
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toMatch(/changed by someone else/);
    expect(client.saveFaxSettings).toHaveBeenCalledWith('managed-cremations', { expectedRevision: null, providerKey: 'nuso', subjectTemplate: 'DC applications {reference}', bodyEnabled: false, bodyTemplate: '', coverPageEnabled: false });
  });

  it('adds a destination; the number is checked as it is typed and the server validates it again', async () => {
    client.addFaxDestination.mockResolvedValue(overview());
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Add destination' }));
    fireEvent.change(screen.getByLabelText('Destination name'), { target: { value: 'Sarasota County Records' } });
    fireEvent.change(screen.getByLabelText('Fax number'), { target: { value: '941-555-01' } });
    expect(screen.getByText(/10-digit US or Canadian/)).toBeTruthy();
    const submit = screen.getAllByRole('button', { name: 'Add destination' }).find((b) => b.getAttribute('type') === 'submit') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Fax number'), { target: { value: '941-555-0177' } });
    fireEvent.click(screen.getByLabelText(/Make this the default/));
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);
    await waitFor(() => expect(client.addFaxDestination).toHaveBeenCalledWith('managed-cremations', { name: 'Sarasota County Records', faxNumber: '941-555-0177', purpose: '', makeDefault: true }));
  });

  it('a destination the server refuses keeps its form open and shows why inside it', async () => {
    client.addFaxDestination.mockRejectedValueOnce(new Error('A destination with that fax number already exists.'));
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Add destination' }));
    fireEvent.change(screen.getByLabelText('Destination name'), { target: { value: 'Sarasota County Records' } });
    fireEvent.change(screen.getByLabelText('Fax number'), { target: { value: '941-555-0177' } });
    const submit = screen.getAllByRole('button', { name: 'Add destination' }).find((b) => b.getAttribute('type') === 'submit') as HTMLButtonElement;
    fireEvent.click(submit);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('A destination with that fax number already exists.');
    expect(alert.closest('form')).toBeTruthy();
    expect((screen.getByLabelText('Destination name') as HTMLInputElement).value).toBe('Sarasota County Records');
  });

  it('other destinations can be made the default or archived; edits carry the destination\'s revision', async () => {
    const two = overview({
        settings: { ...overview().settings, exists: true, revision: 4 },
        destinations: [
          { id: 'fxd-a', name: 'Manatee County Vital Statistics', faxNumber: '9415545490', faxNumberDisplay: '941-554-5490', address: '9415545490@fax.nuso.io', purpose: '', status: 'active', isDefault: true, builtIn: false, revision: 2, updatedAt: null },
          { id: 'fxd-b', name: 'Sarasota County Records', faxNumber: '9415550177', faxNumberDisplay: '941-555-0177', address: '9415550177@fax.nuso.io', purpose: 'Amendments', status: 'active', isDefault: false, builtIn: false, revision: 7, updatedAt: null },
        ],
      });
    client.fetchFaxSettings.mockResolvedValue(two);
    client.makeDefaultFaxDestination.mockResolvedValue(two);
    client.archiveFaxDestination.mockResolvedValue(two);
    renderPanel();
    const row = (await screen.findByText('Sarasota County Records')).closest('li')!;
    fireEvent.click(within(row).getByRole('button', { name: 'Make default' }));
    await waitFor(() => expect(client.makeDefaultFaxDestination).toHaveBeenCalledWith('managed-cremations', 'fxd-b', 4));
    fireEvent.click(within((await screen.findByText('Sarasota County Records')).closest('li')!).getByRole('button', { name: 'Archive' }));
    await waitFor(() => expect(client.archiveFaxDestination).toHaveBeenCalledWith('managed-cremations', 'fxd-b', 7));
  });
});
