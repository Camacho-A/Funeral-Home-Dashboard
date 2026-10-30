/**
 * SOLIS sandbox (2026-10). A separate, protected Vercel project that runs
 * this app entirely on the in-repo fictional fixtures, so staff can click
 * through new features without any path to Production services.
 *
 * Enabled ONLY by `NEXT_PUBLIC_SOLIS_SANDBOX=true` — set in the sandbox
 * project and nowhere else. NEXT_PUBLIC so the browser half (the mock
 * store's persistence, the banner, the fixtures' sandbox examples) and the
 * server half read the same switch.
 *
 * Isolation is enforced, not assumed: a sandbox deployment must run mock
 * data with the real identity sign-in (over the fictional demo accounts —
 * the same sign-in, permissions and sessions Production uses) and must not
 * hold ANY live credential. If one is
 * present, `sandboxIsolationProblems()` names it, the server refuses to
 * start (instrumentation.ts) — fail closed, never "sandbox with a live key".
 */

export function isSandboxEnabled(): boolean {
  return process.env.NEXT_PUBLIC_SOLIS_SANDBOX === 'true';
}

/** Environment variables that would connect a process to a live service. */
const LIVE_CREDENTIAL_PATTERNS: readonly RegExp[] = [
  /^WIX_/,
  /^RESEND_API_KEY$/,
  /^TWILIO_/,
  /^MICROSOFT_/,
  /^GOOGLE_/,
  /^CLOVER_(?!MOCK_)/,
  /^TEST_CLOVER_/,
  /^BLOB_/,
  /^R2_/,
  /^JOTFORM_/,
  /^DATABASE_URL$/,
  /^SSN_ENCRYPTION_KEY$/,
  /^CALENDAR_TOKEN_ENCRYPTION_KEY$/,
];

/** Every reason this process is NOT a safely isolated sandbox (empty = isolated). */
export function sandboxIsolationProblems(env: Record<string, string | undefined> = process.env): string[] {
  const problems: string[] = [];
  if (env.NEXT_PUBLIC_SOLIS_SANDBOX !== 'true') problems.push('NEXT_PUBLIC_SOLIS_SANDBOX is not "true"');
  if ((env.DATA_ADAPTER ?? 'mock').trim().toLowerCase() !== 'mock') problems.push('DATA_ADAPTER must be "mock"');
  if ((env.AUTH_ADAPTER ?? '').trim().toLowerCase() !== 'identity') problems.push('AUTH_ADAPTER must be "identity"');
  for (const [name, value] of Object.entries(env)) {
    if (value && value.trim() !== '' && LIVE_CREDENTIAL_PATTERNS.some((pattern) => pattern.test(name))) {
      problems.push(`live credential ${name} must not be set`);
    }
  }
  return problems;
}

export function isSandboxIsolated(env: Record<string, string | undefined> = process.env): boolean {
  return sandboxIsolationProblems(env).length === 0;
}

/** Called once at server start when the sandbox switch is on. */
export function assertSandboxIsolation(env: Record<string, string | undefined> = process.env): void {
  const problems = sandboxIsolationProblems(env);
  if (problems.length > 0) {
    throw new Error(`SOLIS sandbox refused to start — it is not isolated: ${problems.join('; ')}.`);
  }
}
