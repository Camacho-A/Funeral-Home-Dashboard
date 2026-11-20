import { describe, expect, it } from 'vitest';
import { crematoryReleaseGate } from './releaseForCremation';
import { getRegisteredOrganizationProfile, GUS_CAMACHO_ORGANIZATION_ID, MANORS_ORGANIZATION_ID } from '../organization/organizationProfiles';
import { SERVICE_TYPE_CODES } from '../workflow/serviceWorkflows';
import { MASS_PREPARATION } from './serviceDefinitions';
import type { Case } from '../../types/case';
import type { ServicePreparationRecord } from './types';

/** The Send to Crematory release gate (Gus Phase 5K) — which cases it covers, and that it is off everywhere today. */
const caseOf = (serviceTypeCode: string | null, servicePreparation: ServicePreparationRecord | null = null) =>
  ({ workflowSnapshot: serviceTypeCode ? ({ serviceTypeCode } as Case['workflowSnapshot']) : null, servicePreparation }) as Pick<Case, 'workflowSnapshot' | 'servicePreparation'>;
const record = (definitionKey: string, extra: Partial<ServicePreparationRecord> = {}): ServicePreparationRecord => ({
  definitionKey,
  definitionVersion: 1,
  serviceAppointmentId: null,
  choices: {},
  details: {},
  items: {},
  ...extra,
});

describe('crematoryReleaseGate', () => {
  it('not enforced: never applies', () => {
    expect(crematoryReleaseGate(caseOf(SERVICE_TYPE_CODES.CREMATION_WITH_VIEWING), false)).toBeNull();
  });

  it('enforced: Viewing and Final Goodbye wait for their release; Direct Cremation never', () => {
    expect(crematoryReleaseGate(caseOf(SERVICE_TYPE_CODES.CREMATION_WITH_VIEWING), true)).toEqual({ serviceName: 'Viewing', released: false, undecided: false, onHold: false, holdReason: null });
    expect(crematoryReleaseGate(caseOf(SERVICE_TYPE_CODES.DIRECT_CREMATION), true)).toBeNull();
    expect(crematoryReleaseGate(caseOf(null), true)).toBeNull();
  });

  it('a recorded release satisfies it', () => {
    const released = record('prep.viewing', { release: { releasedAt: '2026-12-11T15:00:00.000Z', releasedBy: 'identity-gus-director', releasedByName: 'Jordan Demo', roleKey: 'funeralDirector' } });
    expect(crematoryReleaseGate(caseOf(SERVICE_TYPE_CODES.CREMATION_WITH_VIEWING, released), true)!.released).toBe(true);
  });

  it('a release recorded for a different service does not count', () => {
    const other = record('prep.final_goodbye', { release: { releasedAt: 'x', releasedBy: 'y', releasedByName: null, roleKey: 'funeralDirector' } });
    expect(crematoryReleaseGate(caseOf(SERVICE_TYPE_CODES.CREMATION_WITH_VIEWING, other), true)!.released).toBe(false);
  });

  it('Mass (draft): undecided "body present?" is treated as waiting', () => {
    // Mass is not offered as a service type yet; its draft definition carries its own code.
    expect(crematoryReleaseGate(caseOf(MASS_PREPARATION.serviceTypeCode, record(MASS_PREPARATION.key)), true)).toMatchObject({ undecided: true, released: false });
  });

  it('is OFF for Gus and Manors today', () => {
    expect(getRegisteredOrganizationProfile(GUS_CAMACHO_ORGANIZATION_ID).features.sendToCrematory?.requireReleaseAfterService).toBe(false);
    expect(getRegisteredOrganizationProfile(MANORS_ORGANIZATION_ID).features.sendToCrematory?.requireReleaseAfterService).toBeUndefined();
  });
});
