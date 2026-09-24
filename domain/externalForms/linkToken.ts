/**
 * Manors Jotform integration (case-first architecture, 2026-09). Thin,
 * named wrapper around the existing, already-tested token primitive
 * (lib/identity/tokens.ts — the same mechanism signature-request and
 * email-verification/password-reset tokens already use) rather than a
 * new token scheme. The raw token is handed back exactly once, for the
 * caller to embed in a prefilled provider URL and then discard; only the
 * hash is ever persisted (CaseFormLink.linkTokenHash).
 */
import { generateToken, hashToken } from '@/lib/identity/tokens';

export type CaseFormLinkToken = { rawToken: string; linkTokenHash: string };

export function generateCaseFormLinkToken(): CaseFormLinkToken {
  const { token, tokenHash } = generateToken();
  return { rawToken: token, linkTokenHash: tokenHash };
}

export function hashCaseFormLinkToken(rawToken: string): string {
  return hashToken(rawToken);
}
