import { put, get, del } from '@vercel/blob';
import type { DocumentStorageProvider } from '../documentStorageProvider';
import { getVercelBlobToken } from './vercelBlobConfig';

/**
 * Phase 25 (Document Generation & Template Management). The one real
 * `DocumentStorageProvider` implementation. Every blob is written with
 * `access: 'private'` — Vercel Blob's SDK (2.x) genuinely gates private
 * blobs behind the store's read-write token, unlike a "public" blob
 * (a long-lived, unguessable-suffix URL with no real access control).
 * `downloadFile` fetches the stream server-side and buffers it — the
 * Vercel Blob URL itself is never constructed for, or returned to, the
 * browser; only the download Route Handler ever calls this, after
 * re-checking authorization. See `lib/documentStorageProvider.ts`'s own
 * header comment for the full reasoning.
 */
export const vercelBlobStorageProvider: DocumentStorageProvider = {
  async uploadFile(key: string, contents: Buffer, contentType: string): Promise<{ storageKey: string }> {
    const token = getVercelBlobToken();
    const result = await put(key, contents, { access: 'private', contentType, token, addRandomSuffix: false });
    return { storageKey: result.pathname };
  },

  async downloadFile(storageKey: string): Promise<{ buffer: Buffer; contentType: string }> {
    const token = getVercelBlobToken();
    const result = await get(storageKey, { access: 'private', token });
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
    const token = getVercelBlobToken();
    await del(storageKey, { token });
  },
};
