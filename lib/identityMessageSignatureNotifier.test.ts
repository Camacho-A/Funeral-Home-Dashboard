import { afterEach, describe, expect, it, vi } from 'vitest';
import { identityMessageSignatureNotifier } from './identityMessageSignatureNotifier';
import * as messageSender from './identity/messageSender';

vi.mock('./identity/messageSender', async () => {
  const actual = await vi.importActual<typeof import('./identity/messageSender')>('./identity/messageSender');
  return { ...actual, getIdentityMessageSender: vi.fn() };
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('identityMessageSignatureNotifier', () => {
  it('notifyRequested sends a signature_request message via getIdentityMessageSender', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    vi.mocked(messageSender.getIdentityMessageSender).mockReturnValue({ send });

    await identityMessageSignatureNotifier.notifyRequested({
      to: 'jane@example.com',
      signerName: 'Jane Doe',
      caseDisplayName: 'Robert Ellison',
      signLink: 'https://beacon.test/sign?token=abc123',
      expiresAt: '2026-09-01T00:00:00.000Z',
    });

    expect(send).toHaveBeenCalledWith({
      kind: 'signature_request',
      to: 'jane@example.com',
      signerName: 'Jane Doe',
      caseDisplayName: 'Robert Ellison',
      signLink: 'https://beacon.test/sign?token=abc123',
      expiresAt: '2026-09-01T00:00:00.000Z',
    });
  });

  it('notifyCompleted sends a signature_completed message', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    vi.mocked(messageSender.getIdentityMessageSender).mockReturnValue({ send });

    await identityMessageSignatureNotifier.notifyCompleted({ to: 'jane@example.com', signerName: 'Jane Doe', caseDisplayName: 'Robert Ellison' });

    expect(send).toHaveBeenCalledWith({ kind: 'signature_completed', to: 'jane@example.com', signerName: 'Jane Doe', caseDisplayName: 'Robert Ellison' });
  });

  it('notifyDeclined sends a signature_declined message, including a null reason', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    vi.mocked(messageSender.getIdentityMessageSender).mockReturnValue({ send });

    await identityMessageSignatureNotifier.notifyDeclined({ to: 'jane@example.com', signerName: 'Jane Doe', caseDisplayName: 'Robert Ellison', reason: null });

    expect(send).toHaveBeenCalledWith({ kind: 'signature_declined', to: 'jane@example.com', signerName: 'Jane Doe', caseDisplayName: 'Robert Ellison', reason: null });
  });

  it('notifyCancelled sends a signature_cancelled message', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    vi.mocked(messageSender.getIdentityMessageSender).mockReturnValue({ send });

    await identityMessageSignatureNotifier.notifyCancelled({ to: 'jane@example.com', signerName: 'Jane Doe', caseDisplayName: 'Robert Ellison' });

    expect(send).toHaveBeenCalledWith({ kind: 'signature_cancelled', to: 'jane@example.com', signerName: 'Jane Doe', caseDisplayName: 'Robert Ellison' });
  });

  it('propagates a send failure rather than swallowing it — signatureService.ts decides how to handle delivery failure', async () => {
    const send = vi.fn().mockRejectedValue(new Error('No identity message provider is configured for production.'));
    vi.mocked(messageSender.getIdentityMessageSender).mockReturnValue({ send });

    await expect(
      identityMessageSignatureNotifier.notifyRequested({ to: 'jane@example.com', signerName: 'Jane Doe', caseDisplayName: 'Robert Ellison', signLink: 'https://beacon.test/sign?token=abc', expiresAt: null }),
    ).rejects.toThrow(/no identity message provider/i);
  });
});
