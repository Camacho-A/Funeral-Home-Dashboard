import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { OrganizationProfilePanel } from './OrganizationProfilePanel';
import { OrganizationProvider } from '@/hooks/useOrganization';
import * as identityAuthClient from '@/lib/identityAuthClient';
import * as organizationProfileClient from '@/lib/organizationProfileClient';
import { OrganizationProfileValidationError } from '@/lib/organizationProfileClient';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';

vi.mock('@/lib/identityAuthClient', async () => {
  const actual = await vi.importActual<typeof import('@/lib/identityAuthClient')>('@/lib/identityAuthClient');
  return { ...actual, fetchMyPermissions: vi.fn() };
});

vi.mock('@/lib/organizationProfileClient', async () => {
  const actual = await vi.importActual<typeof import('@/lib/organizationProfileClient')>('@/lib/organizationProfileClient');
  return { ...actual, fetchOrganizationProfile: vi.fn(), updateOrganizationProfile: vi.fn(), updatePrimaryLocationProfile: vi.fn() };
});

function mockPermissions(permissions: string[]) {
  vi.mocked(identityAuthClient.fetchMyPermissions).mockResolvedValue({ identityId: 'identity-1', roleKey: 'administrator', permissions });
}

const ORG_FIELDS = {
  name: "MANOR'S CREMATION",
  legalName: '',
  primaryEmail: 'staff@managedcremations.test',
  primaryPhone: '(555) 201-4432',
  website: null,
};

const LOCATION_FIELDS = {
  name: 'Main Office',
  locationType: 'office',
  addressLine1: '100 Memorial Drive',
  addressLine2: null,
  city: 'Springfield',
  state: 'IL',
  postalCode: '62701',
  country: 'US',
  phone: '(555) 201-4432',
  email: null,
};

function mockProfile(organization = ORG_FIELDS, location: typeof LOCATION_FIELDS | null = LOCATION_FIELDS) {
  vi.mocked(organizationProfileClient.fetchOrganizationProfile).mockResolvedValue({ organization, location });
}

function renderPanel() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <OrganizationProvider organizationId={DEFAULT_ORGANIZATION_ID}>
        <OrganizationProfilePanel />
      </OrganizationProvider>
    </QueryClientProvider>,
  );
}

describe('OrganizationProfilePanel', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('35. renders nothing sensitive and shows a plain message for a caller without organization.manage', async () => {
    mockPermissions(['case.read']);
    renderPanel();
    expect(await screen.findByText("You don't have access to Organization Profile.")).toBeInTheDocument();
    expect(organizationProfileClient.fetchOrganizationProfile).not.toHaveBeenCalled();
  });

  it('renders both sections with the loaded profile for an authorized Administrator', async () => {
    mockPermissions(['organization.manage']);
    mockProfile();
    renderPanel();

    expect(await screen.findByText('Organization')).toBeInTheDocument();
    expect(screen.getByText('Primary Location')).toBeInTheDocument();
    expect(screen.getByDisplayValue("MANOR'S CREMATION")).toBeInTheDocument();
    expect(screen.getByDisplayValue('100 Memorial Drive')).toBeInTheDocument();
  });

  it('32. never displays a technical id anywhere on the page', async () => {
    mockPermissions(['organization.manage']);
    mockProfile();
    const { container } = renderPanel();
    await screen.findByText('Organization');
    expect(container.textContent).not.toMatch(/managed-cremations/);
  });

  it('23. shows a clear administrative message when no primary location exists, without a form', async () => {
    mockPermissions(['organization.manage']);
    mockProfile(ORG_FIELDS, null);
    renderPanel();

    await screen.findByText('Organization');
    expect(screen.getByText(/No primary location exists for this organization yet/)).toBeInTheDocument();
    expect(screen.queryByDisplayValue('Main Office')).not.toBeInTheDocument();
  });

  it('33. a successful Organization save shows a confirmation and refreshes the displayed values', async () => {
    mockPermissions(['organization.manage']);
    mockProfile();
    vi.mocked(organizationProfileClient.updateOrganizationProfile).mockResolvedValue({ ...ORG_FIELDS, name: 'MANORS CREMATION SERVICES' });
    renderPanel();

    const nameInput = await screen.findByDisplayValue("MANOR'S CREMATION");
    fireEvent.change(nameInput, { target: { value: 'MANORS CREMATION SERVICES' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Save' })[0]);

    expect(await screen.findByText('Organization profile saved.')).toBeInTheDocument();
    expect(screen.getByDisplayValue('MANORS CREMATION SERVICES')).toBeInTheDocument();
  });

  it('34. a failed Organization save preserves the entered values and shows the error', async () => {
    mockPermissions(['organization.manage']);
    mockProfile();
    vi.mocked(organizationProfileClient.updateOrganizationProfile).mockRejectedValue(new Error('Something went wrong. Please try again.'));
    renderPanel();

    const nameInput = await screen.findByDisplayValue("MANOR'S CREMATION");
    fireEvent.change(nameInput, { target: { value: 'A NEW NAME I TYPED' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Save' })[0]);

    expect(await screen.findByText('Something went wrong. Please try again.')).toBeInTheDocument();
    expect(screen.getByDisplayValue('A NEW NAME I TYPED')).toBeInTheDocument();
    expect(screen.queryByText('Organization profile saved.')).not.toBeInTheDocument();
  });

  it('inline field-level validation errors are shown next to the offending field', async () => {
    mockPermissions(['organization.manage']);
    mockProfile();
    vi.mocked(organizationProfileClient.updateOrganizationProfile).mockRejectedValue(
      new OrganizationProfileValidationError('Validation failed.', [{ field: 'primaryEmail', message: 'Primary email must be a valid email address.' }]),
    );
    renderPanel();

    await screen.findByDisplayValue("MANOR'S CREMATION");
    fireEvent.click(screen.getAllByRole('button', { name: 'Save' })[0]);

    expect(await screen.findByText('Primary email must be a valid email address.')).toBeInTheDocument();
  });

  it('a successful Primary Location save shows its own confirmation, independent of the Organization section', async () => {
    mockPermissions(['organization.manage']);
    mockProfile();
    vi.mocked(organizationProfileClient.updatePrimaryLocationProfile).mockResolvedValue({ ...LOCATION_FIELDS, city: 'Oakland Park' });
    renderPanel();

    await screen.findByDisplayValue('100 Memorial Drive');
    fireEvent.click(screen.getAllByRole('button', { name: 'Save' })[1]);

    expect(await screen.findByText('Primary location saved.')).toBeInTheDocument();
    expect(organizationProfileClient.updateOrganizationProfile).not.toHaveBeenCalled();
  });

  it('36/37. does not render or reference the Statement, mergeEngine, or Case Documents in any way', async () => {
    mockPermissions(['organization.manage']);
    mockProfile();
    const { container } = renderPanel();
    await screen.findByText('Organization');
    expect(container.textContent).not.toMatch(/statement/i);
    expect(container.textContent).not.toMatch(/merge/i);
  });
});
