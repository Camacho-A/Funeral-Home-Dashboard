import { describe, expect, it } from 'vitest';
import { deliverInApp } from './inAppChannel';

describe('deliverInApp', () => {
  it('always succeeds — there is nothing external to fail', async () => {
    expect(await deliverInApp()).toEqual({ succeeded: true });
  });
});
