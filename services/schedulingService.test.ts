import { readdirSync, readFileSync, statSync } from 'fs';
import { extname, join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/puppeteerDocumentRenderer', () => ({
  puppeteerDocumentRenderer: { renderHtmlToPdf: async () => Buffer.from('%PDF-1.4 fake') },
}));
vi.mock('@/lib/vercelBlob/vercelBlobStorageProvider', () => ({
  vercelBlobStorageProvider: {
    uploadFile: async (key: string) => ({ storageKey: key }),
    downloadFile: async () => ({ buffer: Buffer.from('%PDF-1.4 fake'), contentType: 'application/pdf' }),
    deleteFile: async () => undefined,
  },
}));

import {
  createAppointment,
  rescheduleAppointment,
  updateAppointmentResources,
  confirmAppointment,
  startAppointment,
  completeAppointment,
  cancelAppointment,
  createWitnessSignatureRequest,
  listAppointments,
  listAppointmentsForCase,
  getAppointment,
  listResourceAssignments,
  SchedulingServiceError,
} from './schedulingService';
import { create as createResource } from './resourceService';
import { appointmentFixtures, appointmentResourceAssignmentFixtures, resourceFixtures, recurrenceDefinitionFixtures } from './__mocks__/schedulingFixtures';
import { activityEventFixtures } from './__mocks__/activityEventFixtures';
import { caseDocumentFixtures, documentTemplateFixtures, signatureRequestFixtures, signatureRecordFixtures } from './__mocks__/documentFixtures';
import { caseFixtures } from './__mocks__/fixtures';
import { notificationFixtures, notificationRecipientFixtures } from './__mocks__/notificationFixtures';
import { DEFAULT_ORGANIZATION_ID, SECOND_MOCK_ORGANIZATION_ID } from './__mocks__/organizationIds';
import type { ActivityContext } from './activityService';

let idCounter = 0;
function idFactory() {
  idCounter += 1;
  return `id-${idCounter}`;
}

function ctx(overrides: Partial<ActivityContext> = {}): ActivityContext {
  return {
    organizationId: DEFAULT_ORGANIZATION_ID,
    actorIdentityId: 'identity-1',
    actorMembershipId: 'membership-1',
    actorRoleKey: 'manager',
    correlationId: 'corr-1',
    ...overrides,
  };
}

beforeEach(() => {
  idCounter = 0;
  appointmentFixtures.length = 0;
  appointmentResourceAssignmentFixtures.length = 0;
  resourceFixtures.length = 0;
  recurrenceDefinitionFixtures.length = 0;
  activityEventFixtures.length = 0;
  caseDocumentFixtures.length = 0;
  documentTemplateFixtures.length = 0;
  signatureRequestFixtures.length = 0;
  signatureRecordFixtures.length = 0;
  notificationFixtures.length = 0;
  notificationRecipientFixtures.length = 0;
});

afterEach(() => {
  appointmentFixtures.length = 0;
  appointmentResourceAssignmentFixtures.length = 0;
  resourceFixtures.length = 0;
  recurrenceDefinitionFixtures.length = 0;
  activityEventFixtures.length = 0;
  caseDocumentFixtures.length = 0;
  documentTemplateFixtures.length = 0;
  signatureRequestFixtures.length = 0;
  signatureRecordFixtures.length = 0;
  notificationFixtures.length = 0;
  notificationRecipientFixtures.length = 0;
});

async function makeChapel() {
  return createResource(DEFAULT_ORGANIZATION_ID, { resourceType: 'chapel', name: 'Main Chapel', idFactory }, 'mock');
}

