import { afterEach, describe, expect, it } from 'vitest';
import { resolveStaticBlobToken, resolveBrandingBlobStoreId, BrandingStorageNotConfiguredError } from './vercelBlobConfig';

const ORIGINAL_TOKEN = process.env.BLOB_READ_WRITE_TOKEN;
const ORIGINAL_STORE_ID = process.env.BLOB_STORE_ID;
const ORIGINAL_BRANDING_STORE_ID = process.env.BLOB_BRANDING_STORE_ID;

afterEach(() => {
  if (ORIGINAL_TOKEN === undefined) {
    delete process.env.BLOB_READ_WRITE_TOKEN;
  } else {
    process.env.BLOB_READ_WRITE_TOKEN = ORIGINAL_TOKEN;
  }
  if (ORIGINAL_STORE_ID === undefined) {
    delete process.env.BLOB_STORE_ID;
  } else {
    process.env.BLOB_STORE_ID = ORIGINAL_STORE_ID;
  }
  if (ORIGINAL_BRANDING_STORE_ID === undefined) {
    delete process.env.BLOB_BRANDING_STORE_ID;
  } else {
    process.env.BLOB_BRANDING_STORE_ID = ORIGINAL_BRANDING_STORE_ID;
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
 * Production incident fix (2026-10), corrected to use Vercel's current
 * OIDC/multi-store architecture: branding uploads must explicitly target
 * the SEPARATE, PUBLIC branding store by its own storeId — never the
 * private document store's BLOB_STORE_ID (directly, or via any ambient
 * fallback), and never silently succeed with no store configured at all.
 * An earlier attempt at this fix required a long-lived
 * BLOB_BRANDING_READ_WRITE_TOKEN — wrong for how Vercel now provisions a
 * second connected store (auto-injects a storeId, not a token); these
 * tests cover the corrected, storeId-based contract.
 */
describe('resolveBrandingBlobStoreId (branding/document store separation via OIDC, 2026-10)', () => {
  it('returns the configured branding store id when set', () => {
    process.env.BLOB_BRANDING_STORE_ID = 'store_branding_test_id';
    expect(resolveBrandingBlobStoreId()).toBe('store_branding_test_id');
  });

  it('throws BrandingStorageNotConfiguredError — never returns undefined and never falls back to the document store id — when unset', () => {
    delete process.env.BLOB_BRANDING_STORE_ID;
    process.env.BLOB_STORE_ID = 'store_document_test_id'; // a configured document store id must NOT satisfy this
    expect(() => resolveBrandingBlobStoreId()).toThrow(BrandingStorageNotConfiguredError);
  });

  it('the thrown error message names the missing environment variable, never a store id or token value', () => {
    delete process.env.BLOB_BRANDING_STORE_ID;
    try {
      resolveBrandingBlobStoreId();
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(BrandingStorageNotConfiguredError);
      expect((error as Error).message).toContain('BLOB_BRANDING_STORE_ID');
    }
  });

  it('is never equal to the document store\'s BLOB_STORE_ID even when both happen to be set — distinct ids, distinct stores', () => {
    process.env.BLOB_STORE_ID = 'store_document_test_id';
    process.env.BLOB_BRANDING_STORE_ID = 'store_branding_test_id';
    expect(resolveBrandingBlobStoreId()).not.toBe(process.env.BLOB_STORE_ID);
  });

  it('no longer requires or reads BLOB_BRANDING_READ_WRITE_TOKEN at all', () => {
    delete process.env.BLOB_BRANDING_READ_WRITE_TOKEN;
    process.env.BLOB_BRANDING_STORE_ID = 'store_branding_test_id';
    expect(resolveBrandingBlobStoreId()).toBe('store_branding_test_id');
  });
});
