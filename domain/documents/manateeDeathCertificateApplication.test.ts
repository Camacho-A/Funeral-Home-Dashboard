import { describe, expect, it } from 'vitest';
import {
  MANATEE_FIELDS,
  dateOfDeathParts,
  fedexEntries,
  formatMoney,
  manateeFees,
  manateeFieldValues,
  manateeIssues,
  maskSsn,
  normalizeSsn,
  relationshipForForm,
  sexForForm,
  type ManateeApplicationValues,
} from './manateeDeathCertificateApplication';

/** Fictional throughout. 000-xx-xxxx SSNs are never issued. */
const complete = (overrides: Partial<ManateeApplicationValues> = {}): ManateeApplicationValues => ({
  decedentFirst: 'Mary Ann',
  decedentMiddle: 'Louise',
  decedentLast: 'Salas Rueda',
  decedentSex: 'F',
  ssn: '000-12-3456',
  ssnNotKnown: false,
  dateOfDeath: '10/04/2026',
  placeOfDeathCity: 'Pembroke Pines',
  placeOfDeathCounty: 'Broward',
  spouseFirst: 'Jonathan',
  spouseMiddle: '',
  spouseLast: 'Salas Rueda',
  representedName: 'Teresa Salas Rueda',
  representedRelationship: 'Daughter',
  withCause: 2,
  withoutCause: 3,
  fedexFee: false,
  requestNumber: '',
  requestOf: '',
  ...overrides,
});

describe('fees — $8.00 per certificate, $15.00 FedEx only when confirmed', () => {
  it('totals each line and the grand total, to the cent', () => {
    expect(manateeFees(2, 3, false)).toEqual({ withCauseTotalCents: 1600, withoutCauseTotalCents: 2400, fedexCents: 0, grandTotalCents: 4000 });
    expect(manateeFees(2, 3, true).grandTotalCents).toBe(5500);
    expect(manateeFees(0, 1, true).grandTotalCents).toBe(2300);
    expect(manateeFees(99, 99, true).grandTotalCents).toBe(99 * 800 * 2 + 1500);
  });

  it('prints totals in the form\'s own format, two decimals, no $', () => {
    expect(formatMoney(0)).toBe('0.00');
    expect(formatMoney(800)).toBe('8.00');
    expect(formatMoney(5500)).toBe('55.00');
    expect(formatMoney(160_805)).toBe('1608.05');
  });

  it('the FedEx row: "1" and "15.00" only with the fee confirmed, otherwise blank', () => {
    expect(fedexEntries(true)).toEqual({ quantity: '1', total: '15.00' });
    expect(fedexEntries(false)).toBeNull();
  });

  it('the FedEx fee is never assumed', () => {
    const values = manateeFieldValues(complete());
    expect(values[MANATEE_FIELDS.grandTotal]).toBe('40.00');
    expect(manateeFieldValues(complete({ fedexFee: true }))[MANATEE_FIELDS.grandTotal]).toBe('55.00');
  });
});

describe('field values', () => {
  it('maps every requested field, keeping middle names and multi-word surnames whole', () => {
    expect(manateeFieldValues(complete())).toEqual({
      'First Name': 'MARY ANN',
      Middle: 'LOUISE',
      Last: 'SALAS RUEDA',
      Suffix2: 'F',
      SS: '000-12-3456',
      Month: '10',
      Day: '4',
      Year: '2026',
      'Place of Death': 'PEMBROKE PINES',
      County: 'BROWARD',
      'First Name2': 'JONATHAN',
      Middle2: '',
      Last2: 'SALAS RUEDA',
      Represented: 'TERESA SALAS RUEDA',
      Relationship: 'Daughter',
      Text1: '2',
      Text2: '3',
      Text3: '16.00',
      Text4: '24.00',
      Text8: '40.00',
    });
  });

  it('the Request boxes are left out unless staff typed both numbers — never the certificate quantities', () => {
    const blank = manateeFieldValues(complete());
    expect(blank).not.toHaveProperty('1 OF');
    expect(blank).not.toHaveProperty('of');
    expect(manateeFieldValues(complete({ requestNumber: '1', requestOf: '2' }))).toMatchObject({ '1 OF': '1', of: '2' });
  });

  it('an SSN marked not known leaves the box blank', () => {
    expect(manateeFieldValues(complete({ ssn: null, ssnNotKnown: true })).SS).toBe('');
  });

  it('never touches the prefilled applicant, prices or funeral home', () => {
    const keys = Object.keys(manateeFieldValues(complete()));
    for (const prefilled of ['First, Last, Middle', 'CA Relationship', 'License', 'City2', 'State2', 'Zip2', 'price1', 'price2', 'Text5', 'FuneralHome DBA 2', 'Range of Years']) {
      expect(keys).not.toContain(prefilled);
    }
  });
});

