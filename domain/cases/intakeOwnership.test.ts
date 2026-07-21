import { describe, expect, it } from 'vitest';
import { assertIntakeOwnerUnchanged } from './intakeOwnership';

describe('assertIntakeOwnerUnchanged', () => {
  it('allows a patch that does not touch intakeOwnerId', () => {
    expect(() => assertIntakeOwnerUnchanged({ decedentName: 'New Name' })).not.toThrow();
  });

  it('allows an empty patch', () => {
    expect(() => assertIntakeOwnerUnchanged({})).not.toThrow();
  });

  it('rejects a patch that sets intakeOwnerId to a new value', () => {
    expect(() => assertIntakeOwnerUnchanged({ intakeOwnerId: 'staff-chris' })).toThrow(
      /intakeOwnerId cannot be changed/,
    );
  });

  it('rejects a patch that sets intakeOwnerId to null', () => {
    expect(() => assertIntakeOwnerUnchanged({ intakeOwnerId: null })).toThrow(
      /intakeOwnerId cannot be changed/,
    );
  });

  it('rejects even when intakeOwnerId is mixed in with other legitimate fields', () => {
    expect(() =>
      assertIntakeOwnerUnchanged({ isVeteran: true, intakeOwnerId: 'staff-priya' }),
    ).toThrow(/intakeOwnerId cannot be changed/);
  });
});
