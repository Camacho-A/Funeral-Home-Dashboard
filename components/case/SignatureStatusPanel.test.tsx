import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SignatureStatusPanel } from './SignatureStatusPanel';
import * as signatureRequestsClient from '@/lib/signatureRequestsClient';
import * as activityClient from '@/lib/activityClient';
import { DEFAULT_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import type { SignatureRequest } from '@/types/signatureRequest';
import type { SignatureRecord } from '@/types/signatureRecord';
import type { ActivityEvent } from '@/types/activityEvent';

vi.mock('@/lib/signatureRequestsClient', async () => {
  const actual = await vi.importActual<typeof import('@/lib/signatureRequestsClient')>('@/lib/signatureRequestsClient');
  return { ...actual, fetchSignatureRequests: vi.fn(), resendSignatureRequest: vi.fn(), cancelSignatureRequest: vi.fn() };
});

vi.mock('@/lib/activityClient', async () => {
  const actual = await vi.importActual<typeof import('@/lib/activityClient')>('@/lib/activityClient');
  return { ...actual, fetchCaseActivity: vi.fn() };
});

function makeRequest(overrides: Partial<SignatureRequest> = {}): SignatureRequest {
  return {
    id: 'sigreq-1',
    organizationId: DEFAULT_ORGANIZATION_ID,
    caseId: 'case-1',
    documentId: 'doc-1',
    documentVersion: 1,
    signerName: 'Jane Doe',
    signerEmail: 'jane@example.com',
    signerRole: 'next_of_kin',
    status: 'pending',
    tokenHash: 'hash',
    issuedAt: '2026-08-14T00:00:00.000Z',
    expiresAt: null,
    requestVersion: 1,
    sequenceOrder: 1,
    requestedBy: 'identity-1',
    viewedAt: null,
    signedAt: null,
    declinedAt: null,
    declineReason: null,
    cancelledAt: null,
    cancelledBy: null,
    lastRemindedAt: null,
    reminderCount: 0,
    correlationId: 'corr-1',
    ...overrides,
  };
}

function makeRecord(overrides: Partial<SignatureRecord> = {}): SignatureRecord {
  return {
    id: 'rec-1',
    organizationId: DEFAULT_ORGANIZATION_ID,
    caseId: 'case-1',
    documentId: 'doc-1',
    documentVersion: 1,
    signatureRequestId: 'sigreq-1',
    signerName: 'Jane Doe',
    signerEmail: 'jane@example.com',
    signerRole: 'next_of_kin',
    signedName: 'Jane Doe',
    initials: null,
    ipAddress: '203.0.113.1',
    userAgent: 'test',
    signatureMethod: 'typed_name',
    verificationStatus: 'verified',
    documentChecksumSha256: 'abc',
    recordVersion: 1,
    correlationId: 'corr-1',
    signedAt: '2026-08-14T01:00:00.000Z',
    ...overrides,
  };
}

function renderPanel(props: Partial<Parameters<typeof SignatureStatusPanel>[0]> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <SignatureStatusPanel organizationId={DEFAULT_ORGANIZATION_ID} caseId="case-1" documentId="doc-1" canRequest canCancel {...props} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('SignatureStatusPanel', () => {
  it('shows "no signature requested yet" when there are no requests or records', async () => {
    vi.mocked(signatureRequestsClient.fetchSignatureRequests).mockResolvedValue({ requests: [], records: [] });
    vi.mocked(activityClient.fetchCaseActivity).mockResolvedValue({ events: [], nextCursor: null });
    renderPanel();
    expect(await screen.findByText('No signature has been requested for this document yet.')).toBeInTheDocument();
  });

  it('shows the active request\'s signer, status badge, and timestamps', async () => {
    vi.mocked(signatureRequestsClient.fetchSignatureRequests).mockResolvedValue({ requests: [makeRequest({ status: 'viewed', viewedAt: '2026-08-14T02:00:00.000Z' })], records: [] });
    vi.mocked(activityClient.fetchCaseActivity).mockResolvedValue({ events: [], nextCursor: null });
    renderPanel();
    expect(await screen.findByText('Jane Doe (jane@example.com)')).toBeInTheDocument();
    expect(screen.getByText('Viewed')).toBeInTheDocument();
  });

  it('shows "Signed by X on Y" when a SignatureRecord exists, instead of the request row', async () => {
    vi.mocked(signatureRequestsClient.fetchSignatureRequests).mockResolvedValue({ requests: [makeRequest({ status: 'signed' })], records: [makeRecord()] });
    vi.mocked(activityClient.fetchCaseActivity).mockResolvedValue({ events: [], nextCursor: null });
    renderPanel();
    expect(await screen.findByText(/Signed by Jane Doe on/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Resend' })).not.toBeInTheDocument();
  });

  it('resends the active request', async () => {
    vi.mocked(signatureRequestsClient.fetchSignatureRequests).mockResolvedValue({ requests: [makeRequest()], records: [] });
    vi.mocked(activityClient.fetchCaseActivity).mockResolvedValue({ events: [], nextCursor: null });
    vi.mocked(signatureRequestsClient.resendSignatureRequest).mockResolvedValue(makeRequest({ reminderCount: 1 }));
    renderPanel();

    fireEvent.click(await screen.findByRole('button', { name: 'Resend' }));
    await waitFor(() => expect(signatureRequestsClient.resendSignatureRequest).toHaveBeenCalledWith(expect.objectContaining({ requestId: 'sigreq-1' })));
  });

  it('hides Resend/Cancel when the caller lacks those permissions', async () => {
    vi.mocked(signatureRequestsClient.fetchSignatureRequests).mockResolvedValue({ requests: [makeRequest()], records: [] });
    vi.mocked(activityClient.fetchCaseActivity).mockResolvedValue({ events: [], nextCursor: null });
    renderPanel({ canRequest: false, canCancel: false });

    await screen.findByText('Jane Doe (jane@example.com)');
    expect(screen.queryByRole('button', { name: 'Resend' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
  });

  it('shows signature history filtered to this document\'s document.signature.* events, toggled on demand', async () => {
    vi.mocked(signatureRequestsClient.fetchSignatureRequests).mockResolvedValue({ requests: [makeRequest()], records: [] });
    const events: ActivityEvent[] = [
      {
        id: 'evt-1',
        eventVersion: 1,
        organizationId: DEFAULT_ORGANIZATION_ID,
        caseId: 'case-1',
        actorIdentityId: null,
        actorMembershipId: null,
        actorRoleKey: null,
        category: 'documents',
        eventType: 'document.signature.requested',
        resourceType: 'caseDocument',
        resourceId: 'doc-1',
        previousValue: null,
        newValue: null,
        description: 'Signature requested from Jane Doe (jane@example.com)',
        metadata: JSON.stringify({ signatureRequestId: 'sigreq-1' }),
        severity: 'info',
        correlationId: 'corr-1',
        isSystemGenerated: false,
        createdAt: '2026-08-14T00:00:00.000Z',
      },
      {
        id: 'evt-2',
        eventVersion: 1,
        organizationId: DEFAULT_ORGANIZATION_ID,
        caseId: 'case-1',
        actorIdentityId: null,
        actorMembershipId: null,
        actorRoleKey: null,
        category: 'documents',
        eventType: 'document.generated',
        resourceType: 'caseDocument',
        resourceId: 'doc-1',
        previousValue: null,
        newValue: null,
        description: 'Not a signature event — should be excluded',
        metadata: null,
        severity: 'info',
        correlationId: 'corr-2',
        isSystemGenerated: false,
        createdAt: '2026-08-13T00:00:00.000Z',
      },
    ];
    vi.mocked(activityClient.fetchCaseActivity).mockResolvedValue({ events, nextCursor: null });
    renderPanel();

    fireEvent.click(await screen.findByRole('button', { name: 'Show signature history' }));
    expect(await screen.findByText(/Signature requested from Jane Doe/)).toBeInTheDocument();
    expect(screen.queryByText(/Not a signature event/)).not.toBeInTheDocument();
  });
});
