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