describe('dates, SSNs, county and relationship', () => {
  it('splits the date of death into the form\'s unpadded Month / Day / Year', () => {
    expect(dateOfDeathParts('01/09/2026')).toEqual({ month: '1', day: '9', year: '2026' });
    expect(dateOfDeathParts('2026-12-31')).toEqual({ month: '12', day: '31', year: '2026' });
    expect(dateOfDeathParts('02/30/2026')).toBeNull();
    expect(dateOfDeathParts('')).toBeNull();
  });

  it('normalizes and masks SSNs', () => {
    expect(normalizeSsn('000123456')).toBe('000-12-3456');
    expect(normalizeSsn('000 12 3456')).toBe('000-12-3456');
    expect(normalizeSsn('12345')).toBeNull();
    expect(maskSsn('000-12-3456')).toBe('•••-••-3456');
    expect(maskSsn(null)).toBeNull();
  });

  it('words the relationship as the form does, and leaves gendered ones to staff', () => {
    expect(relationshipForForm('spouse', null)).toBe('Spouse');
    expect(relationshipForForm('daughter', null)).toBe('Daughter');
    expect(relationshipForForm('legal_representative', null)).toBe('Legal Representative');
    expect(relationshipForForm('other', 'Stepdaughter')).toBe('Stepdaughter');
    expect(relationshipForForm('parent', null)).toBeNull();
    expect(relationshipForForm('grandchild', null)).toBeNull();
    expect(relationshipForForm(null, null)).toBeNull();
  });
});

describe('review — nothing is made from missing or guessed information', () => {
  it('a complete application has no issues', () => {
    expect(manateeIssues(complete())).toEqual([]);
  });

  it('flags every missing required value', () => {
    const fields = manateeIssues(
      complete({ decedentFirst: '', decedentLast: ' ', decedentSex: '', ssn: null, dateOfDeath: '', placeOfDeathCity: '', placeOfDeathCounty: '', representedName: '', representedRelationship: '' }),
    ).map((i) => i.field);
    expect(fields).toEqual(['decedentFirst', 'decedentLast', 'decedentSex', 'ssn', 'dateOfDeath', 'placeOfDeathCity', 'placeOfDeathCounty', 'representedName', 'representedRelationship']);
  });

  it('sex: the forms\' Male / Female as the form\'s F / M; anything else is left for staff', () => {
    expect(['Female', ' male ', 'MALE', 'Unknown', '', null, undefined, 3].map(sexForForm)).toEqual(['F', 'M', 'M', '', '', '', '', '']);
    expect(manateeFieldValues(complete({ decedentSex: 'M' }))[MANATEE_FIELDS.decedentSex]).toBe('M');
  });

  it('a spouse is optional, but a partial spouse name is flagged', () => {
    expect(manateeIssues(complete({ spouseFirst: '', spouseLast: '' }))).toEqual([]);
    expect(manateeIssues(complete({ spouseLast: '' })).map((i) => i.field)).toEqual(['spouseLast']);
  });

  it('quantities are whole numbers from 0 to 99, and at least one certificate is ordered', () => {
    expect(manateeIssues(complete({ withCause: -1 })).map((i) => i.field)).toEqual(['withCause']);
    expect(manateeIssues(complete({ withoutCause: 1.5 })).map((i) => i.field)).toEqual(['withoutCause']);
    expect(manateeIssues(complete({ withCause: 100 })).map((i) => i.field)).toEqual(['withCause']);
    expect(manateeIssues(complete({ withCause: 0, withoutCause: 0 })).map((i) => i.message)).toEqual(['Order at least one death certificate.']);
  });

  it('Request ___ of ___: both numbers, the first no larger than the second — or both blank', () => {
    expect(manateeIssues(complete({ requestNumber: '1', requestOf: '2' }))).toEqual([]);
    expect(manateeIssues(complete({ requestNumber: '1' })).map((i) => i.field)).toEqual(['requestNumber']);
    expect(manateeIssues(complete({ requestNumber: '3', requestOf: '2' })).map((i) => i.field)).toEqual(['requestNumber']);
    expect(manateeIssues(complete({ requestNumber: '0', requestOf: '2' })).map((i) => i.field)).toEqual(['requestNumber']);
  });

  it('issue messages never contain the SSN', () => {
    const messages = manateeIssues(complete({ ssn: '000-12-345' })).map((i) => i.message).join(' ');
    expect(messages).not.toMatch(/\d{3}-\d{2}/);
  });
});
