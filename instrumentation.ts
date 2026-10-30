/**
 * Next.js server start hook. SOLIS sandbox (2026-10): a deployment with the
 * sandbox switch on refuses to start unless it is fully isolated — mock
 * data, mock sign-in and no live credential of any kind (lib/sandbox.ts).
 * Every other deployment is unaffected.
 */
export async function register(): Promise<void> {
  const { isSandboxEnabled, assertSandboxIsolation } = await import('./lib/sandbox');
  if (isSandboxEnabled()) assertSandboxIsolation();
}
