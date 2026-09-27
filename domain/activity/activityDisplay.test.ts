import { describe, expect, it } from 'vitest';
import { activityActorLabel } from './activityDisplay';

describe('activityActorLabel (item #16 — Case Activity actor attribution)', () => {
  it('1. displays "System" for an explicitly system-generated event', () => {
    expect(activityActorLabel({ isSystemGenerated: true, actorRoleKey: null })).toBe('System');
  });

  it('2. never displays "Office" for a system-generated event, even if actorRoleKey is (incorrectly) populated', () => {
    const label = activityActorLabel({ isSystemGenerated: true, actorRoleKey: 'officeStaff' });
    expect(label).toBe('System');
    expect(label).not.toMatch(/office/i);
  });

  it('3. a real Office Staff human action is not relabeled System', () => {
    expect(activityActorLabel({ isSystemGenerated: false, actorRoleKey: 'officeStaff' })).toBe('Office Staff');
  });

  it('5. other human roles remain correctly attributed via the existing friendly role catalog', () => {
    expect(activityActorLabel({ isSystemGenerated: false, actorRoleKey: 'administrator' })).toBe('Administrator');
    expect(activityActorLabel({ isSystemGenerated: false, actorRoleKey: 'funeralDirector' })).toBe('Funeral Director');
    expect(activityActorLabel({ isSystemGenerated: false, actorRoleKey: 'dispatch' })).toBe('Dispatch');
  });

  it('resolves a pre-Phase-22 legacy role string through the existing alias table, not a second system', () => {
    expect(activityActorLabel({ isSystemGenerated: false, actorRoleKey: 'staff' })).toBe('Office Staff');
    expect(activityActorLabel({ isSystemGenerated: false, actorRoleKey: 'caseManager' })).toBe('Funeral Director');
    expect(activityActorLabel({ isSystemGenerated: false, actorRoleKey: 'owner' })).toBe('Administrator');
  });

  it('6. missing actor information is not automatically assumed to be System', () => {
    expect(activityActorLabel({ isSystemGenerated: false, actorRoleKey: null })).toBe('Unknown');
  });

  it('12. an unrecognized/custom role key falls back to the raw key rather than a raw-lookup crash or a fabricated label', () => {
    expect(activityActorLabel({ isSystemGenerated: false, actorRoleKey: 'custom-vendor-role' })).toBe('custom-vendor-role');
  });
});