describe('createAppointment', () => {
  it('creates a draft when no resources are assigned, without conflict-checking', async () => {
    const appointment = await createAppointment(
      { appointmentType: 'viewing', title: 'Viewing', startAt: '2026-09-01T14:00:00.000Z', endAt: '2026-09-01T15:00:00.000Z', timezone: 'America/New_York', idFactory },
      ctx(),
      'mock',
    );
    expect(appointment.status).toBe('draft');
  });

  it('creates a scheduled appointment and assigns every requested resource', async () => {
    const chapel = await makeChapel();
    const appointment = await createAppointment(
      {
        appointmentType: 'viewing',
        title: 'Viewing',
        startAt: '2026-09-01T14:00:00.000Z',
        endAt: '2026-09-01T15:00:00.000Z',
        timezone: 'America/New_York',
        resourceIds: [chapel.id],
        idFactory,
      },
      ctx(),
      'mock',
    );
    expect(appointment.status).toBe('scheduled');
    const assignments = await listResourceAssignments(DEFAULT_ORGANIZATION_ID, appointment.id, 'mock');
    expect(assignments).toHaveLength(1);
    expect(assignments[0].resourceId).toBe(chapel.id);
  });

  it('rejects a hard-conflicting appointment without an override', async () => {
    const chapel = await makeChapel();
    await createAppointment(
      { appointmentType: 'viewing', title: 'First', startAt: '2026-09-01T14:00:00.000Z', endAt: '2026-09-01T15:00:00.000Z', timezone: 'America/New_York', resourceIds: [chapel.id], idFactory },
      ctx(),
      'mock',
    );
    await expect(
      createAppointment(
        { appointmentType: 'viewing', title: 'Second', startAt: '2026-09-01T14:30:00.000Z', endAt: '2026-09-01T15:30:00.000Z', timezone: 'America/New_York', resourceIds: [chapel.id], idFactory },
        ctx(),
        'mock',
      ),
    ).rejects.toThrow(SchedulingServiceError);
  });

  it('accepts a hard-conflicting appointment with an override, and records the conflict override event', async () => {
    const chapel = await makeChapel();
    await createAppointment(
      { appointmentType: 'viewing', title: 'First', startAt: '2026-09-01T14:00:00.000Z', endAt: '2026-09-01T15:00:00.000Z', timezone: 'America/New_York', resourceIds: [chapel.id], idFactory },
      ctx(),
      'mock',
    );
    const second = await createAppointment(
      {
        appointmentType: 'viewing',
        title: 'Second',
        startAt: '2026-09-01T14:30:00.000Z',
        endAt: '2026-09-01T15:30:00.000Z',
        timezone: 'America/New_York',
        resourceIds: [chapel.id],
        override: { reason: 'Family requested this exact time' },
        idFactory,
      },
      ctx(),
      'mock',
    );
    expect(second.status).toBe('scheduled');
    expect(activityEventFixtures.some((e) => e.eventType === 'scheduling.resource.conflict_overridden')).toBe(true);
  });

  it('rejects an unrecognized appointment type', async () => {
    await expect(
      createAppointment({ appointmentType: 'not.a.real.type', title: 'x', startAt: '2026-09-01T14:00:00.000Z', endAt: '2026-09-01T15:00:00.000Z', timezone: 'America/New_York', idFactory }, ctx(), 'mock'),
    ).rejects.toThrow(SchedulingServiceError);
  });

  it('materializes a recurring appointment into independent, individually queryable occurrences', async () => {
    const first = await createAppointment(
      {
        appointmentType: 'staff.meeting',
        title: 'Weekly Standup',
        startAt: '2026-09-01T09:00:00.000Z',
        endAt: '2026-09-01T09:30:00.000Z',
        timezone: 'America/New_York',
        recurrence: { frequency: 'weekly', interval: 1, count: 4 },
        idFactory,
      },
      ctx(),
      'mock',
    );
    expect(first.recurrenceDefinitionId).not.toBeNull();
    const all = appointmentFixtures.filter((a) => a.recurrenceDefinitionId === first.recurrenceDefinitionId);
    expect(all).toHaveLength(4);
    expect(all.every((a) => a.isRecurrenceException === false)).toBe(true);
  });

  describe('Phase 30 (Identity Model Hardening & Staff Assignment Unification): ownerStaffProfileId', () => {
    it('accepts a real, active, in-organization ownerStaffProfileId, and notifies the owner', async () => {
      const appointment = await createAppointment(
        { appointmentType: 'viewing', title: 'Viewing', startAt: '2026-09-01T14:00:00.000Z', endAt: '2026-09-01T15:00:00.000Z', timezone: 'America/New_York', ownerStaffProfileId: 'staff-dana', idFactory },
        ctx(),
        'mock',
      );
      expect(appointment.ownerStaffProfileId).toBe('staff-dana');
      expect(notificationFixtures.some((n) => n.notificationType === 'scheduling.appointment_created')).toBe(true);
      expect(notificationRecipientFixtures.some((r) => r.identityId === 'identity-manors-admin')).toBe(true);
    });

    it('rejects a nonexistent ownerStaffProfileId', async () => {
      await expect(
        createAppointment(
          { appointmentType: 'viewing', title: 'Viewing', startAt: '2026-09-01T14:00:00.000Z', endAt: '2026-09-01T15:00:00.000Z', timezone: 'America/New_York', ownerStaffProfileId: 'staff-does-not-exist', idFactory },
          ctx(),
          'mock',
        ),
      ).rejects.toThrow(SchedulingServiceError);
    });

    it('rejects a deactivated ownerStaffProfileId', async () => {
      const { staffFixtures } = await import('./__mocks__/fixtures');
      const index = staffFixtures.findIndex((s) => s.id === 'staff-priya');
      const original = staffFixtures[index];
      staffFixtures[index] = { ...original, isActive: false };
      try {
        await expect(
          createAppointment(
            { appointmentType: 'viewing', title: 'Viewing', startAt: '2026-09-01T14:00:00.000Z', endAt: '2026-09-01T15:00:00.000Z', timezone: 'America/New_York', ownerStaffProfileId: 'staff-priya', idFactory },
            ctx(),
            'mock',
          ),
        ).rejects.toThrow(SchedulingServiceError);
      } finally {
        staffFixtures[index] = original;
      }
    });

    it("rejects when the caller lacks schedule.edit — never a StaffProfile.role check", async () => {
      await expect(
        createAppointment(
          { appointmentType: 'viewing', title: 'Viewing', startAt: '2026-09-01T14:00:00.000Z', endAt: '2026-09-01T15:00:00.000Z', timezone: 'America/New_York', ownerStaffProfileId: 'staff-dana', idFactory },
          ctx({ actorRoleKey: 'accounting' }),
          'mock',
        ),
      ).rejects.toThrow(SchedulingServiceError);
    });

    it('leaves ownerStaffProfileId null when not provided — an accepted, named gap (no owner is valid)', async () => {
      const appointment = await createAppointment(
        { appointmentType: 'viewing', title: 'Viewing', startAt: '2026-09-01T14:00:00.000Z', endAt: '2026-09-01T15:00:00.000Z', timezone: 'America/New_York', idFactory },
        ctx(),
        'mock',
      );
      expect(appointment.ownerStaffProfileId).toBeNull();
      expect(notificationFixtures).toHaveLength(0);
    });
  });
});

