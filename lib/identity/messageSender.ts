/**
 * Phase 21 (Identity, Authentication & Session Management), security
 * correction (2026-07-25). Every route that generates a password-reset,
 * email-verification, or invitation token used to return it directly in
 * the HTTP response — a real vulnerability (anyone who could call the
 * route, or intercept the response, got the reset/verification/invitation
 * capability directly, without ever proving they control the target
 * inbox). This module is the one place a token is ever handed to
 * something other than the identity it belongs to.
 *
 * Callers (Route Handlers) still generate the token via
 * `services/passwordService.ts`/`emailVerificationService.ts`/
 * `invitationService.ts` exactly as before — those services still return
 * the raw token internally, since something has to actually deliver it —
 * but it now flows into `IdentityMessageSender.send()`, never into a JSON
 * response body. `getIdentityMessageSender()` decides *how* delivery
 * happens based on environment; no Route Handler ever makes that decision
 * itself.
 */
export type IdentityMessage =
  | { kind: 'password_reset'; to: string; token: string }
  | { kind: 'email_verification'; to: string; token: string }
  | { kind: 'invitation'; to: string; token: string; organizationId: string; membershipId: string }
  | { kind: 'mfa_recovery_codes'; to: string; codes: string[] };

export interface IdentityMessageSender {
  send(message: IdentityMessage): Promise<void>;
}

/**
 * Development-only delivery: logs to the server's own console — never the
 * HTTP response — so a developer running `npm run dev` locally can read a
 * token during manual testing without it ever crossing the network back
 * to a client. Refuses to run at all outside development, as a second,
 * independent guard beyond `getIdentityMessageSender()` never selecting
 * it in production (see that function's own comment on why both guards
 * exist).
 */
export const consoleIdentityMessageSender: IdentityMessageSender = {
  async send(message) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('consoleIdentityMessageSender must never run when NODE_ENV=production.');
    }
    console.log(`[dev-only, never sent to a real inbox] IdentityMessage: ${JSON.stringify(message)}`);
  },
};

/**
 * The production default: this codebase has no transactional email
 * provider wired up (no other phase introduced one either). Rather than
 * silently pretending a message was sent, or falling back to a
 * dev-convenience channel a production deployment could never actually
 * observe, sending always fails loudly and explicitly — a clear signal
 * for whoever operates this deployment to notice and fix (wire up a real
 * provider and replace this adapter) rather than a slow leak of
 * "invitations/resets just don't seem to work."
 *
 * Deliberately never throws from `getIdentityMessageSender()` itself —
 * only from `.send()` — so a Route Handler can call
 * `getIdentityMessageSender()` unconditionally and decide for itself how
 * to handle a delivery failure (see e.g. app/api/auth/forgot-password/route.ts,
 * which logs the failure server-side but still returns the same generic
 * response to the client either way, so a delivery outage can never be
 * distinguished from "no such identity" by an outside caller).
 */
export const productionUnconfiguredIdentityMessageSender: IdentityMessageSender = {
  async send() {
    throw new Error(
      'No identity message provider is configured for production. Beacon has no transactional ' +
        'email integration yet — wire one up and provide a real IdentityMessageSender before ' +
        'relying on AUTH_ADAPTER=identity in production.',
    );
  },
};

/**
 * The one place environment decides which adapter is used. Test files
 * mock this entire module (`vi.mock('@/lib/identity/messageSender', ...)`)
 * to inject a capturing adapter instead — see
 * `services/__mocks__/identityMessageSender.ts`.
 */
export function getIdentityMessageSender(): IdentityMessageSender {
  if (process.env.NODE_ENV === 'production') {
    return productionUnconfiguredIdentityMessageSender;
  }
  return consoleIdentityMessageSender;
}
