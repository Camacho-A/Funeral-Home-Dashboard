import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockPut = vi.fn();
const mockGet = vi.fn();
const mockDel = vi.fn();

vi.mock('@vercel/blob', () => ({
  put: (...args: unknown[]) => mockPut(...args),
  get: (...args: unknown[]) => mockGet(...args),
  del: (...args: unknown[]) => mockDel(...args),
}));

const { vercelBlobStorageProvider } = await import('./vercelBlobStorageProvider');

const ORIGINAL_TOKEN = process.env.BLOB_READ_WRITE_TOKEN;

afterEach(() => {
  vi.clearAllMocks();
  if (ORIGINAL_TOKEN === undefined) {
    delete process.env.BLOB_READ_WRITE_TOKEN;
  } else {
    process.env.BLOB_READ_WRITE_TOKEN = ORIGINAL_TOKEN;
  }
});

function fakeStream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

describe('vercelBlobStorageProvider — never calls the real Vercel Blob API in tests (mocked SDK)', () => {
  describe('with BLOB_READ_WRITE_TOKEN set (legacy/local path)', () => {
    beforeEach(() => {
      process.env.BLOB_READ_WRITE_TOKEN = 'vercel_blob_rw_test_token';
    });

    it('uploadFile passes an explicit token and returns the opaque pathname as storageKey', async () => {
      mockPut.mockResolvedValue({ pathname: 'org-1/case-1/doc-1.pdf' });
      const contents = Buffer.from('pdf-bytes');

      const result = await vercelBlobStorageProvider.uploadFile('org-1/case-1/doc-1.pdf', contents, 'application/pdf');

      expect(result).toEqual({ storageKey: 'org-1/case-1/doc-1.pdf' });
      expect(mockPut).toHaveBeenCalledWith(
        'org-1/case-1/doc-1.pdf',
        contents,
        expect.objectContaining({ access: 'private', contentType: 'application/pdf', addRandomSuffix: false, token: 'vercel_blob_rw_test_token' }),
      );
    });

    it('deleteFile calls del with the storage key and the explicit token', async () => {
      mockDel.mockResolvedValue(undefined);
      await vercelBlobStorageProvider.deleteFile('org-1/case-1/doc-1.pdf');
      expect(mockDel).toHaveBeenCalledWith('org-1/case-1/doc-1.pdf', expect.objectContaining({ token: 'vercel_blob_rw_test_token' }));
    });
  });

  describe('with BLOB_READ_WRITE_TOKEN unset (production OIDC path)', () => {
    beforeEach(() => {
      delete process.env.BLOB_READ_WRITE_TOKEN;
    });

    it('uploadFile omits the token option entirely, letting the SDK fall through to OIDC', async () => {
      mockPut.mockResolvedValue({ pathname: 'org-1/case-1/doc-1.pdf' });
      const contents = Buffer.from('pdf-bytes');

      const result = await vercelBlobStorageProvider.uploadFile('org-1/case-1/doc-1.pdf', contents, 'application/pdf');

      expect(result).toEqual({ storageKey: 'org-1/case-1/doc-1.pdf' });
      const [, , options] = mockPut.mock.calls[0];
      expect(options).toEqual({ access: 'private', contentType: 'application/pdf', addRandomSuffix: false });
      expect(options).not.toHaveProperty('token');
    });

    it('downloadFile omits the token option entirely', async () => {
      const bytes = new TextEncoder().encode('hello pdf');
      mockGet.mockResolvedValue({ statusCode: 200, stream: fakeStream(bytes), blob: { contentType: 'application/pdf' } });

      const result = await vercelBlobStorageProvider.downloadFile('org-1/case-1/doc-1.pdf');

      expect(result.buffer.toString()).toBe('hello pdf');
      const [, options] = mockGet.mock.calls[0];
      expect(options).toEqual({ access: 'private' });
    });

    it('deleteFile omits the token option entirely', async () => {
      mockDel.mockResolvedValue(undefined);
      await vercelBlobStorageProvider.deleteFile('org-1/case-1/doc-1.pdf');
      const [, options] = mockDel.mock.calls[0];
      expect(options).toEqual({});
    });

    it('a genuine "no credentials found" SDK failure (neither token nor OIDC resolved) propagates as-is', async () => {
      mockPut.mockRejectedValue(new Error('Vercel Blob: No blob credentials found. Pass a `token` option, set `BLOB_READ_WRITE_TOKEN`, or use `oidcToken` (or `VERCEL_OIDC_TOKEN`) with `storeId` or `BLOB_STORE_ID`.'));
      await expect(vercelBlobStorageProvider.uploadFile('k', Buffer.from('x'), 'text/plain')).rejects.toThrow(/No blob credentials found/);
    });
  });

  it('downloadFile fetches with access: private and buffers the full stream', async () => {
    const bytes = new TextEncoder().encode('hello pdf');
    mockGet.mockResolvedValue({
      statusCode: 200,
      stream: fakeStream(bytes),
      blob: { contentType: 'application/pdf' },
    });

    const result = await vercelBlobStorageProvider.downloadFile('org-1/case-1/doc-1.pdf');

    expect(result.buffer.toString()).toBe('hello pdf');
    expect(result.contentType).toBe('application/pdf');
    expect(mockGet).toHaveBeenCalledWith('org-1/case-1/doc-1.pdf', expect.objectContaining({ access: 'private' }));
  });

  it('downloadFile throws a clear error when the blob does not exist', async () => {
    mockGet.mockResolvedValue(null);
    await expect(vercelBlobStorageProvider.downloadFile('missing-key')).rejects.toThrow(/no blob found/i);
  });
});