describe('rescheduleAppointment', () => {
  it('re-checks conflicts against the new time and updates the appointment + live assignments', async () => {
    const chapel = await makeChapel();
    const appointment = await createAppointment(
      { appointmentType: 'viewing', title: 'Viewing', startAt: '2026-09-01T14:00:00.000Z', endAt: '2026-09-01T15:00:00.000Z', timezone: 'America/New_York', resourceIds: [chapel.id], idFactory },
      ctx(),
      'mock',
    );
    const updated = await rescheduleAppointment(DEFAULT_ORGANIZATION_ID, appointment.id, { startAt: '2026-09-02T14:00:00.000Z', endAt: '2026-09-02T15:00:00.000Z' }, ctx(), 'mock');
    expect(updated.startAt).toBe('2026-09-02T14:00:00.000Z');
    const assignments = await listResourceAssignments(DEFAULT_ORGANIZATION_ID, appointment.id, 'mock');
    expect(assignments[0].startAt).toBe('2026-09-02T14:00:00.000Z');
  });

  it('marks a recurring occurrence as an exception rather than touching the RecurrenceDefinition or its siblings', async () => {
    const first = await createAppointment(
      {
        appointmentType: 'staff.meeting',
        title: 'Weekly Standup',
        startAt: '2026-09-01T09:00:00.000Z',
        endAt: '2026-09-01T09:30:00.000Z',
        timezone: 'America/New_York',
        recurrence: { frequency: 'weekly', interval: 1, count: 3 },
        idFactory,
      },
      ctx(),
      'mock',
    );
    const definitionBefore = recurrenceDefinitionFixtures.find((d) => d.id === first.recurrenceDefinitionId);
    const secondOccurrence = appointmentFixtures.find((a) => a.recurrenceDefinitionId === first.recurrenceDefinitionId && a.id !== first.id)!;

    const updated = await rescheduleAppointment(DEFAULT_ORGANIZATION_ID, secondOccurrence.id, { startAt: '2026-09-09T09:00:00.000Z', endAt: '2026-09-09T09:30:00.000Z' }, ctx(), 'mock');
    expect(updated.isRecurrenceException).toBe(true);

    const definitionAfter = recurrenceDefinitionFixtures.find((d) => d.id === first.recurrenceDefinitionId);
    expect(definitionAfter).toEqual(definitionBefore);
    const untouchedSibling = appointmentFixtures.find((a) => a.id === first.id)!;
    expect(untouchedSibling.startAt).toBe('2026-09-01T09:00:00.000Z');
  });

  it('rejects rescheduling a terminal appointment', async () => {
    const appointment = await createAppointment(
      { appointmentType: 'viewing', title: 'Viewing', startAt: '2026-09-01T14:00:00.000Z', endAt: '2026-09-01T15:00:00.000Z', timezone: 'America/New_York', idFactory },
      ctx(),
      'mock',
    );
    await cancelAppointment(DEFAULT_ORGANIZATION_ID, appointment.id, null, ctx(), 'mock');
    await expect(rescheduleAppointment(DEFAULT_ORGANIZATION_ID, appointment.id, { startAt: '2026-09-02T14:00:00.000Z', endAt: '2026-09-02T15:00:00.000Z' }, ctx(), 'mock')).rejects.toThrow(
      SchedulingServiceError,
    );
  });

  it("Phase 30: notifies the appointment's owner (if set) on reschedule", async () => {
    const appointment = await createAppointment(
      { appointmentType: 'viewing', title: 'Viewing', startAt: '2026-09-01T14:00:00.000Z', endAt: '2026-09-01T15:00:00.000Z', timezone: 'America/New_York', ownerStaffProfileId: 'staff-dana', idFactory },
      ctx(),
      'mock',
    );
    notificationFixtures.length = 0;
    notificationRecipientFixtures.length = 0;
    await rescheduleAppointment(DEFAULT_ORGANIZATION_ID, appointment.id, { startAt: '2026-09-02T14:00:00.000Z', endAt: '2026-09-02T15:00:00.000Z' }, ctx(), 'mock');
    expect(notificationFixtures.some((n) => n.notificationType === 'scheduling.appointment_rescheduled')).toBe(true);
  });
});

