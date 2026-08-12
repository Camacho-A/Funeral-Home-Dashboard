import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { notificationDeliveryFixtures, notificationFixtures, notificationPreferenceFixtures } from '@/services/__mocks__/notificationFixtures';

const { POST } = await import('./route');

function cronRequest(headers: Record<string, string> = {}) {
  return POST(new Request('http://localhost/api/cron/notification-digest', { method: 'POST', headers }));
}

beforeEach(() => {
  delete process.env.CRON_SECRET;
  notificationFixtures.length = 0;
  notificationDeliveryFixtures.length = 0;
  notificationPreferenceFixtures.length = 0;
});

afterEach(() => {
  delete process.env.CRON_SECRET;
  notificationFixtures.length = 0;
  notificationDeliveryFixtures.length = 0;
  notificationPreferenceFixtures.length = 0;
});

describe('POST /api/cron/notification-digest', () => {
  it('returns 503 when CRON_SECRET is not configured — fails closed, never accepts an unauthenticated trigger', async () => {
    const response = await cronRequest();
    expect(response.status).toBe(503);
  });

  it('returns 401 for a missing or wrong Authorization header', async () => {
    process.env.CRON_SECRET = 'real-secret';
    expect((await cronRequest()).status).toBe(401);
    expect((await cronRequest({ authorization: 'Bearer wrong-secret' })).status).toBe(401);
  });

  it('runs the sweep and returns its result for the correct bearer token', async () => {
    process.env.CRON_SECRET = 'real-secret';
    const response = await cronRequest({ authorization: 'Bearer real-secret' });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.result).toEqual({ groupsConsidered: 0, groupsFlushed: 0, groupsSkipped: 0, deliveriesFlushed: 0 });
  });
});
