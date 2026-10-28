import { describe, expect, it } from 'vitest';
import { decideNokRelationshipAutofill, sameContactName } from './nokRelationshipAutofill';
import { deriveArrangementNextOfKin } from './arrangementNokDerivation';

describe('decideNokRelationshipAutofill', () => {
  const blank = { nextOfKinName: 'CARLA FAIRWEATHER', nextOfKinRelationship: null };
  const form = { nextOfKinName: 'Carla Fairweather', nextOfKinRelationship: 'daughter', nextOfKinRelationshipSource: 'Daughter' };

  it('applies an exact option to a blank relationship for the same person', () => {
    expect(decideNokRelationshipAutofill(blank, form)).toEqual({ action: 'apply', relationship: 'daughter', source: 'Daughter' });
  });
  it('keeps whatever the case already has', () => {
    expect(decideNokRelationshipAutofill({ ...blank, nextOfKinRelationship: 'son' }, form)).toEqual({ action: 'keep', current: 'son', source: 'Daughter', differs: true });
  });
  it('flags an unmapped value, a different person, or no contact on the case', () => {
    expect(decideNokRelationshipAutofill(blank, { nextOfKinName: 'Carla Fairweather', nextOfKinRelationshipSource: 'Cousin' })).toMatchObject({ action: 'review', reason: 'unmapped_value', source: 'Cousin' });
    expect(decideNokRelationshipAutofill(blank, { ...form, nextOfKinName: 'Theo Fairweather' })).toMatchObject({ action: 'review', reason: 'different_person' });
    expect(decideNokRelationshipAutofill({ nextOfKinName: '', nextOfKinRelationship: null }, form)).toMatchObject({ action: 'review', reason: 'no_case_contact' });
  });
  it('does nothing when the form gives no relationship', () => {
    expect(decideNokRelationshipAutofill(blank, { nextOfKinName: 'Carla Fairweather' })).toEqual({ action: 'none' });
  });
  it('compares names ignoring only capitals, spacing and punctuation', () => {
    expect(sameContactName('CARLA  FAIRWEATHER', 'Carla Fairweather')).toBe(true);
    expect(sameContactName("Carla O'Neil", 'CARLA ONEIL')).toBe(false);
    expect(sameContactName("Carla O'Neil", 'carla o neil')).toBe(true);
    expect(sameContactName('Carla J Fairweather', 'Carla Fairweather')).toBe(false);
  });
});

describe('deriveArrangementNextOfKin keeps the submitted relationship text', () => {
  const answers = (extra: Record<string, unknown>) => Object.fromEntries(Object.entries(extra).map(([qid, answer]) => [qid, { answer }])) as never;
  it('on the Yes path (qid 225) and the No path (qid 279), mapped or not', () => {
    expect(deriveArrangementNextOfKin(answers({ '276': 'Yes' }), { informantName: 'A B', informantPhone: null, informantRelationship: 'Legal Representative' })).toMatchObject({
      nextOfKinRelationship: 'legal_representative',
      nextOfKinRelationshipSource: 'Legal Representative',
    });
    const unknown = deriveArrangementNextOfKin(answers({ '276': 'No', '277': { first: 'C', last: 'D' }, '279': 'Cousin' }), { informantName: null, informantPhone: null, informantRelationship: null });
    expect(unknown.nextOfKinRelationshipSource).toBe('Cousin');
    expect(unknown.nextOfKinRelationship).toBeUndefined();
  });
  it('never on a missing or malformed branch answer', () => {
    expect(deriveArrangementNextOfKin(answers({}), { informantName: 'A B', informantPhone: null, informantRelationship: 'Daughter' }).nextOfKinRelationshipSource).toBeUndefined();
  });
});
