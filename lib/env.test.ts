import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getDataAdapterMode, getWixServerConfig } from './env';

const ENV_KEYS = ['DATA_ADAPTER', 'WIX_API_KEY', 'WIX_SITE_ID'] as const;
let originalEnv: Record<string, string | undefined>;

beforeEach(() => {
  originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  ENV_KEYS.forEach((key) => delete process.env[key]);
});

afterEach(() => {
  ENV_KEYS.forEach((key) => {
    const value = originalEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  });
});

describe('getDataAdapterMode', () => {
  it('defaults to "mock" when DATA_ADAPTER is unset', () => {
    expect(getDataAdapterMode()).toBe('mock');
  });

  it('returns "wix" when explicitly set', () => {
    process.env.DATA_ADAPTER = 'wix';
    expect(getDataAdapterMode()).toBe('wix');
  });

  it('is case-insensitive', () => {
    process.env.DATA_ADAPTER = 'WIX';
    expect(getDataAdapterMode()).toBe('wix');
  });

  it('throws a clear error for an invalid value', () => {
    process.env.DATA_ADAPTER = 'postgres';
    expect(() => getDataAdapterMode()).toThrow(/Invalid DATA_ADAPTER value "postgres"/);
  });
});

describe('getWixServerConfig', () => {
  it('returns apiKey/siteId when both are set', () => {
    process.env.WIX_API_KEY = 'test-key';
    process.env.WIX_SITE_ID = 'test-site';
    expect(getWixServerConfig()).toEqual({ apiKey: 'test-key', siteId: 'test-site' });
  });

  it('throws naming every missing variable when both are absent', () => {
    expect(() => getWixServerConfig()).toThrow(/WIX_API_KEY, WIX_SITE_ID/);
  });

  it('throws naming only the missing variable when one is present', () => {
    process.env.WIX_API_KEY = 'test-key';
    expect(() => getWixServerConfig()).toThrow(/WIX_SITE_ID/);
    expect(() => getWixServerConfig()).not.toThrow(/WIX_API_KEY,/);
  });
});
