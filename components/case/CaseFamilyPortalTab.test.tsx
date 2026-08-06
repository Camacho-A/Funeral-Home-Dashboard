import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CaseFamilyPortalTab } from './CaseFamilyPortalTab';
import { OrganizationProvider } from '@/hooks/useOrganization';
import * as portalClient from '@/lib/portalClient';
import * as caseDocumentsClient from '@/lib/caseDocumentsClient';
import * as identityAuthClient from '@/lib/identityAuthClient';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import type { PortalInvitation } from '@/types/portalInvitation';
import type { PortalAccess } from '@/types/portalAccess';
import type { CaseDocument } from '@/types/caseDocument';

vi.mock('@/lib/portalClient', async () => {
  const actual = await vi.importActual<typeof import('@/lib/portalClient')>('@/lib/portalClient');
  return {
    ...actual,
    fetchPortalInvitations: vi.fn(),
    revokePortalInvitationRequest: vi.fn(),
    fetchPortalAccess: vi.fn(),
    setPortalAccessAction: vi.fn(),
    fetchPortalMessages: vi.fn(),
    sendPortalStaffMessage: vi.fn(),
  };
});

vi.mock('@/lib/caseDocumentsClient', async () => {
  const actual = await vi.importActual<typeof import('@/lib/caseDocumentsClient')>('@/lib/caseDocumentsClient');
  return { ...actual, fetchCaseDocuments: vi.fn(), setCaseDocumentFamilyVisibility: vi.fn() };
});

vi.mock('@/lib/identityAuthClient', async () => {
  const actual = await vi.importActual<typeof import('@/lib/identityAuthClient')>('@/lib/identityAuthClient');
  return { ...actual, fetchMyPermissions: vi.fn() };
});

