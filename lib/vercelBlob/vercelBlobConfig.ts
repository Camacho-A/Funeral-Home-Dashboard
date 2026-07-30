/**
 * Phase 25 (Document Generation & Template Management). Resolves the one
 * env var Vercel Blob's SDK needs (`BLOB_READ_WRITE_TOKEN`) — matching
 * `lib/clover/cloverConfig.ts`'s exact "fail clearly, name the missing
 * variable, never leak the value" convention. Unlike Clover's per-
 * organization credential references, this is a single, app-wide token
 * (Vercel Blob has no per-tenant store concept in this project's usage),
 * so there is nothing to resolve per organization — just presence.
 */

export function isVercelBlobConfigured(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

export function getVercelBlobToken(): string {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    throw new Error(
      'Document storage is not configured: BLOB_READ_WRITE_TOKEN is not set. ' +
        'Provision a Vercel Blob store and set this env var (server-only) before generating, uploading, or downloading documents.',
    );
  }
  return token;
}
