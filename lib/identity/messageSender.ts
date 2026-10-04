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
import { getAppBaseUrl } from '../env';
import { sendResendEmail, isResendConfigured } from '../email/resendClient';

export type IdentityMessage =
  | { kind: 'password_reset'; to: string; token: string }
  | { kind: 'email_verification'; to: string; token: string }
  | { kind: 'invitation'; to: string; token: string; organizationId: string; membershipId: string; organizationName: string }
  | { kind: 'mfa_recovery_codes'; to: string; codes: string[] }
  /** Phase 26 (Electronic Signatures & Authorization Workflows). Reached
      only through `lib/signatureNotifier.ts`'s `SignatureNotifier`
      interface — `services/signatureService.ts` never imports this
      module directly (see that interface's own header comment). */
  | { kind: 'signature_request'; to: string; signerName: string; caseDisplayName: string; signLink: string; expiresAt: string | null }
  | { kind: 'signature_completed'; to: string; signerName: string; caseDisplayName: string }
  | { kind: 'signature_declined'; to: string; signerName: string; caseDisplayName: string; reason: string | null }
  | { kind: 'signature_cancelled'; to: string; signerName: string; caseDisplayName: string }
  /** Phase 29 (Family Portal & External Collaboration). Reached only via
      `getIdentityMessageSender()` directly from the staff-side invitation
      Route Handler — mirrors `'invitation'`'s own shape exactly, but for a
      `PortalInvitation`/`PortalAccess` pair rather than a `Membership`.
      `services/portal/portalInvitationService.ts` returns the raw token
      internally (never in a JSON response body, same rule as every other
      token kind here) — the route is responsible for calling `.send()`. */
  | { kind: 'portal_invitation'; to: string; token: string; organizationId: string; caseId: string; invitationId: string };

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
      'No identity message provider is configured for production. Solis has no transactional ' +
        'email integration yet — wire one up and provide a real IdentityMessageSender before ' +
        'relying on AUTH_ADAPTER=identity in production.',
    );
  },
};

/** Renders one `IdentityMessage` variant into a subject/html/text triple.
    Every link built here uses `getAppBaseUrl()` + the exact path each
    target page already expects (confirmed against
    `app/reset-password/actions.ts`, `app/verify-email/actions.ts`,
    `app/accept-invitation/actions.ts`, `app/family/accept-invitation/page.tsx`
    — never invented). `signature_*` kinds already carry a pre-built
    `signLink` (from `services/signatureService.ts#buildSigningLink`), so
    this function never constructs a signing URL itself. */