describe('updateAppointmentResources', () => {
  it('adds and releases resources, recording an event for each', async () => {
    const chapel = await makeChapel();
    const vehicle = await createResource(DEFAULT_ORGANIZATION_ID, { resourceType: 'vehicle', name: 'Hearse', idFactory }, 'mock');
    const appointment = await createAppointment(
      { appointmentType: 'funeral.service', title: 'Service', startAt: '2026-09-01T14:00:00.000Z', endAt: '2026-09-01T15:00:00.000Z', timezone: 'America/New_York', resourceIds: [chapel.id], idFactory },
      ctx(),
      'mock',
    );
    await updateAppointmentResources(DEFAULT_ORGANIZATION_ID, appointment.id, { addResourceIds: [vehicle.id], removeResourceIds: [chapel.id] }, ctx(), 'mock');

    const assignments = await listResourceAssignments(DEFAULT_ORGANIZATION_ID, appointment.id, 'mock');
    const chapelAssignment = assignments.find((a) => a.resourceId === chapel.id)!;
    const vehicleAssignment = assignments.find((a) => a.resourceId === vehicle.id)!;
    expect(chapelAssignment.releasedAt).not.toBeNull();
    expect(vehicleAssignment.releasedAt).toBeNull();
    expect(activityEventFixtures.some((e) => e.eventType === 'scheduling.resource.assigned')).toBe(true);
    expect(activityEventFixtures.some((e) => e.eventType === 'scheduling.resource.released')).toBe(true);
  });

  it('promotes a draft to scheduled once a resource is added', async () => {
    const chapel = await makeChapel();
    const appointment = await createAppointment(
      { appointmentType: 'viewing', title: 'Viewing', startAt: '2026-09-01T14:00:00.000Z', endAt: '2026-09-01T15:00:00.000Z', timezone: 'America/New_York', idFactory },
      ctx(),
      'mock',
    );
    expect(appointment.status).toBe('draft');
    await updateAppointmentResources(DEFAULT_ORGANIZATION_ID, appointment.id, { addResourceIds: [chapel.id] }, ctx(), 'mock');
    const reloaded = await getAppointment(DEFAULT_ORGANIZATION_ID, appointment.id, 'mock');
    expect(reloaded?.status).toBe('scheduled');
  });
});

