import { put, del } from '@vercel/blob';
import { resolveStaticBlobToken } from './vercelBlobConfig';

/**
 * Organization Branding Settings phase. A deliberately SEPARATE, smaller
 * counterpart to `vercelBlobStorageProvider.ts`'s `DocumentStorageProvider`
 * — not a second storage provider (same Vercel Blob account/credentials,
 * same `resolveStaticBlobToken` auth resolution), but a different ACCESS
 * MODE for a fundamentally different kind of asset. `DocumentStorageProvider`
 * is private-only by design (its own header comment: "the browser never
 * receives a Vercel Blob URL at all") because a case document needs
 * per-request authorization on every byte served. An organization's logo
 * is the opposite: `Sidebar.tsx` already renders it as a plain
 * `<img src={branding.logoUrl}>` — a public, directly-fetchable URL is
 * the correct shape, not a route-mediated private stream. Keeping this
 * in its own file (rather than overloading `DocumentStorageProvider`
 * with an access-mode parameter) keeps that interface's own "never a
 * URL" guarantee intact for every case-document caller.
 *
 * Stored under `branding/{organizationId}/...` — a distinct key prefix
 * from case documents' own `{organizationId}/{caseId}/...` convention,
 * so the two asset classes never collide and remain trivially
 * distinguishable by key alone.
 */
export async function uploadPublicBrandingAsset(key: string, contents: Buffer, contentType: string): Promise<{ url: string }> {
  const token = resolveStaticBlobToken();
  const result = await put(key, contents, {
    access: 'public',
    contentType,
    addRandomSuffix: true,
    ...(token ? { token } : {}),
  });
  return { url: result.url };
}

/**
 * Best-effort only — callers must confirm a URL is actually one of ours
 * (see `isOwnedBrandingBlobUrl` in `services/organizationProvisioningService.ts`)
 * before calling this; deleting an arbitrary external URL is never
 * attempted here or anywhere upstream of this function.
 */
export async function deletePublicBrandingAsset(url: string): Promise<void> {
  const token = resolveStaticBlobToken();
  await del(url, { ...(token ? { token } : {}) });
}
