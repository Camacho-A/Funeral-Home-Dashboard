import { describe, expect, it, vi } from 'vitest';
import { runAfterResponse } from './afterResponse';

vi.unmock('@/lib/afterResponse');

const { after } = vi.hoisted(() => ({ after: vi.fn() }));
vi.mock('next/server', () => ({ after }));

describe('runAfterResponse', () => {
  it('hands the work to Next.js after() inside a request', () => {
    const task = vi.fn().mockResolvedValue(undefined);
    runAfterResponse('x', task);
    expect(after).toHaveBeenCalledTimes(1);
    expect(task).not.toHaveBeenCalled();
  });

  it('starts the work immediately when there is no request to wait for', async () => {
    after.mockImplementationOnce(() => {
      throw new Error('`after` was called outside a request scope');
    });
    const task = vi.fn().mockResolvedValue(undefined);
    runAfterResponse('x', task);
    await vi.waitFor(() => expect(task).toHaveBeenCalledTimes(1));
  });

  it('never lets the work throw into the caller', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    after.mockImplementationOnce(() => {
      throw new Error('outside request');
    });
    expect(() => runAfterResponse('x', () => Promise.reject(new Error('boom')))).not.toThrow();
    await vi.waitFor(() => expect(console.error).toHaveBeenCalledWith('[after-response] x failed:', 'boom'));
  });
});
