/**
 * Phase 21 (Identity, Authentication & Session Management). The one place
 * an email is normalized for uniqueness/lookup purposes — every
 * `Identity` lookup goes through this, never a raw `.toLowerCase()` at
 * the call site, so normalization can never drift between two call
 * sites.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Shape-only check (not a deliverability check) — reused by
    IdentityService before ever normalizing/storing an email. */
export function isValidEmailShape(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}
