import { put, get, del } from '@vercel/blob';
import type { DocumentStorageProvider } from '../documentStorageProvider';
import { resolveStaticBlobToken } from './vercelBlobConfig';

/**
 * Phase 25 (Document Generation & Template Management), updated 2026-09
 * for Vercel Blob OIDC support. Every blob is written with
 * `access: 'private'` — Vercel Blob's SDK (2.x) genuinely gates private
 * blobs behind real credentials, unlike a "public" blob (a long-lived,
 * unguessable-suffix URL with no real access control). `downloadFile`
 * fetches the stream server-side and buffers it — the Vercel Blob URL
 * itself is never constructed for, or returned to, the browser; only the
 * download Route Handler ever calls this, after re-checking authorization.
 * See `lib/documentStorageProvider.ts`'s own header comment for the full
 * reasoning.
 *
 * Authentication: a `token` option is only ever passed when
 * `BLOB_READ_WRITE_TOKEN` happens to be set (local development, or a
 * legacy deployment). In production, `token` is omitted entirely — the
 * installed `@vercel/blob` SDK's own auth resolution then automatically
 * uses Vercel's short-lived OIDC token for the connected Blob store, no
 * static secret required. See `vercelBlobConfig.ts`'s own header comment
 * for the confirmed resolution order this relies on.
 */
function blobAuthOptions(): { token: string } | Record<string, never> {
  const token = resolveStaticBlobToken();
  return token ? { token } : {};
}

export const vercelBlobStorageProvider: DocumentStorageProvider = {
  async uploadFile(key: string, contents: Buffer, contentType: string): Promise<{ storageKey: string }> {
    const result = await put(key, contents, { access: 'private', contentType, addRandomSuffix: false, ...blobAuthOptions() });
    return { storageKey: result.pathname };
  },

  async downloadFile(storageKey: string): Promise<{ buffer: Buffer; contentType: string }> {
    const result = await get(storageKey, { access: 'private', ...blobAuthOptions() });
    if (!result || result.statusCode !== 200) {
      throw new Error(`Document storage: no blob found for storage key "${storageKey}".`);
    }
    const chunks: Uint8Array[] = [];
    const reader = result.stream.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) chunks.push(value);
    }
    return { buffer: Buffer.concat(chunks), contentType: result.blob.contentType };
  },

  async deleteFile(storageKey: string): Promise<void> {
    await del(storageKey, { ...blobAuthOptions() });
  },
};
