import { describe, expect, it } from 'vitest';
import { MANORS_ORGANIZATION_ID } from '../organization/organizationProfiles';
import { officialDocumentsToRegenerate } from './officialDocumentTriggers';

const base = {
  organizationId: MANORS_ORGANIZATION_ID,
  decedentName: 'LOUIS BARBER',
  decedentMiddleName: 'ANTHONY',
  tagNumber: 'MC-1',
  dateOfDeath: '10/09/2026',
  dateOfCremation: null as string | null,
  isDeleted: false,
};

describe('officialDocumentsToRegenerate', () => {
  it('a new Manors case gets its envelope; the certificate waits for the date of cremation', () => {
    expect(officialDocumentsToRegenerate(null, base)).toEqual(['envelope']);
  });

  it('recording the date of cremation produces the certificate, and not another envelope', () => {
    expect(officialDocumentsToRegenerate(base, { ...base, dateOfCremation: '10/14/2026' })).toEqual(['certificate_of_cremation']);
  });

  it('a name change regenerates both once the certificate exists', () => {
    const cremated = { ...base, dateOfCremation: '10/14/2026' };
    expect(officialDocumentsToRegenerate(cremated, { ...cremated, decedentMiddleName: 'ANTONIO' })).toEqual(['envelope', 'certificate_of_cremation']);
  });

  it('a tag number or date of death change regenerates only the certificate', () => {
    const cremated = { ...base, dateOfCremation: '10/14/2026' };
    expect(officialDocumentsToRegenerate(cremated, { ...cremated, tagNumber: 'MC-2' })).toEqual(['certificate_of_cremation']);
    expect(officialDocumentsToRegenerate(cremated, { ...cremated, dateOfDeath: '10/10/2026' })).toEqual(['certificate_of_cremation']);
  });

  it('an unrelated save regenerates nothing', () => {
    const cremated = { ...base, dateOfCremation: '10/14/2026' };
    expect(officialDocumentsToRegenerate(cremated, { ...cremated })).toEqual([]);
  });

  it('never for an archived case, a nameless case, or an organization without these templates', () => {
    expect(officialDocumentsToRegenerate(null, { ...base, isDeleted: true })).toEqual([]);
    expect(officialDocumentsToRegenerate(null, { ...base, decedentName: '  ' })).toEqual([]);
    expect(officialDocumentsToRegenerate(null, { ...base, organizationId: 'some-other-home' })).toEqual([]);
  });
});
