import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockPut = vi.fn();
const mockDel = vi.fn();

vi.mock('@vercel/blob', () => ({
  put: (...args: unknown[]) => mockPut(...args),
  del: (...args: unknown[]) => mockDel(...args),
}));

const { uploadPublicBrandingAsset, deletePublicBrandingAsset } = await import('./brandingAssetStorage');
const { BrandingStorageNotConfiguredError } = await import('./vercelBlobConfig');

const ORIGINAL_DOCUMENT_TOKEN = process.env.BLOB_READ_WRITE_TOKEN;
const ORIGINAL_BRANDING_TOKEN = process.env.BLOB_BRANDING_READ_WRITE_TOKEN;

afterEach(() => {
  vi.clearAllMocks();
  if (ORIGINAL_DOCUMENT_TOKEN === undefined) delete process.env.BLOB_READ_WRITE_TOKEN;
  else process.env.BLOB_READ_WRITE_TOKEN = ORIGINAL_DOCUMENT_TOKEN;
  if (ORIGINAL_BRANDING_TOKEN === undefined) delete process.env.BLOB_BRANDING_READ_WRITE_TOKEN;
  else process.env.BLOB_BRANDING_READ_WRITE_TOKEN = ORIGINAL_BRANDING_TOKEN;
});

beforeEach(() => {
  mockPut.mockResolvedValue({ url: 'https://example-branding-store.public.blob.vercel-storage.com/branding/managed-cremations/logo-abc.png' });
});

/**
 * Production incident fix (2026-10): "Vercel Blob: Cannot use public
 * access on a private store." — branding uploads were requesting
 * `access: 'public'` while authenticating against the SAME store case
 * documents use (private). These tests prove the fix directly against
 * the Blob SDK call site: the branding store's own token, never the
 * document store's, and a clear failure (never a silent fallback) when
 * the branding token isn't configured.
 */
describe('uploadPublicBrandingAsset — uses the branding store, never the document store', () => {
  it('calls put() with access: "public" and the BLOB_BRANDING_READ_WRITE_TOKEN value', async () => {
    process.env.BLOB_BRANDING_READ_WRITE_TOKEN = 'vercel_blob_rw_branding_token';
    process.env.BLOB_READ_WRITE_TOKEN = 'vercel_blob_rw_document_token';

    const result = await uploadPublicBrandingAsset('branding/managed-cremations/logo-abc.png', Buffer.from('fake bytes'), 'image/png');

    expect(result.url).toBe('https://example-branding-store.public.blob.vercel-storage.com/branding/managed-cremations/logo-abc.png');
    expect(mockPut).toHaveBeenCalledTimes(1);
    const [key, , options] = mockPut.mock.calls[0];
    expect(key).toBe('branding/managed-cremations/logo-abc.png');
    expect(options).toMatchObject({ access: 'public', contentType: 'image/png', token: 'vercel_blob_rw_branding_token' });
    // Never the document token, even though it's also configured.
    expect(options.token).not.toBe('vercel_blob_rw_document_token');
  });

  it('throws BrandingStorageNotConfiguredError and never calls put() when the branding token is unset', async () => {
    delete process.env.BLOB_BRANDING_READ_WRITE_TOKEN;
    process.env.BLOB_READ_WRITE_TOKEN = 'vercel_blob_rw_document_token'; // configured document token must not be used as a fallback

    await expect(uploadPublicBrandingAsset('branding/managed-cremations/logo-abc.png', Buffer.from('x'), 'image/png')).rejects.toBeInstanceOf(
      BrandingStorageNotConfiguredError,
    );
    expect(mockPut).not.toHaveBeenCalled();
  });
});

describe('deletePublicBrandingAsset', () => {
  it('calls del() with the branding token', async () => {
    process.env.BLOB_BRANDING_READ_WRITE_TOKEN = 'vercel_blob_rw_branding_token';
    await deletePublicBrandingAsset('https://example-branding-store.public.blob.vercel-storage.com/branding/x/logo.png');
    expect(mockDel).toHaveBeenCalledWith('https://example-branding-store.public.blob.vercel-storage.com/branding/x/logo.png', {
      token: 'vercel_blob_rw_branding_token',
    });
  });

  it('throws BrandingStorageNotConfiguredError and never calls del() when the branding token is unset', async () => {
    delete process.env.BLOB_BRANDING_READ_WRITE_TOKEN;
    await expect(deletePublicBrandingAsset('https://example.com/x.png')).rejects.toBeInstanceOf(BrandingStorageNotConfiguredError);
    expect(mockDel).not.toHaveBeenCalled();
  });
});
