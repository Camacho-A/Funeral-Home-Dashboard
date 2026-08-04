import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { consoleEmailProvider, productionUnconfiguredEmailProvider, getEmailProvider, sendEmailNotification } from './emailChannel';
import type { NotificationContent } from '../../domain/notifications/notificationTemplateRegistry';

function setNodeEnv(value: string) {
  vi.stubEnv('NODE_ENV', value);
}

afterEach(() => {
  vi.unstubAllEnvs();
});

const CONTENT: NotificationContent = { title: 'Task assigned', body: 'Dana assigned you: "Call the cemetery"', actionUrl: '/tasks/123' };

describe('getEmailProvider', () => {
  it('returns the console (dev) provider outside production', () => {
    setNodeEnv('development');
    expect(getEmailProvider()).toBe(consoleEmailProvider);

    setNodeEnv('test');
    expect(getEmailProvider()).toBe(consoleEmailProvider);
  });

  it('returns the production-unconfigured provider when NODE_ENV=production', () => {
    setNodeEnv('production');
    expect(getEmailProvider()).toBe(productionUnconfiguredEmailProvider);
  });

  it('never throws just by being called, in any environment', () => {
    setNodeEnv('production');
    expect(() => getEmailProvider()).not.toThrow();
  });
});

describe('consoleEmailProvider', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => {
    logSpy.mockRestore();
  });

  it('logs to the console outside production, never elsewhere', async () => {
    setNodeEnv('development');
    await consoleEmailProvider.send({ to: 'staff@example.com', subject: 'Task assigned', bodyHtml: '<p>x</p>', bodyText: 'x' });
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls[0][0]).toContain('staff@example.com');
  });

  it('refuses to run at all when NODE_ENV=production', async () => {
    setNodeEnv('production');
    await expect(consoleEmailProvider.send({ to: 'staff@example.com', subject: 'x', bodyHtml: 'x', bodyText: 'x' })).rejects.toThrow(/production/i);
    expect(logSpy).not.toHaveBeenCalled();
  });
});

describe('productionUnconfiguredEmailProvider', () => {
  it('always fails to send — no real provider exists in this codebase', async () => {
    await expect(productionUnconfiguredEmailProvider.send({ to: 'staff@example.com', subject: 'x', bodyHtml: 'x', bodyText: 'x' })).rejects.toThrow(/no email provider/i);
  });
});

describe('sendEmailNotification', () => {
  beforeEach(() => {
    setNodeEnv('development');
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('formats structured NotificationContent into an email (title -> subject, actionUrl -> a link)', async () => {
    const sendSpy = vi.spyOn(consoleEmailProvider, 'send');
    await sendEmailNotification('staff@example.com', CONTENT);
    expect(sendSpy).toHaveBeenCalledWith({
      to: 'staff@example.com',
      subject: 'Task assigned',
      bodyHtml: expect.stringContaining('/tasks/123'),
      bodyText: expect.stringContaining('/tasks/123'),
    });
  });

  it('omits the link entirely when actionUrl is null', async () => {
    const sendSpy = vi.spyOn(consoleEmailProvider, 'send');
    await sendEmailNotification('staff@example.com', { ...CONTENT, actionUrl: null });
    const sentMessage = sendSpy.mock.calls[0][0];
    expect(sentMessage.bodyHtml).not.toContain('<a href');
  });
});