function formatIdentityMessage(message: IdentityMessage): { subject: string; html: string; text: string } {
  const base = getAppBaseUrl();
  switch (message.kind) {
    case 'password_reset': {
      const link = `${base}/reset-password?token=${encodeURIComponent(message.token)}`;
      return {
        subject: 'Reset your Solis password',
        html: `<p>Click the link below to reset your password.</p><p><a href="${link}">${link}</a></p>`,
        text: `Reset your password: ${link}`,
      };
    }
    case 'email_verification': {
      const link = `${base}/verify-email?token=${encodeURIComponent(message.token)}`;
      return {
        subject: 'Verify your Solis email address',
        html: `<p>Click the link below to verify your email address.</p><p><a href="${link}">${link}</a></p>`,
        text: `Verify your email: ${link}`,
      };
    }
    case 'invitation': {
      // Staff invitation email copy (2026-10). Sent for BOTH a fresh
      // invite and a Resend (app/api/auth/invitations/route.ts's POST and
      // PATCH handlers both construct this exact same message kind) — by
      // design there is no separate "resend" copy; a resent invitation
      // must read as a normal, legitimate invitation, never a second
      // notice. `Identity` has no dedicated first-name field (see
      // components/dashboard/PageGreetingHeader.tsx's own comment on this
      // same gap) — only `displayName`, a full name typed by whoever sent
      // the invitation, not the invitee themselves — so this always uses
      // a plain "Hello," greeting rather than guessing a first name from
      // it.
      const link = `${base}/accept-invitation?token=${encodeURIComponent(message.token)}&membershipId=${encodeURIComponent(message.membershipId)}`;
      return {
        subject: `You've been invited to join ${message.organizationName} on SOLIS`,
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1f2328; max-width: 480px; margin: 0 auto;">
            <p style="font-size: 13px; font-weight: 700; letter-spacing: 0.08em; color: #6b7280; margin: 0 0 24px;">SOLIS</p>
            <p style="margin: 0 0 16px;">Hello,</p>
            <p style="margin: 0 0 24px; line-height: 1.5;">${message.organizationName} has invited you to join their team on SOLIS, the system used to manage cases and day-to-day operations.</p>
            <p style="margin: 0 0 24px; line-height: 1.5;">Use the button below to set up your account and access your workspace.</p>
            <p style="margin: 0 0 24px;"><a href="${link}" style="display: inline-block; background-color: #111827; color: #ffffff; text-decoration: none; padding: 12px 24px; border-radius: 6px; font-weight: 600;">Accept Invitation</a></p>
            <p style="margin: 0 0 24px; font-size: 13px; color: #6b7280; line-height: 1.5;">This invitation was sent to ${message.to}. If you weren't expecting this invitation, you can ignore this email.</p>
            <p style="margin: 24px 0 0; font-size: 12px; color: #9ca3af;">SOLIS<br>Case Management</p>
          </div>
        `.trim(),
        text: `Hello,\n\n${message.organizationName} has invited you to join their team on SOLIS, the system used to manage cases and day-to-day operations.\n\nAccept your invitation: ${link}\n\nThis invitation was sent to ${message.to}. If you weren't expecting this invitation, you can ignore this email.\n\nSOLIS\nCase Management`,
      };
    }
    case 'mfa_recovery_codes': {
      return {
        subject: 'Your Solis MFA recovery codes',
        html: `<p>Store these recovery codes somewhere safe — each can be used once if you lose access to your authenticator.</p><ul>${message.codes.map((c) => `<li>${c}</li>`).join('')}</ul>`,
        text: `Your MFA recovery codes:\n${message.codes.join('\n')}`,
      };
    }
    case 'signature_request': {
      const expiryLine = message.expiresAt ? ` This link expires ${message.expiresAt}.` : '';
      return {
        subject: `Signature requested — ${message.caseDisplayName}`,
        html: `<p>Hi ${message.signerName}, please review and sign the document for ${message.caseDisplayName}.${expiryLine}</p><p><a href="${message.signLink}">${message.signLink}</a></p>`,
        text: `Please sign: ${message.signLink}${expiryLine}`,
      };
    }
    case 'signature_completed':
      return {
        subject: `Document signed — ${message.caseDisplayName}`,
        html: `<p>${message.signerName} has signed the document for ${message.caseDisplayName}.</p>`,
        text: `${message.signerName} has signed the document for ${message.caseDisplayName}.`,
      };
    case 'signature_declined':
      return {
        subject: `Signature declined — ${message.caseDisplayName}`,
        html: `<p>${message.signerName} declined to sign the document for ${message.caseDisplayName}.${message.reason ? ` Reason: ${message.reason}` : ''}</p>`,
        text: `${message.signerName} declined to sign for ${message.caseDisplayName}.${message.reason ? ` Reason: ${message.reason}` : ''}`,
      };
    case 'signature_cancelled':
      return {
        subject: `Signature request cancelled — ${message.caseDisplayName}`,
        html: `<p>The signature request for ${message.caseDisplayName} sent to ${message.signerName} was cancelled.</p>`,
        text: `The signature request for ${message.caseDisplayName} sent to ${message.signerName} was cancelled.`,
      };
    case 'portal_invitation': {
      const link = `${base}/family/accept-invitation?token=${encodeURIComponent(message.token)}`;
      return {
        subject: "You've been invited to the Solis family portal",
        html: `<p>Click the link below to accept your invitation and view case updates.</p><p><a href="${link}">${link}</a></p>`,
        text: `Accept your invitation: ${link}`,
      };
    }
  }
}

/**
 * The real, production-capable adapter — sends via `lib/email/resendClient.ts`,
 * the same underlying Resend client `services/notifications/emailChannel.ts`'s
 * `resendEmailProvider` also uses (one provider integration, two thin
 * adapters — see that file's own comment).
 */
export const resendIdentityMessageSender: IdentityMessageSender = {
  async send(message) {
    const { subject, html, text } = formatIdentityMessage(message);
    await sendResendEmail({ to: message.to, subject, html, text });
  },
};

/**
 * The one place environment decides which adapter is used. Test files
 * mock this entire module (`vi.mock('@/lib/identity/messageSender', ...)`)
 * to inject a capturing adapter instead — see
 * `services/__mocks__/identityMessageSender.ts`.
 *
 * Phase 33 (Real Notification Delivery): `resendIdentityMessageSender` is
 * selected whenever `RESEND_API_KEY` is set, regardless of `NODE_ENV` —
 * a developer can opt into real sending locally too (matching Clover's
 * own sandbox-flag posture: an env var, not a hardcoded environment
 * check, decides). Falls back to the original console/throw pair when
 * it's unset — production with no key configured still fails loudly
 * rather than silently pretending to send.
 */
export function getIdentityMessageSender(): IdentityMessageSender {
  if (isResendConfigured()) {
    return resendIdentityMessageSender;
  }
  if (process.env.NODE_ENV === 'production') {
    return productionUnconfiguredIdentityMessageSender;
  }
  return consoleIdentityMessageSender;
}
