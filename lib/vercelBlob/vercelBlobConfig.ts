/**
 * Phase 25 (Document Generation & Template Management), updated 2026-09 for
 * Vercel Blob OIDC support. `BLOB_READ_WRITE_TOKEN` is now an OPTIONAL,
 * legacy/local-development credential, never required in production.
 *
 * Confirmed directly against the installed `@vercel/blob@2.6.1` source
 * (its own `resolveBlobAuth`, in `dist/chunk-*.cjs`): given no explicit
 * `token` option, the SDK automatically tries Vercel's short-lived OIDC
 * token (`VERCEL_OIDC_TOKEN`, injected per-invocation by the Vercel
 * Function runtime once a Blob store is connected to the project, paired
 * with `BLOB_STORE_ID`) before falling back to `BLOB_READ_WRITE_TOKEN`,
 * and only throws if none of those resolve. So this module's job is
 * narrowed to "read the legacy token if one happens to be set" — never
 * "require" it, and never independently guess whether OIDC will succeed
 * (that's `services/documentService.ts#checkBlobConnectivity`'s job, by
 * actually attempting a real upload, not by inspecting env vars).
 */
export function resolveStaticBlobToken(): string | undefined {
  return process.env.BLOB_READ_WRITE_TOKEN || undefined;
}

/**
 * Production incident fix (2026-10): branding assets were uploaded with
 * `access: 'public'` against the resolution above — but `resolveStaticBlobToken`
 * (directly, or via the ambient OIDC/`BLOB_STORE_ID` fallback it exists
 * alongside) always resolves to the SAME Vercel Blob store case documents
 * use, and that store is configured PRIVATE. Vercel correctly rejects a
 * public-access request against a private store
 * ("Cannot use public access on a private store"). An organization logo
 * genuinely needs a public, directly-fetchable URL (`Sidebar.tsx` already
 * renders it as a plain `<img src>`) — case documents genuinely need to
 * stay private (per-request authorization on every byte served, see
 * `lib/documentStorageProvider.ts`'s own header comment) — so these are
 * two access levels that cannot share one store. Vercel Blob has no
 * per-upload "make this store temporarily public" override; the fix is a
 * SECOND, separately-connected Blob store, configured public at
 * connection time, with its own distinct token.
 *
 * `BLOB_BRANDING_READ_WRITE_TOKEN` is that second store's token —
 * connected via the Vercel dashboard's Storage tab with a custom
 * Environment Variable Prefix (`BLOB_BRANDING`, the standard supported
 * mechanism for binding more than one Blob store to one project; Vercel
 * auto-injects `{PREFIX}_READ_WRITE_TOKEN` once connected). Deliberately
 * no OIDC/ambient fallback here, unlike `resolveStaticBlobToken` above —
 * OIDC's ambient resolution is tied to whichever store Vercel treats as
 * this project's default, which is the already-connected PRIVATE
 * document store; silently falling back to it would just reintroduce
 * this exact bug. Missing/empty is therefore a hard configuration error,
 * not a soft "unconfigured, degrade gracefully" case (unlike
 * `resolveStaticBlobToken`, which a mock/local/not-yet-provisioned
 * environment is allowed to leave unset).
 */
export class BrandingStorageNotConfiguredError extends Error {
  constructor() {
    super(
      'Organization branding storage is not configured: BLOB_BRANDING_READ_WRITE_TOKEN is not set. ' +
        'Connect a separate, PUBLIC Vercel Blob store for branding assets in the Vercel dashboard and set this environment variable — see lib/vercelBlob/vercelBlobConfig.ts for why this must be a distinct store from case-document storage.',
    );
    this.name = 'BrandingStorageNotConfiguredError';
  }
}

export function resolveBrandingBlobToken(): string {
  const token = process.env.BLOB_BRANDING_READ_WRITE_TOKEN;
  if (!token) {
    throw new BrandingStorageNotConfiguredError();
  }
  return token;
}
