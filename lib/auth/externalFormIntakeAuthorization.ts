import { getSessionSecret } from '../env';

/**
 * Automated Jotform intake (2026-10). A short-lived, signed assertion that
 * a verified first-call webhook delivery is authorized to create exactly
 * one case for exactly one organization.
 *
 * WHY THIS EXISTS
 *
 * `POST /api/cases` is the single canonical case-creation path, and every
 * other Jotform surface is structurally forbidden from duplicating it (see
 * domain/externalForms/criticalInvariants.test.ts). The historical-import
 * route reaches it by forwarding the staff caller's own session cookie — a
 * webhook has no cookie and no staff caller, so it needs a different way
 * to prove it is entitled to create a case.
 *
 * This token is that proof. It is minted ONLY inside the Jotform webhook,
 * and only after that request has already:
 *   1. resolved a trusted, enabled `ExternalFormConfig` from the form id
 *      (which is what determines the organization — never the payload), and
 *   2. passed `verifyJotformWebhook`, the shared-secret check.
 * So the token attests to a check that has already succeeded; it never
 * grants authority on its own, and nothing outside the webhook mints one.
 *
 * WHY IT IS NARROWER THAN A SESSION
 *
 * A forwarded staff cookie carries that staff member's full authority over
 * their organization. This token carries exactly one capability — "create a
 * case for organization X from submission Y" — expires in five minutes,
 * and is bound to the originating form and submission so a captured token
 * cannot be replayed for a different submission. It is strictly weaker
 * than the cookie the historical-import path already forwards.
 *
 * Keyed by HMAC-SHA256 off `getSessionSecret()` through its own derivation
 * context, exactly like `lib/auth/historicalCaseNumberAuthorization.ts` and
 * `lib/auth/mfaChallengeToken.ts` — no new long-lived secret, and
 * cryptographically distinct from every other token derived from the same
 * root, so one can never be replayed as another.
 */

const EXTERNAL_FORM_INTAKE_AUDIENCE = 'external_form_intake_case_creation';
const EXTERNAL_FORM_INTAKE_KEY_DERIVATION_CONTEXT = 'beacon-external-form-intake-v1';

/** Five minutes — minted and consumed within one webhook request, so this
    only has to survive a single internal round trip. */
const EXTERNAL_FORM_INTAKE_DURATION_SECONDS = 5 * 60;

export type ExternalFormIntakeAuthorizationPayload = {
  organizationId: string;
  /** The form whose config authorized this, so a token minted for one
      organization's form can never be presented as another's. */
  externalFormId: string;
  /** Binds the token to one submission — a captured token cannot be
      replayed to create a second case from a different delivery. */
  externalSubmissionId: string;
  /** The StaffProfile new cases are attributed to. Resolved server-side
      from the organization's own staff, never supplied by the webhook
      payload — see the webhook route's own comment. */
  intakeStaffProfileId: string;
  aud: string;
  issuedAt: number;
  expiresAt: number;
};

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(value: string): Uint8Array {
  const padLength = (4 - (value.length % 4)) % 4;
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat(padLength);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function importExternalFormIntakeHmacKey(): Promise<CryptoKey> {
  const rootKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(getSessionSecret()),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const derivedKeyMaterial = new Uint8Array(
    await crypto.subtle.sign('HMAC', rootKey, new TextEncoder().encode(EXTERNAL_FORM_INTAKE_KEY_DERIVATION_CONTEXT)),
  );
  return crypto.subtle.importKey('raw', derivedKeyMaterial, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

function isValidShape(value: unknown): value is ExternalFormIntakeAuthorizationPayload {
  if (!value || typeof value !== 'object') return false;
  const c = value as Partial<ExternalFormIntakeAuthorizationPayload>;
  return (
    typeof c.organizationId === 'string' &&
    typeof c.externalFormId === 'string' &&
    typeof c.externalSubmissionId === 'string' &&
    typeof c.intakeStaffProfileId === 'string' &&
    c.aud === EXTERNAL_FORM_INTAKE_AUDIENCE &&
    typeof c.issuedAt === 'number' &&
    typeof c.expiresAt === 'number'
  );
}

export async function createExternalFormIntakeAuthorization(
  params: {
    organizationId: string;
    externalFormId: string;
    externalSubmissionId: string;
    intakeStaffProfileId: string;
  },
  now: number = Math.floor(Date.now() / 1000),
): Promise<string> {
  const payload: ExternalFormIntakeAuthorizationPayload = {
    organizationId: params.organizationId,
    externalFormId: params.externalFormId,
    externalSubmissionId: params.externalSubmissionId,
    intakeStaffProfileId: params.intakeStaffProfileId,
    aud: EXTERNAL_FORM_INTAKE_AUDIENCE,
    issuedAt: now,
    expiresAt: now + EXTERNAL_FORM_INTAKE_DURATION_SECONDS,
  };
  const payloadPart = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const key = await importExternalFormIntakeHmacKey();
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payloadPart));
  return `${payloadPart}.${base64UrlEncode(new Uint8Array(signature))}`;
}

/**
 * Verifies signature, audience, and expiry only — the CALLER must still
 * match the decoded payload against its own trusted context before acting
 * on it (see `POST /api/cases`, which requires the payload's own
 * `organizationId` to equal the one it is about to create under). Returns
 * null for anything malformed, tampered, wrong-audience, or expired.
 * Never throws.
 */
export async function verifyExternalFormIntakeAuthorization(
  token: string,
  now: number = Math.floor(Date.now() / 1000),
): Promise<ExternalFormIntakeAuthorizationPayload | null> {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payloadPart, signaturePart] = parts;
  try {
    const key = await importExternalFormIntakeHmacKey();
    const ok = await crypto.subtle.verify(
      'HMAC',
      key,
      base64UrlDecode(signaturePart).buffer as ArrayBuffer,
      new TextEncoder().encode(payloadPart),
    );
    if (!ok) return null;
    const payload: unknown = JSON.parse(new TextDecoder().decode(base64UrlDecode(payloadPart)));
    if (!isValidShape(payload)) return null;
    if (payload.aud !== EXTERNAL_FORM_INTAKE_AUDIENCE) return null;
    if (payload.expiresAt < now) return null;
    return payload;
  } catch {
    return null;
  }
}
