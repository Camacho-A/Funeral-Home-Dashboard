/**
 * Phase 20 (Organization Onboarding & Tenant Provisioning). Organization-
 * scoped branding, seeded/edited during onboarding's "Branding" step.
 *
 * `logoUrl` is a plain URL string — the phase's own instruction ("Do not
 * store binary logo data directly in Wix rows") is enforced structurally:
 * this type has no field capable of holding binary/base64 image data at
 * all, only a reference to wherever the actual file is hosted (an object-
 * storage URL, in the same "eventually the Postgres/object-storage
 * service, not Wix Data" category `types/document.ts` already documents
 * for case document files). No upload endpoint is built in this phase —
 * see ADR-024's "Deferred" section.
 */
export type OrganizationBranding = {
  organizationId: string;
  /** The compact mark, rendered small (the Sidebar's 30px footer slot). */
  logoUrl: string | null;
  /** The full lockup for the sign-in screen (2026-10) — a separate asset
      because the two slots have opposite needs: a wide wordmark is an
      unreadable smudge at 30px, and a bare mark says nothing on a login
      card where the organization's NAME is the point. Null falls back to
      `logoUrl`, so an organization that has only ever uploaded one logo
      still gets branding on sign-in. */
  signInLogoUrl: string | null;
  primaryColor: string | null;
  secondaryColor: string | null;
  accentColor: string | null;
  emailFromName: string | null;
  documentFooter: string | null;
  createdAt: string;
  updatedAt: string;
};
