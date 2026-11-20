import { describe, expect, it } from 'vitest';
import { assertGusDeploymentSafe, GUS_REQUIRED_ENV, gusDeploymentProblems, gusGuardApplies, isGusDeployment } from './gusDeployment';

/** Gus deployment preflight (2026-11). Fictional placeholder values only. */
const READY: Record<string, string> = {
  DATA_ADAPTER: 'wix',
  AUTH_ADAPTER: 'identity',
  DEPLOYMENT_ORGANIZATION_IDS: 'gus-camacho-jr',
  LOGIN_ORGANIZATION_ID: 'gus-camacho-jr',
  SESSION_JWT_SECRET: 'placeholder',
  MFA_ENCRYPTION_KEY: 'placeholder',
  CRON_SECRET: 'placeholder',
  WIX_SITE_ID: 'placeholder',
  WIX_API_KEY: 'placeholder',
  VERCEL_ENV: 'production',
};

describe('Gus deployment preflight', () => {
  it('a complete, Gus-only environment has no problems', () => {
    expect(gusDeploymentProblems(READY, { requireAll: true })).toEqual([]);
    expect(() => assertGusDeploymentSafe(READY)).not.toThrow();
  });

  it('the preflight names every missing required variable (gus-solis has none today)', () => {
    expect(gusDeploymentProblems({}, { requireAll: true })).toEqual(GUS_REQUIRED_ENV.map((n) => `${n} is not set`));
  });

  it('serves only Gus: another organization, a Manors-scoped login, or mock adapters are refused', () => {
    expect(gusDeploymentProblems({ ...READY, DEPLOYMENT_ORGANIZATION_IDS: 'gus-camacho-jr,managed-cremations' })).toEqual(['DEPLOYMENT_ORGANIZATION_IDS must be "gus-camacho-jr"']);
    expect(gusDeploymentProblems({ ...READY, LOGIN_ORGANIZATION_ID: 'managed-cremations' })).toEqual(['LOGIN_ORGANIZATION_ID must be "gus-camacho-jr"']);
    expect(gusDeploymentProblems({ ...READY, AUTH_ADAPTER: 'mock' })).toEqual(['AUTH_ADAPTER must be "identity"']);
  });

  it('every live channel, Manors-only key and unapproved switch is refused at start-up', () => {
    for (const name of [
      'RESEND_API_KEY', 'TWILIO_AUTH_TOKEN', 'MICROSOFT_CLIENT_SECRET', 'GOOGLE_CLIENT_SECRET', 'CALENDAR_TOKEN_ENCRYPTION_KEY', 'CLOVER_API_TOKEN',
      'JOTFORM_API_KEY', 'JOTFORM_API_KEY_GUS_CAMACHO_JR', 'CERTIFICATE_OF_CREMATION_TEMPLATE_STORAGE_KEY', 'MANATEE_DC_APPLICATION_TEMPLATE_PATH',
      'SSN_ENCRYPTION_KEY', 'NEXT_PUBLIC_SOLIS_SANDBOX', 'PLATFORM_ADMIN_USER_IDS', 'WIX_OAUTH_CLIENT_ID', 'SOLIS_FD_CREDENTIALS_STORAGE',
    ]) {
      const env = { ...READY, [name]: 'x' };
      expect(gusDeploymentProblems(env).join(), name).toContain(`${name} must not be set`);
      if (name !== 'NEXT_PUBLIC_SOLIS_SANDBOX') expect(() => assertGusDeploymentSafe(env), name).toThrow(/Gus deployment refused to start/);
    }
  });

  it('never echoes a value — only names', () => {
    const problems = gusDeploymentProblems({ ...READY, RESEND_API_KEY: 'super-secret-value' }).join(' ');
    expect(problems).not.toContain('super-secret-value');
  });

  it('applies to Gus Production or live data only — not Manors, the sandbox, local development or mock previews', () => {
    expect(gusGuardApplies(READY)).toBe(true);
    expect(gusGuardApplies({ ...READY, VERCEL_ENV: 'preview' })).toBe(true); // still live Wix data
    expect(gusGuardApplies({ DEPLOYMENT_ORGANIZATION_IDS: 'managed-cremations', DATA_ADAPTER: 'wix', VERCEL_ENV: 'production', RESEND_API_KEY: 'x' })).toBe(false);
    expect(gusGuardApplies({ DEPLOYMENT_ORGANIZATION_IDS: 'gus-camacho-jr', DATA_ADAPTER: 'mock', NEXT_PUBLIC_SOLIS_SANDBOX: 'true', VERCEL_ENV: 'production' })).toBe(false);
    expect(gusGuardApplies({ DEPLOYMENT_ORGANIZATION_IDS: 'gus-camacho-jr', DATA_ADAPTER: 'mock', VERCEL_ENV: 'preview' })).toBe(false);
    expect(gusGuardApplies({ DATA_ADAPTER: 'mock' })).toBe(false);
    expect(isGusDeployment({ DEPLOYMENT_ORGANIZATION_IDS: ' gus-camacho-jr ' })).toBe(true);
    // Manors Production with its live channels is untouched by the guard.
    expect(() => assertGusDeploymentSafe({ DEPLOYMENT_ORGANIZATION_IDS: 'managed-cremations', DATA_ADAPTER: 'wix', VERCEL_ENV: 'production', MICROSOFT_CLIENT_SECRET: 'x' })).not.toThrow();
  });
});
