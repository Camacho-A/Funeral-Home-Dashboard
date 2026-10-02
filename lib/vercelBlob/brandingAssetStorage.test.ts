import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockPut = vi.fn();
const mockDel = vi.fn();

vi.mock('@vercel/blob', () => ({
  put: (...args: unknown[]) => mockPut(...args),
  del: (...args: unknown[]) => mockDel(...args),
}));

const { uploadPublicBrandingAsset, deletePublicBrandingAsset } = await import('./brandingAssetStorage');
const { BrandingStorageNotConfiguredError } = await import('./vercelBlobConfig');

const ORIGINAL_DOCUMENT_STORE_ID = process.env.BLOB_STORE_ID;
const ORIGINAL_BRANDING_STORE_ID = process.env.BLOB_BRANDING_STORE_ID;

afterEach(() => {
  vi.clearAllMocks();
  if (ORIGINAL_DOCUMENT_STORE_ID === undefined) delete process.env.BLOB_STORE_ID;
  else process.env.BLOB_STORE_ID = ORIGINAL_DOCUMENT_STORE_ID;
  if (ORIGINAL_BRANDING_STORE_ID === undefined) delete process.env.BLOB_BRANDING_STORE_ID;
  else process.env.BLOB_BRANDING_STORE_ID = ORIGINAL_BRANDING_STORE_ID;
});

beforeEach(() => {
  mockPut.mockResolvedValue({ url: 'https://example-branding-store.public.blob.vercel-storage.com/branding/managed-cremations/logo-abc.png' });
});

/**
 * Production incident fix (2026-10), corrected to Vercel's current OIDC
 * architecture: "Vercel Blob: Cannot use public access on a private
 * store." — branding uploads were requesting `access: 'public'` while
 * authenticating against the SAME store case documents use (private). An
 * interim fix required a long-lived `BLOB_BRANDING_READ_WRITE_TOKEN`,
 * which is wrong for how Vercel now provisions a second connected store
 * (auto-injects `BLOB_BRANDING_STORE_ID`, authenticated via OIDC — no
 * token at all). These tests prove the corrected fix directly against
 * the Blob SDK call site: the branding store's own `storeId`, never the
 * document store's `BLOB_STORE_ID`, no `token` option passed at all, and
 * a clear failure (never a silent fallback) when the branding store id
 * isn't configured.
 */
describe('uploadPublicBrandingAsset — targets the branding store by storeId, never the document store', () => {
  it('calls put() with access: "public" and storeId set to BLOB_BRANDING_STORE_ID — no token option at all', async () => {
    process.env.BLOB_BRANDING_STORE_ID = 'store_branding_test_id';
    process.env.BLOB_STORE_ID = 'store_document_test_id';

    const result = await uploadPublicBrandingAsset('branding/managed-cremations/logo-abc.png', Buffer.from('fake bytes'), 'image/png');

    expect(result.url).toBe('https://example-branding-store.public.blob.vercel-storage.com/branding/managed-cremations/logo-abc.png');
    expect(mockPut).toHaveBeenCalledTimes(1);
    const [key, , options] = mockPut.mock.calls[0];
    expect(key).toBe('branding/managed-cremations/logo-abc.png');
    expect(options).toMatchObject({ access: 'public', contentType: 'image/png', storeId: 'store_branding_test_id' });
    // Never targets the document store, even though it's also configured.
    expect(options.storeId).not.toBe('store_document_test_id');
    // No static token of any kind — OIDC authenticates the specific storeId.
    expect(options.token).toBeUndefined();
  });

  it('throws BrandingStorageNotConfiguredError and never calls put() when the branding store id is unset', async () => {
    delete process.env.BLOB_BRANDING_STORE_ID;
    process.env.BLOB_STORE_ID = 'store_document_test_id'; // configured document store id must not be used as a fallback

    await expect(uploadPublicBrandingAsset('branding/managed-cremations/logo-abc.png', Buffer.from('x'), 'image/png')).rejects.toBeInstanceOf(
      BrandingStorageNotConfiguredError,
    );
    expect(mockPut).not.toHaveBeenCalled();
  });
});

describe('deletePublicBrandingAsset', () => {
  it('calls del() with the branding store id, no token', async () => {
    process.env.BLOB_BRANDING_STORE_ID = 'store_branding_test_id';
    await deletePublicBrandingAsset('https://example-branding-store.public.blob.vercel-storage.com/branding/x/logo.png');
    expect(mockDel).toHaveBeenCalledWith('https://example-branding-store.public.blob.vercel-storage.com/branding/x/logo.png', {
      storeId: 'store_branding_test_id',
    });
  });

  it('throws BrandingStorageNotConfiguredError and never calls del() when the branding store id is unset', async () => {
    delete process.env.BLOB_BRANDING_STORE_ID;
    await expect(deletePublicBrandingAsset('https://example.com/x.png')).rejects.toBeInstanceOf(BrandingStorageNotConfiguredError);
    expect(mockDel).not.toHaveBeenCalled();
  });
});
