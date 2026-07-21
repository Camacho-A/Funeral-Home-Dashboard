import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GET } from './route';

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

describe('GET /api/wix-health', () => {
  it('mock mode (the default) responds without attempting any Wix call', async () => {
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      adapter: 'mock',
      connected: true,
      message: 'Mock mode — no Wix connection required.',
    });
  });

  it('wix mode fails cleanly with a clear message when required config is missing', async () => {
    process.env.DATA_ADAPTER = 'wix';
    // WIX_API_KEY / WIX_SITE_ID deliberately left unset.

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.adapter).toBe('wix');
    expect(body.connected).toBe(false);
    expect(body.error).toMatch(/WIX_API_KEY, WIX_SITE_ID/);
  });

  it('never leaks a raw API key value into the response, even on failure', async () => {
    process.env.DATA_ADAPTER = 'wix';
    process.env.WIX_API_KEY = 'super-secret-test-value';
    // WIX_SITE_ID left unset, so getWixServerConfig() still throws before any
    // network call — this only proves the response body itself is clean.

    const response = await GET();
    const bodyText = await response.text();

    expect(bodyText).not.toContain('super-secret-test-value');
  });
});
