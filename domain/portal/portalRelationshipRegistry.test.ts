import { describe, expect, it } from 'vitest';
import { PORTAL_RELATIONSHIP_TYPES, isValidPortalRelationshipType } from './portalRelationshipRegistry';

describe('PORTAL_RELATIONSHIP_TYPES', () => {
  it('includes all four implemented relationship types', () => {
    const implemented = Object.entries(PORTAL_RELATIONSHIP_TYPES)
      .filter(([, v]) => v.implemented)
      .map(([key]) => key);
    expect(implemented.sort()).toEqual(['authorized_representative', 'executor', 'primary_next_of_kin', 'secondary_family_member'].sort());
  });

  it('reserves five relationship types with implemented:false', () => {
    const reserved = Object.entries(PORTAL_RELATIONSHIP_TYPES)
      .filter(([, v]) => !v.implemented)
      .map(([key]) => key);
    expect(reserved.sort()).toEqual(['attorney', 'insurance_adjuster', 'veteran_representative', 'church_representative', 'funeral_home_partner'].sort());
  });

  it("every entry's displayName is never derived from its own key", () => {
    for (const [key, entry] of Object.entries(PORTAL_RELATIONSHIP_TYPES)) {
      expect(entry.displayName).not.toBe(key);
      expect(entry.displayName).not.toContain('_');
    }
  });
});

describe('isValidPortalRelationshipType', () => {
  it('accepts every registered key', () => {
    for (const key of Object.keys(PORTAL_RELATIONSHIP_TYPES)) {
      expect(isValidPortalRelationshipType(key)).toBe(true);
    }
  });

  it('rejects an unrecognized value', () => {
    expect(isValidPortalRelationshipType('random_uncle')).toBe(false);
    expect(isValidPortalRelationshipType(null)).toBe(false);
  });
});
