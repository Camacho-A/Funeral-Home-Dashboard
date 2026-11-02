import { getAuthAdapterMode, getDataAdapterMode, getLoginOrganizationId } from '@/lib/env';
import { GUS_ORGANIZATION_ID, GUS_ADMIN_EMAIL, GUS_DEMO_PASSWORD } from '@/services/__mocks__/gusFixtures';
import { MANORS_ADMIN_DEMO_PASSWORD } from '@/services/__mocks__/identityFixtures';
import { MOCK_LOGIN_EMAIL } from '@/services/__mocks__/authFixtures';
import { MANORS_ORGANIZATION_ID } from '@/domain/organization/organizationProfiles';

export type LoginDemoAccount = { email: string; password: string };

/**
 * Local-development sign-in hint for `AUTH_ADAPTER=identity` over
 * `DATA_ADAPTER=mock` (2026-10) — the identity system running against the
 * in-repo, fictional demo fixtures (see docs/LOCAL_DEVELOPMENT.md).
 *
 * Returns null — so nothing is shown — unless ALL of these hold:
 * - data is mock (these credentials exist only in the mock fixtures, and a
 *   deployment on real Wix data must never advertise any account);
 * - the login provider is the identity system (the `mock` provider shows
 *   its own, separate hint already);
 * - not a production build.
 *
 * The account follows the deployment's configured login organization: a
 * local Gus run (`LOGIN_ORGANIZATION_ID=gus-camacho-jr`) points at the Gus
 * demo administrator, Manors (or no login organization — the historical
 * local default) at Manors' demo administrator, and any other funeral home
 * at nothing: it never advertises another home's demo account (2026-11).
 */
export function loginDemoAccount(): LoginDemoAccount | null {
  try {
    if (process.env.NODE_ENV === 'production') return null;
    if (getDataAdapterMode() !== 'mock' || getAuthAdapterMode() !== 'identity') return null;
  } catch {
    return null;
  }

  const loginOrganizationId = getLoginOrganizationId();
  if (loginOrganizationId === GUS_ORGANIZATION_ID) {
    return { email: GUS_ADMIN_EMAIL, password: GUS_DEMO_PASSWORD };
  }
  if (!loginOrganizationId || loginOrganizationId === MANORS_ORGANIZATION_ID) {
    return { email: MOCK_LOGIN_EMAIL, password: MANORS_ADMIN_DEMO_PASSWORD };
  }
  return null;
}
