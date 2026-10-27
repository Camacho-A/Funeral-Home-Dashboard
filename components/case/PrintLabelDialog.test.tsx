import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { CremationLabelState, SavedCremationLabelFile } from '@/lib/caseLabelClient';

/** Cremation Label (2026-10). The dialog with the label routes and DYMO Connect faked. */
const { client, dymo, permissions } = vi.hoisted(() => ({
  client: {
    fetchCremationLabelState: vi.fn(),
    fetchSavedCremationLabel: vi.fn(),
    saveCremationLabel: vi.fn(),
    recordCremationLabelPrinted: vi.fn(),
  },
  dymo: { findDymoService: vi.fn(), listDymoPrinters: vi.fn(), renderDymoPreview: vi.fn(), printDymoLabel: vi.fn() },
  permissions: { list: ['document.generate'] as string[] },
}));
vi.mock('@/lib/caseLabelClient', () => client);
vi.mock('@/lib/dymoConnect', () => dymo);
vi.mock('@/hooks/useRbac', () => ({ useMyPermissions: () => ({ isSuccess: true, data: { permissions: permissions.list } }) }));

const { PrintLabelDialog } = await import('./PrintLabelDialog');

const V1 = { name: 'Juniper Fairweather', tag: 'Tag #90210', date: 'November 3, 2026' };
const savedFile = (over: Partial<SavedCremationLabelFile> = {}): SavedCremationLabelFile => ({
  label: { documentId: 'label-v1', version: 1, status: 'active', createdAt: '2026-10-27T15:00:00.000Z', actorDisplayName: 'Dana Ruiz' },
  labelXml: '<DesktopLabel>saved v1</DesktopLabel>',
  values: V1,
  isLatest: true,
  ...over,
});
const state = (over: Partial<CremationLabelState> = {}): CremationLabelState => ({
  current: { ok: true, values: V1, labelXml: '<DesktopLabel>current</DesktopLabel>' },
  latest: { ...savedFile().label, values: V1 },
  latestMatchesCase: true,
  ...over,
});

function dymoReady() {
  dymo.findDymoService.mockResolvedValue('https://127.0.0.1:41951');
  dymo.listDymoPrinters.mockResolvedValue([{ name: 'DYMO LabelWriter 550', isConnected: true }]);
  dymo.renderDymoPreview.mockImplementation(async (_base: string, xml: string) => `data:image/png;base64,${btoa(xml)}`);
  dymo.printDymoLabel.mockResolvedValue(undefined);
}
function dymoUnavailable() {
  dymo.findDymoService.mockRejectedValue(new Error('DYMO Connect is not running on this computer.'));
}

beforeEach(() => {
  permissions.list = ['document.generate'];
  client.recordCremationLabelPrinted.mockResolvedValue(undefined);
});
afterEach(() => vi.clearAllMocks());

const open = (documentId?: string) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <PrintLabelDialog open onClose={() => {}} caseId="1042" organizationId="managed-cremations" documentId={documentId} />
    </QueryClientProvider>,
  );

