import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  consoleIdentityMessageSender,
  productionUnconfiguredIdentityMessageSender,
  getIdentityMessageSender,
} from './messageSender';

function setNodeEnv(value: string) {
  vi.stubEnv('NODE_ENV', value);
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('getIdentityMessageSender', () => {
  it('returns the console (dev) adapter outside production', () => {
    setNodeEnv('development');
    expect(getIdentityMessageSender()).toBe(consoleIdentityMessageSender);

    setNodeEnv('test');
    expect(getIdentityMessageSender()).toBe(consoleIdentityMessageSender);
  });

  it('returns the production-unconfigured adapter when NODE_ENV=production', () => {
    setNodeEnv('production');
    expect(getIdentityMessageSender()).toBe(productionUnconfiguredIdentityMessageSender);
  });

  it('never throws just by being called, in any environment', () => {
    setNodeEnv('production');
    expect(() => getIdentityMessageSender()).not.toThrow();
  });
});

describe('consoleIdentityMessageSender', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => {
    logSpy.mockRestore();
  });

  it('logs to the console outside production, never elsewhere', async () => {
    setNodeEnv('development');
    await consoleIdentityMessageSender.send({ kind: 'password_reset', to: 'x@example.com', token: 'raw-token-value' });
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls[0][0]).toContain('raw-token-value');
  });

  it('refuses to run at all when NODE_ENV=production — development token access must be impossible there', async () => {
    setNodeEnv('production');
    await expect(
      consoleIdentityMessageSender.send({ kind: 'password_reset', to: 'x@example.com', token: 'raw-token-value' }),
    ).rejects.toThrow(/production/i);
    expect(logSpy).not.toHaveBeenCalled();
  });
});

describe('productionUnconfiguredIdentityMessageSender', () => {
  it('always fails to send — no real provider exists in this codebase', async () => {
    await expect(
      productionUnconfiguredIdentityMessageSender.send({ kind: 'email_verification', to: 'x@example.com', token: 'raw-token-value' }),
    ).rejects.toThrow(/no identity message provider/i);
  });

  it('never includes the token in its own error message', async () => {
    try {
      await productionUnconfiguredIdentityMessageSender.send({ kind: 'password_reset', to: 'x@example.com', token: 'super-secret-raw-token' });
      throw new Error('unreachable');
    } catch (error) {
      expect((error as Error).message).not.toContain('super-secret-raw-token');
    }
  });
});
