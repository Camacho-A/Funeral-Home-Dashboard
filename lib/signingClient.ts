/**
 * Phase 26 (Electronic Signatures & Authorization Workflows). Client-side
 * fetch wrappers around the public, sessionless `/api/signing/[token]*`
 * routes — same `parseJsonOrThrow` shape as every other client wrapper in
 * this codebase, but deliberately never sends an `organizationId` or any
 * other identifier: the token in the URL is the only thing this surface
 * ever needs.
 */

export type SigningPageContext = {
  status: string;
  signerName: string;
  signerRole: string;
  expiresAt: string | null;
  documentFileName: string;
  documentTypeKey: string | null;
  decedentName: string;
  organizationName: string;
};

async function parseJsonOrThrow(response: Response): Promise<Record<string, unknown>> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof body.error === 'string' ? body.error : 'Something went wrong. Please try again.';
    throw new Error(message);
  }
  return body;
}

export async function fetchSigningPageContext(token: string): Promise<SigningPageContext> {
  const response = await fetch(`/api/signing/${encodeURIComponent(token)}`);
  return (await parseJsonOrThrow(response)) as unknown as SigningPageContext;
}

export function buildSigningDocumentUrl(token: string): string {
  return `/api/signing/${encodeURIComponent(token)}/document`;
}

export async function completeSigning(token: string, params: { signedName: string; initials?: string; consentAcknowledged: true }): Promise<{ status: string; signedAt: string }> {
  const response = await fetch(`/api/signing/${encodeURIComponent(token)}/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return (await parseJsonOrThrow(response)) as unknown as { status: string; signedAt: string };
}

export async function declineSigning(token: string, params: { reason?: string }): Promise<{ status: string }> {
  const response = await fetch(`/api/signing/${encodeURIComponent(token)}/decline`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return (await parseJsonOrThrow(response)) as unknown as { status: string };
}