describe('PrintLabelDialog', () => {
  it('saves a label with the printer disconnected, then offers it for download — never a print without DYMO', async () => {
    dymoUnavailable();
    client.fetchCremationLabelState.mockResolvedValueOnce(state({ latest: null, latestMatchesCase: false })).mockResolvedValue(state());
    client.fetchSavedCremationLabel.mockResolvedValue(savedFile());
    client.saveCremationLabel.mockResolvedValue({ outcome: 'saved', documentId: 'label-v1', version: 1 });
    open();

    expect(await screen.findByText('No label has been saved for this case yet.')).toBeInTheDocument();
    expect(screen.getByText('Juniper Fairweather')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save Label' }));
    expect(await screen.findByText("Saved as Cremation Label v1 in this case's Documents.")).toBeInTheDocument();
    expect(client.saveCremationLabel).toHaveBeenCalledWith('managed-cremations', '1042', null);

    expect(await screen.findByText('Saved label v1')).toBeInTheDocument();
    expect(screen.getByText('Latest')).toBeInTheDocument();
    expect(screen.getByText(/DYMO Connect is not running on this computer\. The saved label is kept as it is\./)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Download .dymo' })).toHaveAttribute('href', expect.stringContaining('/api/cases/1042/documents/label-v1/download'));
    expect(screen.queryByRole('button', { name: 'Print' })).toBeNull();
  });

  it('prints the SAVED label exactly as stored and records the print', async () => {
    dymoReady();
    client.fetchCremationLabelState.mockResolvedValue(state());
    client.fetchSavedCremationLabel.mockResolvedValue(savedFile());
    open();

    const image = await screen.findByRole('img', { name: 'Label preview: Juniper Fairweather, Tag #90210, November 3, 2026' });
    expect(image).toHaveAttribute('src', `data:image/png;base64,${btoa('<DesktopLabel>saved v1</DesktopLabel>')}`);
    expect(screen.queryByRole('button', { name: /Save/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Print' }));
    expect(await screen.findByText('Sent to DYMO LabelWriter 550.')).toBeInTheDocument();
    expect(dymo.printDymoLabel).toHaveBeenCalledWith('https://127.0.0.1:41951', 'DYMO LabelWriter 550', '<DesktopLabel>saved v1</DesktopLabel>');
    expect(client.recordCremationLabelPrinted).toHaveBeenCalledWith('managed-cremations', '1042', 'label-v1', 'DYMO LabelWriter 550');
  });

  it('when the case changed, keeps printing the saved label and asks before saving a new version', async () => {
    dymoReady();
    const now = { name: 'Juniper Fairweather', tag: 'Tag #90211', date: 'November 3, 2026' };
    client.fetchCremationLabelState.mockResolvedValue(state({ current: { ok: true, values: now, labelXml: '<DesktopLabel>current</DesktopLabel>' }, latestMatchesCase: false }));
    client.fetchSavedCremationLabel.mockResolvedValue(savedFile());
    client.saveCremationLabel.mockResolvedValue({ outcome: 'saved', documentId: 'label-v2', version: 2 });
    open();

    expect(await screen.findByText(/changed after this label was saved\. Print still uses the saved label\./)).toHaveTextContent('Tag #90211');
    fireEvent.click(await screen.findByRole('button', { name: 'Print' }));
    await waitFor(() => expect(dymo.printDymoLabel).toHaveBeenCalledWith(expect.any(String), 'DYMO LabelWriter 550', '<DesktopLabel>saved v1</DesktopLabel>'));

    fireEvent.click(screen.getByRole('button', { name: 'Save New Version' }));
    await waitFor(() => expect(client.saveCremationLabel).toHaveBeenCalledWith('managed-cremations', '1042', 'label-v1'));
  });

  it('a printer failure says so and leaves the saved label alone', async () => {
    dymoReady();
    dymo.printDymoLabel.mockRejectedValue(new Error('DYMO Connect could not print the label (printer offline).'));
    client.fetchCremationLabelState.mockResolvedValue(state());
    client.fetchSavedCremationLabel.mockResolvedValue(savedFile());
    open();
    fireEvent.click(await screen.findByRole('button', { name: 'Print' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('could not print the label (printer offline). The saved label is unchanged.');
    expect(client.saveCremationLabel).not.toHaveBeenCalled();
    expect(client.recordCremationLabelPrinted).not.toHaveBeenCalled();
  });

  it('refuses to save when a value is missing', async () => {
    dymoUnavailable();
    client.fetchCremationLabelState.mockResolvedValue(
      state({ latest: null, current: { ok: false, missing: ['date'], message: "Can't print the label yet. Add the Date of Cremation to this case first." } }),
    );
    open();
    expect(await screen.findByRole('alert')).toHaveTextContent('Add the Date of Cremation');
    expect(screen.queryByRole('button', { name: /Save/ })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Download .dymo' })).toBeNull();
  });

  it('staff without document permission can print a saved label but not save one', async () => {
    permissions.list = [];
    dymoReady();
    client.fetchCremationLabelState.mockResolvedValue(state({ latestMatchesCase: false }));
    client.fetchSavedCremationLabel.mockResolvedValue(savedFile());
    open();
    expect(await screen.findByRole('button', { name: 'Print' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Save/ })).toBeNull();
  });

  it('opened on an older version from Documents, shows and prints that version only', async () => {
    dymoReady();
    client.fetchSavedCremationLabel.mockResolvedValue(savedFile({ isLatest: false, label: { ...savedFile().label, status: 'superseded' } }));
    open('label-v1');
    expect(await screen.findByText('Older version')).toBeInTheDocument();
    expect(client.fetchCremationLabelState).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /Save/ })).toBeNull();
    fireEvent.click(await screen.findByRole('button', { name: 'Print' }));
    await waitFor(() => expect(dymo.printDymoLabel).toHaveBeenCalledWith(expect.any(String), 'DYMO LabelWriter 550', '<DesktopLabel>saved v1</DesktopLabel>'));
  });
});