function makeInvitation(overrides: Partial<PortalInvitation> = {}): PortalInvitation {
  return {
    id: 'invitation-1',
    organizationId: DEFAULT_ORGANIZATION_ID,
    caseId: 'case-1',
    email: 'family@example.com',
    displayName: 'Pat Family',
    relationshipType: 'primary_next_of_kin',
    status: 'pending',
    tokenHash: 'hash',
    expiresAt: '2026-09-01T00:00:00.000Z',
    invitedByStaffIdentityId: 'identity-1',
    linkedPortalAccessId: 'access-1',
    acceptedAt: null,
    revokedAt: null,
    revokedByStaffIdentityId: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeAccess(overrides: Partial<PortalAccess> = {}): PortalAccess {
  return {
    id: 'access-1',
    portalUserId: 'portal-user-1',
    organizationId: DEFAULT_ORGANIZATION_ID,
    caseId: 'case-1',
    relationshipType: 'primary_next_of_kin',
    status: 'active',
    grantedFromInvitationId: 'invitation-1',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeDocument(overrides: Partial<CaseDocument> = {}): CaseDocument {
  return {
    id: 'doc-1',
    organizationId: DEFAULT_ORGANIZATION_ID,
    caseId: 'case-1',
    origin: 'generated',
    documentTypeKey: 'authorization.cremation',
    category: 'authorization',
    fileName: 'Cremation Authorization.pdf',
    mimeType: 'application/pdf',
    fileSizeBytes: 12345,
    checksumSha256: 'abc123',
    storageKey: 'managed-cremations/case-1/doc-1.pdf',
    status: 'active',
    templateId: 'template-1',
    templateVersion: 1,
    version: 1,
    supersedesId: null,
    signatureStatus: null,
    familyVisible: false,
    generatedBy: 'Dana',
    uploadedBy: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    correlationId: 'corr-1',
    ...overrides,
  };
}

function renderTab() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <OrganizationProvider organizationId={DEFAULT_ORGANIZATION_ID}>
        <CaseFamilyPortalTab caseId="case-1" />
      </OrganizationProvider>
    </QueryClientProvider>,
  );
}

function mockPermissions(permissions: string[]) {
  vi.mocked(identityAuthClient.fetchMyPermissions).mockResolvedValue({ identityId: 'identity-1', roleKey: 'administrator', permissions });
}

beforeEach(() => {
  mockPermissions(['portal.manage', 'portal.message']);
  vi.mocked(portalClient.fetchPortalMessages).mockResolvedValue([]);
  vi.mocked(caseDocumentsClient.fetchCaseDocuments).mockResolvedValue([]);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('CaseFamilyPortalTab', () => {
  it('shows empty states when no invitations, access, documents, or messages exist', async () => {
    vi.mocked(portalClient.fetchPortalInvitations).mockResolvedValue([]);
    vi.mocked(portalClient.fetchPortalAccess).mockResolvedValue([]);
    renderTab();
    expect(await screen.findByText('No pending Family Portal invitations for this case.')).toBeInTheDocument();
    expect(screen.getByText("No one has Family Portal access to this case yet.")).toBeInTheDocument();
    expect(screen.getByText('No documents for this case yet.')).toBeInTheDocument();
    expect(screen.getByText('No messages with the family for this case yet.')).toBeInTheDocument();
  });

  it('lists a pending invitation with its relationship type and a Revoke action', async () => {
    vi.mocked(portalClient.fetchPortalInvitations).mockResolvedValue([makeInvitation()]);
    vi.mocked(portalClient.fetchPortalAccess).mockResolvedValue([]);
    renderTab();
    expect(await screen.findByText('Pat Family')).toBeInTheDocument();
    expect(screen.getByText(/Primary Next of Kin/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Revoke' })).toBeInTheDocument();
  });

  it('revokes an invitation through the confirm dialog', async () => {
    vi.mocked(portalClient.fetchPortalInvitations).mockResolvedValue([makeInvitation()]);
    vi.mocked(portalClient.fetchPortalAccess).mockResolvedValue([]);
    vi.mocked(portalClient.revokePortalInvitationRequest).mockResolvedValue(makeInvitation({ status: 'revoked' }));
    renderTab();
    await screen.findByText('Pat Family');

    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    fireEvent.click(screen.getByRole('button', { name: 'Revoke Invitation' }));
    await waitFor(() => expect(portalClient.revokePortalInvitationRequest).toHaveBeenCalledWith({ organizationId: DEFAULT_ORGANIZATION_ID, caseId: 'case-1', invitationId: 'invitation-1' }));
  });

  it('lists an active access grant with a Disable action', async () => {
    vi.mocked(portalClient.fetchPortalInvitations).mockResolvedValue([]);
    vi.mocked(portalClient.fetchPortalAccess).mockResolvedValue([makeAccess()]);
    renderTab();
    expect(await screen.findByRole('button', { name: 'Disable' })).toBeInTheDocument();
  });

  it('toggles a document\'s family visibility via the checkbox', async () => {
    vi.mocked(portalClient.fetchPortalInvitations).mockResolvedValue([]);
    vi.mocked(portalClient.fetchPortalAccess).mockResolvedValue([]);
    vi.mocked(caseDocumentsClient.fetchCaseDocuments).mockResolvedValue([makeDocument()]);
    vi.mocked(caseDocumentsClient.setCaseDocumentFamilyVisibility).mockResolvedValue(makeDocument({ familyVisible: true }));
    renderTab();
    await screen.findByText('Cremation Authorization.pdf');

    fireEvent.click(screen.getByRole('checkbox', { name: 'Family-visible: Cremation Authorization.pdf' }));
    await waitFor(() =>
      expect(caseDocumentsClient.setCaseDocumentFamilyVisibility).toHaveBeenCalledWith({
        organizationId: DEFAULT_ORGANIZATION_ID,
        caseId: 'case-1',
        documentId: 'doc-1',
        familyVisible: true,
      }),
    );
  });

  it('hides the Invite Family Member button when the caller lacks portal.manage', async () => {
    mockPermissions(['portal.message']);
    vi.mocked(portalClient.fetchPortalInvitations).mockResolvedValue([]);
    vi.mocked(portalClient.fetchPortalAccess).mockResolvedValue([]);
    renderTab();
    await screen.findByText('No pending Family Portal invitations for this case.');
    expect(screen.queryByRole('button', { name: 'Invite Family Member' })).not.toBeInTheDocument();
  });

  it('hides the message-send form when the caller lacks portal.message', async () => {
    mockPermissions(['portal.manage']);
    vi.mocked(portalClient.fetchPortalInvitations).mockResolvedValue([]);
    vi.mocked(portalClient.fetchPortalAccess).mockResolvedValue([]);
    renderTab();
    await screen.findByText('No messages with the family for this case yet.');
    expect(screen.queryByRole('button', { name: 'Send' })).not.toBeInTheDocument();
  });
});
