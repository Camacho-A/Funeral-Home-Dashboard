import { put, del } from '@vercel/blob';
import { resolveBrandingBlobStoreId } from './vercelBlobConfig';

/**
 * Organization Branding Settings phase; corrected in the production
 * storage-configuration fix (2026-10, then again to use OIDC/`storeId`
 * instead of a long-lived token). A deliberately SEPARATE, smaller
 * counterpart to `vercelBlobStorageProvider.ts`'s `DocumentStorageProvider`
 * — and a genuinely separate Vercel Blob STORE too, not just a different
 * access-mode call on the same one. `DocumentStorageProvider` is
 * private-only by design (its own header comment: "the browser never
 * receives a Vercel Blob URL at all") because a case document needs
 * per-request authorization on every byte served. An organization's logo
 * is the opposite: `Sidebar.tsx` already renders it as a plain
 * `<img src={branding.logoUrl}>` — a public, directly-fetchable URL is
 * the correct shape, not a route-mediated private stream. Vercel Blob has
 * no per-upload access override — a store is public or private at
 * connection time — so "public logo, private documents" requires two
 * stores. Each is targeted by its own `storeId` under Vercel OIDC — never
 * a static token — exactly mirroring how the private document store is
 * already authenticated via its own ambient `BLOB_STORE_ID`
 * (`resolveBrandingBlobStoreId` here vs. `resolveStaticBlobToken` in
 * `vercelBlobStorageProvider.ts`; see that function's own comment for
 * the full incident writeup and the `storeId` option's confirmed SDK
 * support). Keeping this in its own file also keeps
 * `DocumentStorageProvider`'s own "never a URL" guarantee intact for
 * every case-document caller.
 *
 * Stored under `branding/{organizationId}/...` — a distinct key prefix
 * from case documents' own `{organizationId}/{caseId}/...` convention,
 * so the two asset classes never collide and remain trivially
 * distinguishable by key alone (on top of now living in entirely
 * separate stores).
 */
export async function uploadPublicBrandingAsset(key: string, contents: Buffer, contentType: string): Promise<{ url: string }> {
  const storeId = resolveBrandingBlobStoreId();
  const result = await put(key, contents, { access: 'public', contentType, addRandomSuffix: true, storeId });
  return { url: result.url };
}

/**
 * Best-effort only — callers must confirm a URL is actually one of ours
 * (see `isOwnedBrandingBlobUrl` in `services/organizationProvisioningService.ts`)
 * before calling this; deleting an arbitrary external URL is never
 * attempted here or anywhere upstream of this function.
 */
export async function deletePublicBrandingAsset(url: string): Promise<void> {
  const storeId = resolveBrandingBlobStoreId();
  await del(url, { storeId });
}
