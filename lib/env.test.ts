import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getAuthAdapterMode, getDataAdapterMode, getWixServerConfig } from './env';

const ENV_KEYS = ['DATA_ADAPTER', 'AUTH_ADAPTER', 'WIX_API_KEY', 'WIX_SITE_ID'] as const;
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

describe('getAuthAdapterMode', () => {
  it('defaults to "mock" when AUTH_ADAPTER is unset', () => {
    expect(getAuthAdapterMode()).toBe('mock');
  });

  it('returns "wix" when explicitly set', () => {
    process.env.AUTH_ADAPTER = 'wix';
    expect(getAuthAdapterMode()).toBe('wix');
  });

  it('is case-insensitive', () => {
    process.env.AUTH_ADAPTER = 'WIX';
    expect(getAuthAdapterMode()).toBe('wix');
  });

  it('throws a clear error for an invalid value', () => {
    process.env.AUTH_ADAPTER = 'postgres';
    expect(() => getAuthAdapterMode()).toThrow(/Invalid AUTH_ADAPTER value "postgres"/);
  });

  it('is fully independent of DATA_ADAPTER — every combination is valid', () => {
    process.env.DATA_ADAPTER = 'wix';
    process.env.AUTH_ADAPTER = 'mock';
    expect(getDataAdapterMode()).toBe('wix');
    expect(getAuthAdapterMode()).toBe('mock');

    process.env.DATA_ADAPTER = 'mock';
    process.env.AUTH_ADAPTER = 'wix';
    expect(getDataAdapterMode()).toBe('mock');
    expect(getAuthAdapterMode()).toBe('wix');
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
