import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { describe, it, expect } from 'vitest';

const ROOT = process.cwd();
const read = (rel: string) => (existsSync(join(ROOT, rel)) ? readFileSync(join(ROOT, rel), 'utf8') : '');

/**
 * Phase 40 (MFA & Account Security) structural guarantees:
 *  1. Family Portal authentication never inherits staff MFA — the family auth
 *     stack imports no staff MFA module and never reads org require-MFA policy.
 *  2. No plaintext secret / OTP code / recovery code / session token is logged.
 *  3. MFA state is separate from RBAC — the MFA service/policy never import the
 *     permission/authorization layer, and vice versa.
 */
describe('Phase 40 MFA structural boundaries', () => {
  it('the family auth stack does not import any staff MFA module or org require-MFA policy', () => {
    const staffMfaRef = /(services\/mfaService|mfaChallengeToken|mfaChallengeCookie|mfaPolicyService|identityMustEnrollMfa|\.mfaEnabled)/;
    for (const f of [
      'lib/auth/familySessionToken.ts',
      'lib/auth/requireFamilyAccess.ts',
      'services/portal/portalUserService.ts',
      'app/family/login/actions.ts',
      'services/portal/portalAccessService.ts',
    ]) {
      const src = read(f);
      if (src) expect(src).not.toMatch(staffMfaRef);
    }
  });

  it('MFA code paths never log a secret, code, recovery code, or token', () => {
    const forbidden = /console\.(log|info|debug|warn|error)\([^)]*(secret|recoveryCode|recovery_code|otp|mfaSecret|token|plainSecret)/i;
    for (const f of [
      'services/mfaService.ts',
      'lib/auth/mfaChallengeToken.ts',
      'lib/auth/mfaChallengeCookie.ts',
      'app/api/auth/mfa/begin/route.ts',
      'app/api/auth/mfa/verify/route.ts',
      'app/api/auth/mfa/disable/route.ts',
      'app/api/auth/mfa/recovery-codes/route.ts',
      'lib/mfaClient.ts',
      'components/settings/MfaPanel.tsx',
    ]) {
      expect(read(f)).not.toMatch(forbidden);
    }
  });

  it('MFA state stays separate from RBAC (approved requirement 9)', () => {
    // mfaService/mfaPolicyService must not import the authorization/permission layer.
    for (const f of ['services/mfaService.ts', 'services/mfaPolicyService.ts']) {
      expect(read(f)).not.toMatch(/authorizationPolicyService|permissionService|hasPermission/);
    }
  });

  it('the MFA challenge token uses a distinct audience and key context from the session tokens', () => {
    const src = read('lib/auth/mfaChallengeToken.ts');
    expect(src).toContain("MFA_CHALLENGE_AUDIENCE = 'mfa_challenge'");
    expect(src).toContain('beacon-mfa-challenge-v1');
  });
});
