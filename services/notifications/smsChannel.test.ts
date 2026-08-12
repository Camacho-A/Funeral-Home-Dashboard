import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  consoleSmsProvider,
  productionUnconfiguredSmsProvider,
  twilioSmsProvider,
  isTwilioConfigured,
  getSmsProvider,
  sendSmsNotification,
  TwilioApiError,
} from './smsChannel';
import type { NotificationContent } from '../../domain/notifications/notificationTemplateRegistry';

function setNodeEnv(value: string) {
  vi.stubEnv('NODE_ENV', value);
}

function clearTwilioEnv() {
  delete process.env.TWILIO_ACCOUNT_SID;
  delete process.env.TWILIO_AUTH_TOKEN;
  delete process.env.TWILIO_FROM_NUMBER;
}

beforeEach(() => {
  clearTwilioEnv();
});

afterEach(() => {
  vi.unstubAllEnvs();
  clearTwilioEnv();
  vi.unstubAllGlobals();
});

const CONTENT: NotificationContent = { title: 'Task assigned', body: 'Dana assigned you: "Call the cemetery"', actionUrl: '/tasks/123' };

describe('isTwilioConfigured', () => {
  it('is true only when all three Twilio env vars are set', () => {
    expect(isTwilioConfigured()).toBe(false);
    process.env.TWILIO_ACCOUNT_SID = 'AC123';
    process.env.TWILIO_AUTH_TOKEN = 'token';
    expect(isTwilioConfigured()).toBe(false); // FROM_NUMBER still missing
    process.env.TWILIO_FROM_NUMBER = '+15555550100';
    expect(isTwilioConfigured()).toBe(true);
  });
});

describe('getSmsProvider', () => {
  it('returns the console (dev) provider outside production', () => {
    setNodeEnv('development');
    expect(getSmsProvider()).toBe(consoleSmsProvider);
    setNodeEnv('test');
    expect(getSmsProvider()).toBe(consoleSmsProvider);
  });

  it('returns the production-unconfigured provider when NODE_ENV=production', () => {
    setNodeEnv('production');
    expect(getSmsProvider()).toBe(productionUnconfiguredSmsProvider);
  });

  it('never throws just by being called, in any environment', () => {
    setNodeEnv('production');
    expect(() => getSmsProvider()).not.toThrow();
  });

  it('returns twilioSmsProvider when fully configured, and it wins over NODE_ENV=production', () => {
    process.env.TWILIO_ACCOUNT_SID = 'AC123';
    process.env.TWILIO_AUTH_TOKEN = 'token';
    process.env.TWILIO_FROM_NUMBER = '+15555550100';
    setNodeEnv('development');
    expect(getSmsProvider()).toBe(twilioSmsProvider);
    setNodeEnv('production');
    expect(getSmsProvider()).toBe(twilioSmsProvider);
  });
});

describe('consoleSmsProvider', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => {
    logSpy.mockRestore();
  });

  it('logs to the console outside production, never elsewhere', async () => {
    setNodeEnv('development');
    await consoleSmsProvider.send({ to: '+15555550101', body: 'x' });
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls[0][0]).toContain('+15555550101');
  });

  it('refuses to run at all when NODE_ENV=production', async () => {
    setNodeEnv('production');
    await expect(consoleSmsProvider.send({ to: '+15555550101', body: 'x' })).rejects.toThrow(/production/i);
    expect(logSpy).not.toHaveBeenCalled();
  });
});

describe('productionUnconfiguredSmsProvider', () => {
  it('always fails to send — no real provider exists until Twilio env vars are set', async () => {
    await expect(productionUnconfiguredSmsProvider.send({ to: '+15555550101', body: 'x' })).rejects.toThrow(/no sms provider/i);
  });
});

describe('twilioSmsProvider', () => {
  beforeEach(() => {
    process.env.TWILIO_ACCOUNT_SID = 'AC123';
    process.env.TWILIO_AUTH_TOKEN = 'fake-token';
    process.env.TWILIO_FROM_NUMBER = '+15555550100';
  });

  it('sends the correct endpoint, headers, and form-encoded body — a fake transport, never a live Twilio call', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 201 });
    vi.stubGlobal('fetch', fetchMock);

    await twilioSmsProvider.send({ to: '+15555550101', body: 'Hello' });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.twilio.com/2010-04-01/Accounts/AC123/Messages.json',
      expect.objectContaining({ method: 'POST' }),
    );
    const call = fetchMock.mock.calls[0][1] as { headers: Record<string, string>; body: string };
    expect(call.headers.Authorization).toBe(`Basic ${Buffer.from('AC123:fake-token').toString('base64')}`);
    const params = new URLSearchParams(call.body);
    expect(params.get('To')).toBe('+15555550101');
    expect(params.get('From')).toBe('+15555550100');
    expect(params.get('Body')).toBe('Hello');
  });

  it('throws TwilioApiError with the real HTTP status on a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 400 }));
    await expect(twilioSmsProvider.send({ to: '+15555550101', body: 'x' })).rejects.toThrow(TwilioApiError);
    await expect(twilioSmsProvider.send({ to: '+15555550101', body: 'x' })).rejects.toMatchObject({ status: 400 });
  });

  it('throws a clear error and never fetches when any Twilio env var is missing', async () => {
    delete process.env.TWILIO_FROM_NUMBER;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(twilioSmsProvider.send({ to: '+15555550101', body: 'x' })).rejects.toThrow(/TWILIO_/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('sendSmsNotification', () => {
  beforeEach(() => {
    setNodeEnv('development');
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('formats structured NotificationContent into a plain-text SMS with the action link appended', async () => {
    const sendSpy = vi.spyOn(consoleSmsProvider, 'send');
    await sendSmsNotification('+15555550101', CONTENT);
    expect(sendSpy).toHaveBeenCalledWith({
      to: '+15555550101',
      body: 'Task assigned: Dana assigned you: "Call the cemetery" /tasks/123',
    });
  });

  it('omits the trailing link entirely when actionUrl is null', async () => {
    const sendSpy = vi.spyOn(consoleSmsProvider, 'send');
    await sendSmsNotification('+15555550101', { ...CONTENT, actionUrl: null });
    expect(sendSpy.mock.calls[0][0].body).toBe('Task assigned: Dana assigned you: "Call the cemetery"');
  });
});
