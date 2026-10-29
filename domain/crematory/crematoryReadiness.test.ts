import { describe, expect, it } from 'vitest';
import { evaluateCrematoryReadiness, type CrematoryReadinessInput } from './crematoryReadiness';

const ready: CrematoryReadinessInput = {
  caseType: 'cremation',
  isArchived: false,
  sentAt: null,
  workflow2Complete: true,
  permit: { documentId: 'permit-1', checksumSha256: 'a'.repeat(64), mimeType: 'application/pdf' },
  currentPermitCount: 1,
  permitVerification: { documentId: 'permit-1', checksumSha256: 'a'.repeat(64) },
  arrangementForm: { createdAt: '2026-10-20T10:00:00.000Z' },
  crematoryForm: { createdAt: '2026-10-21T10:00:00.000Z' },
  packageNameConfirmed: true,
  readyDate: { suggested: '11/06/2026', confirmed: { date: '11/06/2026', suggestedAtConfirmation: '11/06/2026' } },
  package: { fileName: 'Reynolds_Richard_11-06-2026.pdf', current: true },
  canSend: true,
};
const failing = (input: CrematoryReadinessInput) => evaluateCrematoryReadiness(input).requirements.filter((r) => !r.ok).map((r) => [r.key, r.detail]);

describe('evaluateCrematoryReadiness', () => {
  it('a case with everything in place is ready to build and to send', () => {
    expect(evaluateCrematoryReadiness(ready)).toMatchObject({ readyToBuild: true, readyToSend: true });
  });

  it('only cremation cases, never archived ones', () => {
    expect(failing({ ...ready, caseType: 'burial' })).toEqual([['cremation', 'Only cremation cases are sent to the crematory.']]);
    expect(failing({ ...ready, isArchived: true })).toEqual([['cremation', 'This case is archived.']]);
  });

  it('the permit must be uploaded as a PDF and confirmed — and re-confirmed if a different file replaces it', () => {
    expect(failing({ ...ready, permit: null, permitVerification: null }).map(([k]) => k)).toEqual(['permit_uploaded', 'permit_verified']);
    expect(failing({ ...ready, permitVerification: null })).toEqual([['permit_verified', 'Confirm the uploaded permit is the approved permit for this decedent.']]);
    expect(failing({ ...ready, permit: { ...ready.permit!, documentId: 'permit-2', checksumSha256: 'b'.repeat(64) } })).toEqual([
      ['permit_verified', 'A different permit was uploaded since it was confirmed. Confirm the new one.'],
    ]);
    expect(failing({ ...ready, permit: { ...ready.permit!, mimeType: 'image/jpeg' } })).toEqual([['permit_uploaded', 'The state permit must be a PDF.']]);
  });

  it('two current permits are a conflict for staff to resolve — never ready, even if the newest is confirmed', () => {
    expect(failing({ ...ready, currentPermitCount: 2 })).toEqual([
      ['permit_uploaded', '2 state permits are current on this case. Choose the one to use; the others are kept as earlier versions.'],
    ]);
    expect(evaluateCrematoryReadiness({ ...ready, currentPermitCount: 2 })).toMatchObject({ readyToBuild: false, readyToSend: false });
  });

  it('page 3 must be extracted from the latest Arrangement Form', () => {
    expect(failing({ ...ready, crematoryForm: null })).toEqual([['crematory_form', 'Extract the Crematory Form (page 3) from the Arrangement Form.']]);
    expect(failing({ ...ready, crematoryForm: null, arrangementForm: null })).toEqual([['crematory_form', 'The completed Arrangement Form has not been received yet.']]);
    expect(failing({ ...ready, arrangementForm: { createdAt: '2026-10-22T10:00:00.000Z' } })).toEqual([['crematory_form', 'A newer Arrangement Form arrived. Extract the Crematory Form again.']]);
  });

  it('the name for the file must be confirmed by staff — never taken from the full name', () => {
    expect(failing({ ...ready, packageNameConfirmed: false })).toEqual([
      ['package_name', "Enter or confirm the decedent's last name and first name(s) exactly as they should appear in the file name."],
    ]);
  });

  it('a case already sent can never be sent again', () => {
    expect(evaluateCrematoryReadiness({ ...ready, sentAt: '2026-10-28T15:00:00.000Z' })).toMatchObject({ readyToBuild: true, readyToSend: false });
    expect(failing({ ...ready, sentAt: '2026-10-28T15:00:00.000Z' })).toEqual([['not_sent', 'Already sent to the crematory. Each case is sent only once.']]);
  });

  it('workflow 2 must be complete', () => {
    expect(failing({ ...ready, workflow2Complete: false }).map(([k]) => k)).toEqual(['workflow_2']);
  });

  it('the expected ready date must be confirmed by staff, and reviewed again if the Expected Pickup moves — never assumed', () => {
    expect(failing({ ...ready, readyDate: { suggested: '11/06/2026', confirmed: null } })).toEqual([['ready_date', 'Enter or confirm the expected cremation ready date.']]);
    expect(failing({ ...ready, readyDate: { suggested: '11/10/2026', confirmed: { date: '11/06/2026', suggestedAtConfirmation: '11/06/2026' } } })).toEqual([
      ['ready_date', 'The Expected Pickup changed since 11/06/2026 was confirmed. Review the expected ready date.'],
    ]);
    // Staff may confirm a date different from the Expected Pickup.
    expect(failing({ ...ready, readyDate: { suggested: '11/06/2026', confirmed: { date: '11/09/2026', suggestedAtConfirmation: '11/06/2026' } } })).toEqual([]);
  });

  it('a stale or missing package blocks sending but not building; so does missing permission', () => {
    expect(evaluateCrematoryReadiness({ ...ready, package: { fileName: 'x.pdf', current: false } })).toMatchObject({ readyToBuild: true, readyToSend: false });
    expect(failing({ ...ready, package: null })).toEqual([['package', 'Build the Crematory Package.']]);
    expect(evaluateCrematoryReadiness({ ...ready, canSend: false })).toMatchObject({ readyToBuild: true, readyToSend: false });
  });
});