describe('confirmAppointment / startAppointment / completeAppointment / cancelAppointment', () => {
  it('walks the full non-recurring lifecycle', async () => {
    const chapel = await makeChapel();
    const appointment = await createAppointment(
      { appointmentType: 'viewing', title: 'Viewing', startAt: '2026-09-01T14:00:00.000Z', endAt: '2026-09-01T15:00:00.000Z', timezone: 'America/New_York', resourceIds: [chapel.id], idFactory },
      ctx(),
      'mock',
    );
    const confirmed = await confirmAppointment(DEFAULT_ORGANIZATION_ID, appointment.id, ctx(), 'mock');
    expect(confirmed.status).toBe('confirmed');
    const inProgress = await startAppointment(DEFAULT_ORGANIZATION_ID, appointment.id, ctx(), 'mock');
    expect(inProgress.status).toBe('in_progress');
    const completed = await completeAppointment(DEFAULT_ORGANIZATION_ID, appointment.id, 'completed', ctx(), 'mock');
    expect(completed.status).toBe('completed');

    const assignments = await listResourceAssignments(DEFAULT_ORGANIZATION_ID, appointment.id, 'mock');
    expect(assignments[0].releasedAt).not.toBeNull();
  });

  it('supports marking a no-show as a distinct terminal outcome', async () => {
    const appointment = await createAppointment(
      { appointmentType: 'viewing', title: 'Viewing', startAt: '2026-09-01T14:00:00.000Z', endAt: '2026-09-01T15:00:00.000Z', timezone: 'America/New_York', idFactory },
      ctx(),
      'mock',
    );
    const noShow = await completeAppointment(DEFAULT_ORGANIZATION_ID, appointment.id, 'no_show', ctx(), 'mock');
    expect(noShow.status).toBe('no_show');
  });

  it('never allows editing a completed or cancelled appointment', async () => {
    const appointment = await createAppointment(
      { appointmentType: 'viewing', title: 'Viewing', startAt: '2026-09-01T14:00:00.000Z', endAt: '2026-09-01T15:00:00.000Z', timezone: 'America/New_York', idFactory },
      ctx(),
      'mock',
    );
    await cancelAppointment(DEFAULT_ORGANIZATION_ID, appointment.id, 'No longer needed', ctx(), 'mock');
    await expect(confirmAppointment(DEFAULT_ORGANIZATION_ID, appointment.id, ctx(), 'mock')).rejects.toThrow(SchedulingServiceError);
    await expect(cancelAppointment(DEFAULT_ORGANIZATION_ID, appointment.id, null, ctx(), 'mock')).rejects.toThrow(SchedulingServiceError);
  });

  it("Phase 30: notifies the appointment's owner (if set) on cancellation", async () => {
    const appointment = await createAppointment(
      { appointmentType: 'viewing', title: 'Viewing', startAt: '2026-09-01T14:00:00.000Z', endAt: '2026-09-01T15:00:00.000Z', timezone: 'America/New_York', ownerStaffProfileId: 'staff-dana', idFactory },
      ctx(),
      'mock',
    );
    notificationFixtures.length = 0;
    notificationRecipientFixtures.length = 0;
    await cancelAppointment(DEFAULT_ORGANIZATION_ID, appointment.id, 'No longer needed', ctx(), 'mock');
    expect(notificationFixtures.some((n) => n.notificationType === 'scheduling.appointment_cancelled')).toBe(true);
  });
});

