import { createClient, OAuthStrategy } from '@wix/sdk';
import { members } from '@wix/members';
import type { AuthenticatedUser } from '../../types/auth';
import { getWixOAuthClientId } from '../env';

export type WixLoginResult =
  | { success: true; user: AuthenticatedUser }
  | {
      success: false;
      reason: 'invalid_credentials' | 'email_verification_required' | 'owner_approval_required' | 'unknown';
    };

/**
 * Real Wix member login via the custom-login-page flow (`auth.login()` +
 * `getMemberTokensForDirectLogin()`) — chosen over the Wix-hosted-redirect
 * flow specifically because it does not require the Wix site connected to
 * Beacon Development to be published (see docs/AUTHENTICATION.md's "Wix
 * dashboard setup" section, which flags the redirect flow's publish
 * requirement as a decision needing your approval, not something assumed).
 *
 * UNTESTED against a live Wix project: no real WIX_OAUTH_CLIENT_ID exists
 * yet (creating the OAuth app requires your approval), and the Wix MCP
 * tools available to Claude in this session cannot exercise a live OAuth
 * flow either (see the phase report's "Known limitations"). Written and
 * typechecked against @wix/sdk's and @wix/members's own type declarations
 * — verify this end-to-end yourself once a real OAuth app exists.
 *
 * Real Wix access/refresh tokens are used here only long enough to call
 * `members.getCurrentMember()` and are then discarded — not persisted
 * anywhere (not the session cookie, not any other storage). A real Wix
 * member's login today only proves who they are at that moment; nothing
 * yet lets Beacon make further Wix API calls on their behalf afterward —
 * that's explicitly deferred (see docs/AUTHENTICATION.md's known
 * limitations, and ADR-007's note that no service calls Wix yet either).
 */
export async function loginWithWix(email: string, password: string): Promise<WixLoginResult> {
  const clientId = getWixOAuthClientId();

  const client = createClient({
    modules: { members },
    auth: OAuthStrategy({ clientId }),
  });

  const response = await client.auth.login({ email, password });

  if (response.loginState !== 'SUCCESS') {
    if (response.loginState === 'EMAIL_VERIFICATION_REQUIRED') {
      return { success: false, reason: 'email_verification_required' };
    }
    if (response.loginState === 'OWNER_APPROVAL_REQUIRED') {
      return { success: false, reason: 'owner_approval_required' };
    }
    // FAILURE (invalidEmail/invalidPassword/resetPassword/emailAlreadyExists)
    // and the captcha-required states all collapse to one generic reason —
    // "do not reveal whether a private account exists through overly
    // specific error messages" applies here exactly as it does to the mock
    // path (lib/auth/mockAuth.ts).
    return { success: false, reason: 'invalid_credentials' };
  }

  if (!('data' in response) || !response.data?.sessionToken) {
    return { success: false, reason: 'unknown' };
  }

  const tokens = await client.auth.getMemberTokensForDirectLogin(response.data.sessionToken);
  client.auth.setTokens(tokens);

  const { member } = await client.members.getCurrentMember();

  if (!member?._id || !member.loginEmail) {
    return { success: false, reason: 'unknown' };
  }

  return {
    success: true,
    user: {
      id: member._id,
      email: member.loginEmail,
      displayName: member.profile?.nickname || member.contact?.firstName || member.loginEmail,
      source: 'wix',
    },
  };
}
