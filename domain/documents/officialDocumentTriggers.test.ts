import { describe, expect, it } from 'vitest';
import { MANORS_ORGANIZATION_ID } from '../organization/organizationProfiles';
import { envelopeTrigger, isSentToCrematory, missingOfficialDocumentFields, officialDocumentsToRegenerate } from './officialDocumentTriggers';
import { crematorySentChecklistKeys } from '../crematory/sentChecklistItems';
import { caseFixtures } from '../../services/__mocks__/fixtures';
import type { Case } from '../../types/case';

/** A real Manors workflow snapshot, so Workflow 3's two "sent to crematory" items exist. */
const manorsSnapshot = caseFixtures.find((c) => c.organizationId === MANORS_ORGANIZATION_ID && c.workflowSnapshot)!.workflowSnapshot;

const base = {
  organizationId: MANORS_ORGANIZATION_ID,
  decedentName: 'LOUIS BARBER',
  decedentMiddleName: 'ANTHONY',
  tagNumber: null as string | null,
  dateOfDeath: '10/09/2026',
  dateOfCremation: null as string | null,
  isDeleted: false,
  workflowSnapshot: manorsSnapshot,
  checklistState: {} as Case['checklistState'],
};
const SENT_KEYS = crematorySentChecklistKeys(base);
/** Both "sent to crematory" items checked. */
const sent = <T extends typeof base>(c: T): T => ({ ...c, checklistState: { ...c.checklistState, ...Object.fromEntries(SENT_KEYS.map((k) => [k, true])) } });

describe('officialDocumentsToRegenerate', () => {
  it('creating a case does not produce an envelope by itself', () => {
    expect(officialDocumentsToRegenerate(null, base)).toEqual([]);
  });

  it('Manors cases have the two "sent to crematory" items the Envelope follows', () => {
    expect(SENT_KEYS).toHaveLength(2);
    expect(isSentToCrematory(base)).toBe(false);
    expect(isSentToCrematory({ ...base, checklistState: { [SENT_KEYS[0]]: true } })).toBe(false);
    expect(isSentToCrematory(sent(base))).toBe(true);
  });

  it('sending the case to the crematory produces the envelope — no Tag Number needed (2026-11)', () => {
    expect(base.tagNumber).toBeNull();
    expect(officialDocumentsToRegenerate(base, sent(base))).toEqual(['envelope']);
    expect(envelopeTrigger(base, sent(base))).toBe('sent_to_crematory');
    // Only one of the two items checked is not "sent" yet.
    expect(officialDocumentsToRegenerate(base, { ...base, checklistState: { [SENT_KEYS[0]]: true } })).toEqual([]);
  });

  it('saving or changing a Tag Number no longer produces the envelope', () => {
    expect(officialDocumentsToRegenerate(base, { ...base, tagNumber: 'MC-1042' })).toEqual([]);
    const tagged = { ...base, tagNumber: 'MC-1042' };
    expect(officialDocumentsToRegenerate(tagged, { ...tagged, tagNumber: 'MC-2000' })).toEqual([]);
    expect(officialDocumentsToRegenerate(null, tagged)).toEqual([]);
  });

  it('a save on a case already sent is no new trigger; a case created already sent gets its envelope', () => {
    expect(envelopeTrigger(sent(base), { ...sent(base), dateOfDeath: '10/10/2026' })).toBeNull();
    expect(envelopeTrigger(null, sent(base))).toBe('sent_to_crematory');
  });

  it('a name change is an Envelope trigger with or without a Tag Number (the service decides whether one is due)', () => {
    expect(officialDocumentsToRegenerate(base, { ...base, decedentMiddleName: 'ANTONIO' })).toEqual(['envelope']);
    expect(envelopeTrigger(base, { ...base, decedentMiddleName: 'ANTONIO' })).toBe('name_changed');
    const tagged = { ...base, tagNumber: 'MC-1042' };
    expect(officialDocumentsToRegenerate(tagged, { ...tagged, decedentMiddleName: 'ANTONIO' })).toEqual(['envelope']);
  });

  it('a case not sent to the crematory gets no Envelope automatically; an unrelated save is no trigger', () => {
    expect(envelopeTrigger(null, base)).toBeNull();
    expect(envelopeTrigger(base, { ...base, dateOfDeath: '10/10/2026' })).toBeNull();
    expect(envelopeTrigger(null, { ...base, tagNumber: 'MC-1' })).toBeNull();
    expect(envelopeTrigger(base, sent({ ...base, decedentName: ' ' }))).toBeNull();
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

  it('a date of cremation alone does not produce a certificate without a Tag Number and date of death', () => {
    expect(officialDocumentsToRegenerate(base, { ...base, dateOfCremation: '10/14/2026' })).toEqual([]);
    const tagged = { ...base, tagNumber: 'MC-1042', dateOfDeath: '' };
    expect(officialDocumentsToRegenerate(tagged, { ...tagged, dateOfCremation: '10/14/2026' })).toEqual([]);
    // Saving the missing Tag Number afterwards produces the certificate (the Envelope follows the send).
    const cremated = { ...base, dateOfCremation: '10/14/2026' };
    expect(officialDocumentsToRegenerate(cremated, { ...cremated, tagNumber: 'MC-1042' })).toEqual(['certificate_of_cremation']);
  });
});

describe('missingOfficialDocumentFields', () => {
  it('lists what each document still needs, in plain words', () => {
    expect(missingOfficialDocumentFields('certificate_of_cremation', base)).toEqual(['Tag Number', 'Date of Cremation']);
    expect(missingOfficialDocumentFields('certificate_of_cremation', { ...base, decedentName: '', dateOfDeath: '02/30/2026' })).toEqual([
      "Decedent's name",
      'Tag Number',
      'Date of Death',
      'Date of Cremation',
    ]);
    // The Envelope needs only the name; the Certificate still needs the Tag Number.
    expect(missingOfficialDocumentFields('envelope', base)).toEqual([]);
    expect(missingOfficialDocumentFields('envelope', { ...base, decedentName: '' })).toEqual(["Decedent's name"]);
    expect(missingOfficialDocumentFields('envelope', { ...base, tagNumber: 'MC-1' })).toEqual([]);
    expect(missingOfficialDocumentFields('certificate_of_cremation', { ...base, tagNumber: 'MC-1', dateOfCremation: '10/14/2026' })).toEqual([]);
  });
});
