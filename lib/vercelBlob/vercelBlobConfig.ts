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
 * Production incident fix (2026-10), corrected to the current Vercel Blob
 * OIDC architecture: branding assets were uploaded with `access: 'public'`
 * against the resolution above — but `resolveStaticBlobToken` (directly,
 * or via the ambient OIDC/`BLOB_STORE_ID` fallback it exists alongside)
 * always resolves to the SAME Vercel Blob store case documents use, and
 * that store is configured PRIVATE. Vercel correctly rejects a public-
 * access request against a private store ("Cannot use public access on a
 * private store"). An organization logo genuinely needs a public,
 * directly-fetchable URL (`Sidebar.tsx` already renders it as a plain
 * `<img src>`) — case documents genuinely need to stay private (per-
 * request authorization on every byte served, see
 * `lib/documentStorageProvider.ts`'s own header comment) — so these are
 * two access levels that cannot share one store. Vercel Blob has no
 * per-upload "make this store temporarily public" override; the fix is a
 * SECOND, separately-connected Blob store, configured public at
 * connection time.
 *
 * **First attempt at this fix required a `BLOB_BRANDING_READ_WRITE_TOKEN`
 * — wrong for how Vercel Blob now provisions a second store.** Connecting
 * a second store via the Vercel dashboard's Storage tab with Environment
 * Variable Prefix `BLOB_BRANDING` auto-injects `BLOB_BRANDING_STORE_ID`
 * (+ `BLOB_BRANDING_WEBHOOK_PUBLIC_KEY`), never a long-lived read/write
 * token — Vercel Blob now authenticates newly-connected stores via OIDC
 * by default. Confirmed directly against the installed
 * `@vercel/blob@2.6.1` type definitions (`BlobCommandOptions`,
 * `dist/create-folder-DAlHaCQ2.d.ts`): every mutating call (`put`/`del`/
 * etc.) accepts an optional `storeId`, documented as "Used to override
 * process.env.BLOB_STORE_ID when Vercel OIDC token is available" — this
 * is the real, typed, officially supported mechanism for targeting a
 * *specific* connected store under OIDC when more than one is connected
 * to the same project, not a guess. Passing `storeId` needs no `token` at
 * all: the SDK's own doc comment confirms `token` "is ignored when
 * Vercel OIDC token is available and either process.env.BLOB_STORE_ID or
 * options.storeId is set."
 *
 * So `resolveBrandingBlobStoreId()` below reads `BLOB_BRANDING_STORE_ID`
 * (Vercel's own auto-injected name for this second store — not invented
 * here) and `brandingAssetStorage.ts` passes it as `storeId` on every
 * call, authenticating via OIDC exactly like the private document store
 * already does for *its own* `BLOB_STORE_ID` — the two stores stay
 * fully distinct by `storeId` alone, no token of any kind required for
 * either. Deliberately no fallback to the document store's own ambient
 * `BLOB_STORE_ID` here — that would just reintroduce the original bug
 * (branding uploads landing in the private document store). Missing/
 * empty is therefore a hard configuration error, not a soft "unconfigured,
 * degrade gracefully" case.
 */
export class BrandingStorageNotConfiguredError extends Error {
  constructor() {
    super(
      'Organization branding storage is not configured: BLOB_BRANDING_STORE_ID is not set. ' +
        'Connect a separate, PUBLIC Vercel Blob store for branding assets in the Vercel dashboard (Storage tab, Environment Variable Prefix "BLOB_BRANDING") — see lib/vercelBlob/vercelBlobConfig.ts for why this must be a distinct store from case-document storage.',
    );
    this.name = 'BrandingStorageNotConfiguredError';
  }
}

export function resolveBrandingBlobStoreId(): string {
  const storeId = process.env.BLOB_BRANDING_STORE_ID;
  if (!storeId) {
    throw new BrandingStorageNotConfiguredError();
  }
  return storeId;
}
