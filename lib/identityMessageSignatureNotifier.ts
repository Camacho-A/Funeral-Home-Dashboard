import { getIdentityMessageSender } from './identity/messageSender';
import type { SignatureNotifier } from './signatureNotifier';

/**
 * Phase 26 (Electronic Signatures & Authorization Workflows). The one
 * real `SignatureNotifier` implementation — wraps the existing
 * `IdentityMessageSender` abstraction rather than introducing a new
 * email provider dependency. Inherits that abstraction's exact delivery
 * behavior: logs to console in development, throws a named, explicit
 * error in production (no real transactional-email provider is wired up
 * anywhere in this codebase yet — this is not a new gap, the identical
 * one every other `IdentityMessage` kind already has).
 */
export const identityMessageSignatureNotifier: SignatureNotifier = {
  async notifyRequested({ to, signerName, caseDisplayName, signLink, expiresAt }) {
    await getIdentityMessageSender().send({ kind: 'signature_request', to, signerName, caseDisplayName, signLink, expiresAt });
  },
  async notifyCompleted({ to, signerName, caseDisplayName }) {
    await getIdentityMessageSender().send({ kind: 'signature_completed', to, signerName, caseDisplayName });
  },
  async notifyDeclined({ to, signerName, caseDisplayName, reason }) {
    await getIdentityMessageSender().send({ kind: 'signature_declined', to, signerName, caseDisplayName, reason });
  },
  async notifyCancelled({ to, signerName, caseDisplayName }) {
    await getIdentityMessageSender().send({ kind: 'signature_cancelled', to, signerName, caseDisplayName });
  },
};
