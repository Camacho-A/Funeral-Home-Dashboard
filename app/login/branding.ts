import { getDataAdapterMode, getLoginOrganizationId } from '@/lib/env';
import { resolveLoginOrganizationId } from '@/domain/organization/loginBranding';
import { listActiveOrganizations } from '@/services/organizationsService';
import { getBranding } from '@/services/organizationProvisioningService';

export type LoginLogo = {
  /** A public branding-asset URL (services/organizationProvisioningService.ts
      #uploadBrandingLogo stores logos as public blobs), so rendering it on an
      unauthenticated page exposes nothing that wasn't already public. */
  url: string;
  /** The organization's display name — the logo's alt text. */
  organizationName: string;
};

/**
 * The organization logo for the sign-in screen, or null.
 *
 * Kept out of app/login/page.tsx so that file stays what its own comment
 * promises: markup and a message lookup, with no data or auth logic.
 *
 * Server-side only — it reads `DATA_ADAPTER` and queries Wix directly,
 * neither of which exists in a browser bundle. Its single caller is the
 * Login Server Component. (No `server-only` import: this codebase has no
 * such dependency and relies on the same convention everywhere else in
 * `services/*`.)
 *
 * **Never throws.** A funeral home's staff must be able to sign in while
 * Wix is slow, misconfigured, or down — so every failure here degrades to
 * the SOLIS lockup alone rather than an error page in front of the login
 * form. The same reasoning applies to an organization with no logo
 * uploaded, which is simply the normal state and not an error.
 */
export async function loadLoginLogo(): Promise<LoginLogo | null> {
  try {
    const dataAdapterMode = getDataAdapterMode();
    const organizations = await listActiveOrganizations(dataAdapterMode);
    const organizationId = resolveLoginOrganizationId({
      configuredOrganizationId: getLoginOrganizationId(),
      activeOrganizationIds: organizations.map((org) => org.id),
    });
    if (!organizationId) return null;

    const branding = await getBranding(organizationId, dataAdapterMode);
    const url = branding?.logoUrl?.trim();
    if (!url) return null;

    const organization = organizations.find((org) => org.id === organizationId);
    return { url, organizationName: organization?.name ?? '' };
  } catch {
    // Branding is cosmetic; signing in is not.
    return null;
  }
}
