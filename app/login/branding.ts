import { getDataAdapterMode, getLoginOrganizationId } from '@/lib/env';
import { resolveLoginOrganizationId } from '@/domain/organization/loginBranding';
import { listActiveOrganizations } from '@/services/organizationsService';
import { getBranding } from '@/services/organizationProvisioningService';

export type LoginOrganization = {
  /** The organization's display name, shown as real text on the card. */
  name: string;
  /** A public branding-asset URL (services/organizationProvisioningService.ts
      #uploadBrandingLogo stores logos as public blobs), so rendering it on an
      unauthenticated page exposes nothing that wasn't already public.
      Prefers the sign-in lockup — the asset that carries the company name —
      and falls back to the compact mark for an organization that has only
      uploaded one. Null when neither exists; the name alone then identifies
      the organization, so the card is never left blank. */
  logoUrl: string | null;
};

/**
 * The organization the sign-in screen is branded for, or null.
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
 * form. An organization with no logo uploaded is not a failure either —
 * its name is returned with a null `logoUrl`.
 */
export async function loadLoginOrganization(): Promise<LoginOrganization | null> {
  try {
    const dataAdapterMode = getDataAdapterMode();
    const organizations = await listActiveOrganizations(dataAdapterMode);
    const organizationId = resolveLoginOrganizationId({
      configuredOrganizationId: getLoginOrganizationId(),
      activeOrganizationIds: organizations.map((org) => org.id),
    });
    if (!organizationId) return null;

    const organization = organizations.find((org) => org.id === organizationId);
    const name = organization?.name?.trim();
    // A configured id naming an organization this deployment doesn't hold
    // leaves nothing to show — better blank than a logo with no owner.
    if (!name) return null;

    const branding = await getBranding(organizationId, dataAdapterMode);
    return { name, logoUrl: branding?.signInLogoUrl?.trim() || branding?.logoUrl?.trim() || null };
  } catch {
    // Branding is cosmetic; signing in is not.
    return null;
  }
}
