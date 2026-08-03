/**
 * Phase 26 (Electronic Signatures & Authorization Workflows). The
 * notification-sending interface `services/signatureService.ts` depends
 * on — never a concrete email provider directly (mirrors
 * `lib/documentRenderer.ts`/`lib/documentStorageProvider.ts`/
 * `lib/paymentProvider.ts`'s exact provider-neutral pattern: a plain
 * `const x: Interface = concreteImpl` assignment, no factory function,
 * anywhere in this codebase). The one real implementation,
 * `lib/identityMessageSignatureNotifier.ts`, wraps
 * `lib/identity/messageSender.ts`'s existing `IdentityMessageSender` —
 * this interface exists so `signatureService.ts` itself never imports
 * that module directly, keeping the notification-dispatch boundary
 * structurally enforceable (see this phase's structural test).
 */
export type SignatureNotifier = {
  notifyRequested(params: { to: string; signerName: string; caseDisplayName: string; signLink: string; expiresAt: string | null }): Promise<void>;
  notifyCompleted(params: { to: string; signerName: string; caseDisplayName: string }): Promise<void>;
  notifyDeclined(params: { to: string; signerName: string; caseDisplayName: string; reason: string | null }): Promise<void>;
  notifyCancelled(params: { to: string; signerName: string; caseDisplayName: string }): Promise<void>;
};
