import { afterEach, describe, expect, it } from 'vitest';
import { resolveStaticBlobToken, resolveBrandingBlobToken, BrandingStorageNotConfiguredError } from './vercelBlobConfig';

const ORIGINAL_TOKEN = process.env.BLOB_READ_WRITE_TOKEN;
const ORIGINAL_BRANDING_TOKEN = process.env.BLOB_BRANDING_READ_WRITE_TOKEN;

afterEach(() => {
  if (ORIGINAL_TOKEN === undefined) {
    delete process.env.BLOB_READ_WRITE_TOKEN;
  } else {
    process.env.BLOB_READ_WRITE_TOKEN = ORIGINAL_TOKEN;
  }
  if (ORIGINAL_BRANDING_TOKEN === undefined) {
    delete process.env.BLOB_BRANDING_READ_WRITE_TOKEN;
  } else {
    process.env.BLOB_BRANDING_READ_WRITE_TOKEN = ORIGINAL_BRANDING_TOKEN;
  }
});

describe('vercelBlobConfig (OIDC-aware, 2026-09)', () => {
  it('resolveStaticBlobToken returns undefined, never throws, when the legacy token is unset', () => {
    delete process.env.BLOB_READ_WRITE_TOKEN;
    expect(resolveStaticBlobToken()).toBeUndefined();
  });

  it('resolveStaticBlobToken returns the configured legacy token when set', () => {
    process.env.BLOB_READ_WRITE_TOKEN = 'vercel_blob_rw_test_token';
    expect(resolveStaticBlobToken()).toBe('vercel_blob_rw_test_token');
  });
});

/**
 * Production incident fix (2026-10): branding uploads must use a
 * SEPARATE, PUBLIC Blob store's token — never the private document
 * store's token (directly, or via any ambient/OIDC fallback), and never
 * silently succeed with no token configured at all.
 */
describe('resolveBrandingBlobToken (branding/document store separation, 2026-10)', () => {
  it('returns the configured branding token when set', () => {
    process.env.BLOB_BRANDING_READ_WRITE_TOKEN = 'vercel_blob_rw_branding_test_token';
    expect(resolveBrandingBlobToken()).toBe('vercel_blob_rw_branding_test_token');
  });

  it('throws BrandingStorageNotConfiguredError — never returns undefined and never falls back to the document token — when unset', () => {
    delete process.env.BLOB_BRANDING_READ_WRITE_TOKEN;
    process.env.BLOB_READ_WRITE_TOKEN = 'vercel_blob_rw_test_token'; // a configured document token must NOT satisfy this
    expect(() => resolveBrandingBlobToken()).toThrow(BrandingStorageNotConfiguredError);
  });

  it('the thrown error message names the missing environment variable but never any token value', () => {
    delete process.env.BLOB_BRANDING_READ_WRITE_TOKEN;
    try {
      resolveBrandingBlobToken();
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(BrandingStorageNotConfiguredError);
      expect((error as Error).message).toContain('BLOB_BRANDING_READ_WRITE_TOKEN');
    }
  });

  it('is never equal to resolveStaticBlobToken\'s value even when both happen to be set — distinct tokens, distinct stores', () => {
    process.env.BLOB_READ_WRITE_TOKEN = 'vercel_blob_rw_document_token';
    process.env.BLOB_BRANDING_READ_WRITE_TOKEN = 'vercel_blob_rw_branding_token';
    expect(resolveBrandingBlobToken()).not.toBe(resolveStaticBlobToken());
  });
});
