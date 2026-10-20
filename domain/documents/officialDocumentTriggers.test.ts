import { describe, expect, it } from 'vitest';
import { MANORS_ORGANIZATION_ID } from '../organization/organizationProfiles';
import { officialDocumentsToRegenerate } from './officialDocumentTriggers';

const base = {
  organizationId: MANORS_ORGANIZATION_ID,
  decedentName: 'LOUIS BARBER',
  decedentMiddleName: 'ANTHONY',
  tagNumber: null as string | null,
  dateOfDeath: '10/09/2026',
  dateOfCremation: null as string | null,
  isDeleted: false,
};

describe('officialDocumentsToRegenerate', () => {
  it('creating a case does not produce an envelope by itself', () => {
    expect(officialDocumentsToRegenerate(null, base)).toEqual([]);
  });

  it('saving a valid Tag Number produces the envelope', () => {
    expect(officialDocumentsToRegenerate(base, { ...base, tagNumber: 'MC-1042' })).toEqual(['envelope']);
  });

  it('a case created with a Tag Number already saved gets its envelope', () => {
    expect(officialDocumentsToRegenerate(null, { ...base, tagNumber: 'MC-1042' })).toEqual(['envelope']);
  });

  it('a blank or placeholder Tag Number is not valid', () => {
    expect(officialDocumentsToRegenerate(base, { ...base, tagNumber: '   ' })).toEqual([]);
    expect(officialDocumentsToRegenerate(base, { ...base, tagNumber: '—' })).toEqual([]);
  });

  it('changing the Tag Number regenerates the envelope; re-saving the same one (any case or spacing) does not', () => {
    const tagged = { ...base, tagNumber: 'MC-1042' };
    expect(officialDocumentsToRegenerate(tagged, { ...tagged, tagNumber: 'MC-2000' })).toEqual(['envelope']);
    expect(officialDocumentsToRegenerate(tagged, { ...tagged, tagNumber: ' mc-1042 ' })).toEqual([]);
  });

  it('a name change regenerates the envelope only once a Tag Number exists', () => {
    expect(officialDocumentsToRegenerate(base, { ...base, decedentMiddleName: 'ANTONIO' })).toEqual([]);
    const tagged = { ...base, tagNumber: 'MC-1042' };
    expect(officialDocumentsToRegenerate(tagged, { ...tagged, decedentMiddleName: 'ANTONIO' })).toEqual(['envelope']);
  });

  it('recording the date of cremation produces the certificate, and not another envelope', () => {
    const tagged = { ...base, tagNumber: 'MC-1042' };
    expect(officialDocumentsToRegenerate(tagged, { ...tagged, dateOfCremation: '10/14/2026' })).toEqual(['certificate_of_cremation']);
  });

  it('with a Tag Number and a date of cremation, a name change regenerates both', () => {
    const cremated = { ...base, tagNumber: 'MC-1042', dateOfCremation: '10/14/2026' };
    expect(officialDocumentsToRegenerate(cremated, { ...cremated, decedentMiddleName: 'ANTONIO' })).toEqual(['envelope', 'certificate_of_cremation']);
  });

  it('a date of death change regenerates only the certificate', () => {
    const cremated = { ...base, tagNumber: 'MC-1042', dateOfCremation: '10/14/2026' };
    expect(officialDocumentsToRegenerate(cremated, { ...cremated, dateOfDeath: '10/10/2026' })).toEqual(['certificate_of_cremation']);
  });

  it('an unrelated save regenerates nothing', () => {
    const cremated = { ...base, dateOfCremation: '10/14/2026' };
    expect(officialDocumentsToRegenerate(cremated, { ...cremated })).toEqual([]);
  });

  it('never for an archived case, a nameless case, or an organization without these templates', () => {
    const tagged = { ...base, tagNumber: 'MC-1042' };
    expect(officialDocumentsToRegenerate(null, { ...tagged, isDeleted: true })).toEqual([]);
    expect(officialDocumentsToRegenerate(null, { ...tagged, decedentName: '  ' })).toEqual([]);
    expect(officialDocumentsToRegenerate(null, { ...tagged, organizationId: 'some-other-home' })).toEqual([]);
  });
});
