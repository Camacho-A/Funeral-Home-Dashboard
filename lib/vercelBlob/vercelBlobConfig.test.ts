import { afterEach, describe, expect, it } from 'vitest';
import { resolveStaticBlobToken } from './vercelBlobConfig';

const ORIGINAL_TOKEN = process.env.BLOB_READ_WRITE_TOKEN;

afterEach(() => {
  if (ORIGINAL_TOKEN === undefined) {
    delete process.env.BLOB_READ_WRITE_TOKEN;
  } else {
    process.env.BLOB_READ_WRITE_TOKEN = ORIGINAL_TOKEN;
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
