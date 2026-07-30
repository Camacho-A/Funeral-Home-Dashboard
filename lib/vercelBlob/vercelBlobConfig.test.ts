import { afterEach, describe, expect, it } from 'vitest';
import { getVercelBlobToken, isVercelBlobConfigured } from './vercelBlobConfig';

const ORIGINAL_TOKEN = process.env.BLOB_READ_WRITE_TOKEN;

afterEach(() => {
  if (ORIGINAL_TOKEN === undefined) {
    delete process.env.BLOB_READ_WRITE_TOKEN;
  } else {
    process.env.BLOB_READ_WRITE_TOKEN = ORIGINAL_TOKEN;
  }
});

describe('vercelBlobConfig', () => {
  it('isVercelBlobConfigured is false when the token is unset', () => {
    delete process.env.BLOB_READ_WRITE_TOKEN;
    expect(isVercelBlobConfigured()).toBe(false);
  });

  it('isVercelBlobConfigured is true once the token is set', () => {
    process.env.BLOB_READ_WRITE_TOKEN = 'vercel_blob_rw_test_token';
    expect(isVercelBlobConfigured()).toBe(true);
  });

  it('getVercelBlobToken throws a clear error naming the missing env var, never a generic failure', () => {
    delete process.env.BLOB_READ_WRITE_TOKEN;
    expect(() => getVercelBlobToken()).toThrow(/BLOB_READ_WRITE_TOKEN/);
  });

  it('getVercelBlobToken returns the configured value', () => {
    process.env.BLOB_READ_WRITE_TOKEN = 'vercel_blob_rw_test_token';
    expect(getVercelBlobToken()).toBe('vercel_blob_rw_test_token');
  });
});