describe('listAppointments / listAppointmentsForCase / cross-tenant isolation', () => {
  it('never crosses tenant boundaries, even for an identical caseId string', async () => {
    const sharedCaseId = 'case-shared-1042';
    await createAppointment(
      { appointmentType: 'viewing', title: 'Org A viewing', caseId: sharedCaseId, startAt: '2026-09-01T14:00:00.000Z', endAt: '2026-09-01T15:00:00.000Z', timezone: 'America/New_York', idFactory },
      ctx(),
      'mock',
    );
    await createAppointment(
      { appointmentType: 'viewing', title: 'Org B viewing', caseId: sharedCaseId, startAt: '2026-09-01T14:00:00.000Z', endAt: '2026-09-01T15:00:00.000Z', timezone: 'America/New_York', idFactory },
      ctx({ organizationId: SECOND_MOCK_ORGANIZATION_ID }),
      'mock',
    );
    const orgAResults = await listAppointmentsForCase(DEFAULT_ORGANIZATION_ID, sharedCaseId, 'mock');
    expect(orgAResults).toHaveLength(1);
    expect(orgAResults[0].title).toBe('Org A viewing');
  });

  it('filters by date range', async () => {
    await createAppointment(
      { appointmentType: 'viewing', title: 'September', startAt: '2026-09-01T14:00:00.000Z', endAt: '2026-09-01T15:00:00.000Z', timezone: 'America/New_York', idFactory },
      ctx(),
      'mock',
    );
    await createAppointment(
      { appointmentType: 'viewing', title: 'October', startAt: '2026-10-01T14:00:00.000Z', endAt: '2026-10-01T15:00:00.000Z', timezone: 'America/New_York', idFactory },
      ctx(),
      'mock',
    );
    const results = await listAppointments(DEFAULT_ORGANIZATION_ID, { from: '2026-09-15T00:00:00.000Z', to: '2026-09-30T00:00:00.000Z' }, 'mock');
    expect(results).toHaveLength(0);
    const septemberResults = await listAppointments(DEFAULT_ORGANIZATION_ID, { from: '2026-08-15T00:00:00.000Z', to: '2026-09-15T00:00:00.000Z' }, 'mock');
    expect(septemberResults).toHaveLength(1);
    expect(septemberResults[0].title).toBe('September');
  });
});

describe('createWitnessSignatureRequest', () => {
  it('reuses the existing signatureService rather than a parallel signing mechanism', async () => {
    caseFixtures.push({
      id: 'case-witness-1',
      organizationId: DEFAULT_ORGANIZATION_ID,
      caseNumber: 'B2026-900',
      decedentName: 'Robert Ellison',
      dateOfBirth: '04/12/1951',
      dateOfDeath: '01/02/2026',
      timeOfDeath: '',
      placeOfDeath: '',
      weight: '178 lb',
      rawStage: 0,
      assignedStaffId: null,
      nextOfKinName: 'Margaret Ellison',
      nextOfKinPhone: '(555) 010-1234',
      paymentStatus: 'awaiting_payment',
      isVeteran: false,
      vaStepsState: {},
      vaPublishChoice: null,
      checklistState: {},
      fieldValues: {},
      daysWaitingInStage: 0,
      isStalled: false,
      stalledReason: null,
      createdBy: null,
      intakeOwnerId: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      isDeleted: false,
      workflowTemplateId: 'wf-1',
      workflowTemplateVersion: 1,
      caseType: 'cremation',
      workflowSnapshot: null,
    });
    const { createTemplate } = await import('./documentTemplatesService');
    const { generate } = await import('./documentService');
    const template = await createTemplate(
      { organizationId: DEFAULT_ORGANIZATION_ID, name: 'Cremation Authorization', documentTypeKey: 'authorization.cremation', category: 'authorization', body: '<p>{{case.decedent.fullName}}</p>', idFactory },
      ctx(),
      'mock',
    );
    const doc = await generate({ caseId: 'case-witness-1', templateId: template.id, idFactory }, ctx(), 'mock');

    const appointment = await createAppointment(
      {
        appointmentType: 'witness.cremation',
        title: 'Witness Cremation',
        caseId: 'case-witness-1',
        startAt: '2026-09-01T14:00:00.000Z',
        endAt: '2026-09-01T15:00:00.000Z',
        timezone: 'America/New_York',
        idFactory,
      },
      ctx(),
      'mock',
    );

    const request = await createWitnessSignatureRequest(appointment, doc.id, 'Jane Witness', 'jane.witness@example.com', ctx(), 'mock');
    expect(request.signerRole).toBe('witness');
    expect(signatureRequestFixtures.some((r) => r.id === request.id)).toBe(true);
  });

  afterEach(() => {
    caseFixtures.length = caseFixtures.filter((c) => c.id !== 'case-witness-1').length;
  });
});

