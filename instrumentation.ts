/**
 * Next.js server start hook. SOLIS sandbox (2026-10): a deployment with the
 * sandbox switch on refuses to start unless it is fully isolated — mock
 * data, mock sign-in and no live credential of any kind (lib/sandbox.ts).
 * Gus (2026-11): a deployment serving gus-camacho-jr refuses to start
 * with any live channel, Manors-only key or unapproved switch set, or with
 * the wrong adapters or organization (lib/gusDeployment.ts).
 * Every other deployment is unaffected.
 */
export async function register(): Promise<void> {
  const { isSandboxEnabled, assertSandboxIsolation } = await import('./lib/sandbox');
  if (isSandboxEnabled()) assertSandboxIsolation();
  const { assertGusDeploymentSafe } = await import('./lib/gusDeployment');
  assertGusDeploymentSafe();
}
