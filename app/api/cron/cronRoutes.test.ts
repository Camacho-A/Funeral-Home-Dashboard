import { readFileSync } from 'fs';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isAuthorizedCronRequest } from './_lib/cronRoute';
import * as appointmentReminders from './appointment-reminders/route';
import * as billReminders from './bill-reminders/route';
import * as calendarSync from './calendar-sync/route';
import * as notificationDigest from './notification-digest/route';

/**
 * Scheduled-job isolation (2026-10) — every cron route answers POST only
 * (Manors: GET, what Vercel Cron sends, deliberately stays unexported so
 * no previously nonfunctional schedule starts running), behind a
 * constant-time CRON_SECRET bearer check, fails closed without the secret,
 * and refuses to sweep when the deployment organization scope is
 * unresolvable. See docs/SCHEDULED_JOBS.md.
 */

const ROUTES = {
  'appointment-reminders': appointmentReminders,
  'bill-reminders': billReminders,
  'calendar-sync': calendarSync,
  'notification-digest': notificationDigest,
} as const;

const ENV_KEYS = ['CRON_SECRET', 'DATA_ADAPTER', 'DEPLOYMENT_ORGANIZATION_IDS'] as const;
let originalEnv: Record<string, string | undefined>;

beforeEach(() => {
  originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  ENV_KEYS.forEach((key) => delete process.env[key]);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  ENV_KEYS.forEach((key) => {
    const value = originalEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  });
});

function request(path: string, method: 'POST', headers: Record<string, string> = {}) {
  return new Request(`http://localhost/api/cron/${path}`, { method, headers });
}

for (const [path, route] of Object.entries(ROUTES)) {
  it(`/api/cron/${path} exports no GET handler, so a Vercel Cron run still gets 405 (unchanged production behavior)`, () => {
    expect('GET' in route).toBe(false);
  });

  for (const method of ['POST'] as const) {
    describe(`${method} /api/cron/${path}`, () => {
      const handler = route[method];

      it('is exported (manual triggering)', () => {
        expect(typeof handler).toBe('function');
      });

      it('returns 503 when CRON_SECRET is unset, even with a bearer header', async () => {
        expect((await handler(request(path, method))).status).toBe(503);
        expect((await handler(request(path, method, { authorization: 'Bearer ' }))).status).toBe(503);
        expect((await handler(request(path, method, { authorization: 'Bearer undefined' }))).status).toBe(503);
      });

      it('returns 401 for a missing, wrong, or malformed bearer', async () => {
        process.env.CRON_SECRET = 'real-secret';
        expect((await handler(request(path, method))).status).toBe(401);
        expect((await handler(request(path, method, { authorization: 'Bearer wrong-secret' }))).status).toBe(401);
        expect((await handler(request(path, method, { authorization: 'Bearer real-secret-and-more' }))).status).toBe(401);
        expect((await handler(request(path, method, { authorization: 'real-secret' }))).status).toBe(401);
        expect((await handler(request(path, method, { authorization: 'bearer real-secret' }))).status).toBe(401);
      });

      it('runs the sweep (200) with the correct bearer', async () => {
        process.env.CRON_SECRET = 'real-secret';
        process.env.DEPLOYMENT_ORGANIZATION_IDS = 'managed-cremations';
        const response = await handler(request(path, method, { authorization: 'Bearer real-secret' }));
        expect(response.status).toBe(200);
        expect(await response.json()).toHaveProperty('result');
      });

      it('returns 503 (never sweeps every tenant) when production on Wix has no DEPLOYMENT_ORGANIZATION_IDS', async () => {
        process.env.CRON_SECRET = 'real-secret';
        process.env.DATA_ADAPTER = 'wix';
        vi.stubEnv('NODE_ENV', 'production');
        const fetchSpy = vi.fn();
        vi.stubGlobal('fetch', fetchSpy);
        const response = await handler(request(path, method, { authorization: 'Bearer real-secret' }));
        vi.unstubAllGlobals();
        expect(response.status).toBe(503);
        expect(fetchSpy).not.toHaveBeenCalled();
      });
    });
  }
}

describe('isAuthorizedCronRequest', () => {
  it('accepts only the exact `Bearer <secret>` header', () => {
    const withHeader = (value?: string) => new Request('http://localhost/x', { headers: value ? { authorization: value } : {} });
    expect(isAuthorizedCronRequest(withHeader('Bearer s3cret'), 's3cret')).toBe(true);
    expect(isAuthorizedCronRequest(withHeader(), 's3cret')).toBe(false);
    expect(isAuthorizedCronRequest(withHeader('Bearer s3cre'), 's3cret')).toBe(false);
    expect(isAuthorizedCronRequest(withHeader('Bearer s3cretX'), 's3cret')).toBe(false);
  });
});

describe('vercel.json (Manors: production schedule unchanged by the multi-tenant port)', () => {
  it('still schedules only the existing daily bill-reminders entry', () => {
    const config = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'vercel.json'), 'utf8')) as { crons?: unknown[] };
    expect(config.crons).toEqual([{ path: '/api/cron/bill-reminders', schedule: '0 8 * * *' }]);
  });
});