describe('SchedulingService orchestration boundary (structural)', () => {
  const SKIP_DIRS = new Set(['node_modules', '.next', '.git']);

  function walk(dir: string, results: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      if (SKIP_DIRS.has(entry)) continue;
      const fullPath = join(dir, entry);
      const stats = statSync(fullPath);
      if (stats.isDirectory()) {
        walk(fullPath, results);
      } else if (['.ts', '.tsx'].includes(extname(fullPath)) && !fullPath.endsWith('.test.ts') && !fullPath.endsWith('.test.tsx')) {
        results.push(fullPath);
      }
    }
    return results;
  }

  const root = join(__dirname, '..');
  const allFiles = walk(root);
  const schedulingServicePath = join(__dirname, 'schedulingService.ts');
  const resourceServicePath = join(__dirname, 'resourceService.ts');

  it('only schedulingService.ts imports the conflict engine', () => {
    const conflictEnginePath = join(__dirname, 'scheduling', 'conflictEngine.ts');
    const importPattern = /^import .*from ['"][^'"]*scheduling\/conflictEngine['"]/m;
    const offenders = allFiles.filter((filePath) => {
      if (filePath === schedulingServicePath || filePath === conflictEnginePath) return false;
      return importPattern.test(readFileSync(filePath, 'utf8'));
    });
    expect(offenders).toEqual([]);
  });

  it('only schedulingService.ts imports the recurrence engine', () => {
    const recurrenceEnginePath = join(__dirname, 'scheduling', 'recurrenceEngine.ts');
    const importPattern = /^import .*from ['"][^'"]*scheduling\/recurrenceEngine['"]/m;
    const offenders = allFiles.filter((filePath) => {
      if (filePath === schedulingServicePath || filePath === recurrenceEnginePath) return false;
      return importPattern.test(readFileSync(filePath, 'utf8'));
    });
    expect(offenders).toEqual([]);
  });

  it('only schedulingService.ts imports the recordAppointment*/recordResource* activity helpers', () => {
    const helpers = [
      'recordAppointmentCreated',
      'recordAppointmentUpdated',
      'recordAppointmentRescheduled',
      'recordAppointmentCancelled',
      'recordAppointmentCompleted',
      'recordResourceAssigned',
      'recordResourceReleased',
      'recordResourceConflictOverridden',
    ];
    const importPattern = new RegExp(`^import\\s*\\{[^}]*\\b(${helpers.join('|')})\\b`, 'm');
    const offenders = allFiles.filter((filePath) => {
      if (filePath === schedulingServicePath) return false;
      return importPattern.test(readFileSync(filePath, 'utf8'));
    });
    expect(offenders).toEqual([]);
  });

  it('only schedulingService.ts imports lib/schedulingNotifier.ts (no concrete implementation ships this phase, so this is the entire notifier boundary today)', () => {
    const notifierPath = join(root, 'lib', 'schedulingNotifier.ts');
    const importPattern = /^import .*from ['"][^'"]*schedulingNotifier['"]/m;
    const offenders = allFiles.filter((filePath) => {
      if (filePath === schedulingServicePath || filePath === notifierPath) return false;
      return importPattern.test(readFileSync(filePath, 'utf8'));
    });
    expect(offenders).toEqual([]);
  });

  it('no file other than resourceService.ts/schedulingService.ts writes to the mutable scheduling collections directly', () => {
    const writerPatternsByCollection: Array<{ collection: string; allowedWriterPaths: string[] }> = [
      { collection: 'appointments', allowedWriterPaths: [schedulingServicePath] },
      { collection: 'appointmentResourceAssignments', allowedWriterPaths: [schedulingServicePath] },
      { collection: 'resources', allowedWriterPaths: [resourceServicePath] },
      { collection: 'resourceUnavailability', allowedWriterPaths: [resourceServicePath] },
    ];

    for (const { collection, allowedWriterPaths } of writerPatternsByCollection) {
      const writePattern = new RegExp(`(?:insertWixDataItem|updateWixDataItem)(?:<[^>]*>)?\\(\\s*['"]${collection}['"]`);
      const offenders = allFiles.filter((filePath) => !allowedWriterPaths.includes(filePath) && writePattern.test(readFileSync(filePath, 'utf8')));
      expect(offenders, `unexpected writer(s) of "${collection}": ${offenders.join(', ')}`).toEqual([]);
    }

    // recurrenceDefinitions is written only by recurrenceEngine.ts, which only
    // schedulingService.ts may import (see the "only schedulingService.ts
    // imports the recurrence engine" assertion above) — so this collection's
    // write boundary is enforced transitively, not by this direct check.
    const recurrenceEnginePath = join(__dirname, 'scheduling', 'recurrenceEngine.ts');
    const writePattern = /(?:insertWixDataItem|updateWixDataItem)(?:<[^>]*>)?\(\s*['"]recurrenceDefinitions['"]/;
    const offenders = allFiles.filter((filePath) => filePath !== recurrenceEnginePath && writePattern.test(readFileSync(filePath, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
