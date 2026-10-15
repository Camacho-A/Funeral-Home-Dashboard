import { beforeEach, describe, expect, it, vi } from 'vitest';

const request = vi.hoisted(() => ({ current: {} as object | null }));
vi.mock('next/headers', () => ({
  headers: async () => {
    if (!request.current) throw new Error('`headers` was called outside a request scope.');
    return request.current;
  },
}));

const { requestScopedMemo, invalidateRequestScoped } = await import('./requestScope');

beforeEach(() => {
  request.current = {};
});

describe('requestScopedMemo', () => {
  it('computes once per key within one request', async () => {
    const compute = vi.fn(async () => 'value');
    const [a, b] = await Promise.all([
      requestScopedMemo('k', compute),
      requestScopedMemo('k', compute),
    ]);
    expect(a).toBe('value');
    expect(b).toBe('value');
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it('never shares a value between two requests', async () => {
    const compute = vi.fn(async () => 'value');
    await requestScopedMemo('k', compute);
    request.current = {};
    await requestScopedMemo('k', compute);
    expect(compute).toHaveBeenCalledTimes(2);
  });

  it('keeps different keys separate', async () => {
    const a = await requestScopedMemo('permissions:wix:org-a:administrator', async () => 'A');
    const b = await requestScopedMemo('permissions:wix:org-b:administrator', async () => 'B');
    expect([a, b]).toEqual(['A', 'B']);
  });

  it('does not remember a failure', async () => {
    const compute = vi
      .fn()
      .mockRejectedValueOnce(new Error('wix down'))
      .mockResolvedValueOnce('ok');
    await expect(requestScopedMemo('k', compute)).rejects.toThrow('wix down');
    await expect(requestScopedMemo('k', compute)).resolves.toBe('ok');
  });

  it('computes directly, with no memoization, outside a request', async () => {
    request.current = null;
    const compute = vi.fn(async () => 'value');
    await requestScopedMemo('k', compute);
    await requestScopedMemo('k', compute);
    expect(compute).toHaveBeenCalledTimes(2);
  });

  it('invalidateRequestScoped drops matching entries in the current request only', async () => {
    const compute = vi.fn(async () => 'value');
    await requestScopedMemo('permissions:x', compute);
    await requestScopedMemo('other', compute);
    await invalidateRequestScoped('permissions:');
    await requestScopedMemo('permissions:x', compute);
    await requestScopedMemo('other', compute);
    expect(compute).toHaveBeenCalledTimes(3);
  });
});
