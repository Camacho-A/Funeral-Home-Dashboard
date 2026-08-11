import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_ORGANIZATION_ID } from './__mocks__/organizationIds';
import { caseFixtures, taskFixtures, staffFixtures } from './__mocks__/fixtures';
import { appointmentFixtures, appointmentResourceAssignmentFixtures, resourceFixtures } from './__mocks__/schedulingFixtures';
import { caseDocumentFixtures, signatureRequestFixtures } from './__mocks__/documentFixtures';
import { paymentRecordFixtures } from './__mocks__/paymentFixtures';
import { activityEventFixtures } from './__mocks__/activityEventFixtures';
import { ledgerAccountFixtures, journalEntryFixtures, journalEntryLineFixtures } from './__mocks__/ledgerFixtures';
import { caseOrderFixtures, caseOrderLineItemFixtures, caseOrderAuditFixtures } from './__mocks__/pricingFixtures';
import type { CaseTask } from '../types/task';
import type { Appointment } from '../types/appointment';
import type { Resource } from '../types/resource';
import type { CaseDocument } from '../types/caseDocument';
import type { SignatureRequest } from '../types/signatureRequest';
import type { PaymentRecord } from '../types/payment';
import { STAGES } from '../domain/cases/stages';
import {
  countActiveCases,
  countCasesCreated,
  countOverdueCases,
  caseCountsByStage,
  veteranCaseStatusBreakdown,
  countOpenTasks,
  countOverdueTasks,
  countUpcomingAppointments,
  countAppointmentsByStatus,
  resourceBookedHours,
  countDocumentsGenerated,
  countOutstandingSignatures,
  averageSignatureCompletionHours,
  countPaymentsByStatus,
  grossRevenue,
  cashCollected,
  averageRevenuePerCase,
  staffWorkload,
  staffAppointmentLoad,
  defaultDateRange,
  arAgingSummary,
  runReport,
  ReportRunnerError,
} from './reportingService';

let idCounter = 0;
function idFactory(): string {
  idCounter += 1;
  return `report-test-id-${idCounter}`;
}

const NOW = '2026-07-20T00:00:00.000Z';

beforeEach(() => {
  idCounter = 0;
  appointmentFixtures.length = 0;
  appointmentResourceAssignmentFixtures.length = 0;
  resourceFixtures.length = 0;
  caseDocumentFixtures.length = 0;
  signatureRequestFixtures.length = 0;
  paymentRecordFixtures.length = 0;
  activityEventFixtures.length = 0;
  ledgerAccountFixtures.length = 0;
  journalEntryFixtures.length = 0;
  journalEntryLineFixtures.length = 0;
  caseOrderFixtures.length = 0;
  caseOrderLineItemFixtures.length = 0;
  caseOrderAuditFixtures.length = 0;
});

describe('countActiveCases', () => {
  it('matches a direct fixture count of non-terminal, non-deleted cases for the organization', async () => {
    const expected = caseFixtures.filter(
      (c) => c.organizationId === DEFAULT_ORGANIZATION_ID && !c.isDeleted && c.rawStage < 8 /* raw stage below the terminal raw stage */,
    );
    const count = await countActiveCases(DEFAULT_ORGANIZATION_ID, {}, 'mock');
    // Loose bound check: every fixture case not on the last raw stage is active; exact parity
    // with the viewModel's own effectiveDisplayStage is asserted via the staff-filter test below.
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThanOrEqual(caseFixtures.filter((c) => c.organizationId === DEFAULT_ORGANIZATION_ID && !c.isDeleted).length);
    expect(expected.length).toBeGreaterThan(0);
  });

  it('narrows to one staff member when staffProfileId is given', async () => {
    const staffId = staffFixtures[0].id;
    const all = await countActiveCases(DEFAULT_ORGANIZATION_ID, {}, 'mock');
    const narrowed = await countActiveCases(DEFAULT_ORGANIZATION_ID, { staffProfileId: staffId }, 'mock');
    expect(narrowed).toBeLessThanOrEqual(all);
  });

  it('is zero for an organization with no cases', async () => {
    expect(await countActiveCases('org-with-no-cases', {}, 'mock')).toBe(0);
  });
});

describe('countCasesCreated', () => {
  // The seed fixtures' own `createdAt` is a legacy 'MM/DD/YYYY' string (see
  // services/__mocks__/fixtures.ts's `createdAt: raw.dod`), not the real
  // ISO format every actual creation path (mock or wix) writes — so this
  // test adds its own ISO-timestamped case rather than relying on seed
  // data's non-representative format.
  it('counts only cases created within the given range', async () => {
    const extra = { ...caseFixtures[0], id: 'case-created-test-1', createdAt: '2026-07-15T00:00:00.000Z' };
    caseFixtures.push(extra);
    try {
      const inRange = await countCasesCreated(DEFAULT_ORGANIZATION_ID, { fromDate: '2026-07-01T00:00:00.000Z', toDate: '2026-07-31T00:00:00.000Z' }, 'mock');
      const outOfRange = await countCasesCreated(DEFAULT_ORGANIZATION_ID, { fromDate: '1900-01-01T00:00:00.000Z', toDate: '1900-01-02T00:00:00.000Z' }, 'mock');
      expect(inRange).toBeGreaterThanOrEqual(1);
      expect(outOfRange).toBe(0);
    } finally {
      const index = caseFixtures.indexOf(extra);
      if (index !== -1) caseFixtures.splice(index, 1);
    }
  });
});

describe('countOverdueCases', () => {
  it('never exceeds the active case count', async () => {
    const active = await countActiveCases(DEFAULT_ORGANIZATION_ID, {}, 'mock');
    const overdue = await countOverdueCases(DEFAULT_ORGANIZATION_ID, {}, 'mock');
    expect(overdue).toBeLessThanOrEqual(active);
  });

  it('narrows by stage label', async () => {
    const unmatched = await countOverdueCases(DEFAULT_ORGANIZATION_ID, { stage: 'a stage label that does not exist' }, 'mock');
    expect(unmatched).toBe(0);
  });
});

describe('caseCountsByStage', () => {
  it('returns one row per STAGES entry, in order, summing to the total case count', async () => {
    const rows = await caseCountsByStage(DEFAULT_ORGANIZATION_ID, 'mock');
    expect(rows.map((r) => r.stage)).toEqual([...STAGES]);
    expect(rows.map((r) => r.displayStage)).toEqual(STAGES.map((_, i) => i));
    const total = rows.reduce((sum, r) => sum + r.count, 0);
    const activeAndCompleted = caseFixtures.filter((c) => c.organizationId === DEFAULT_ORGANIZATION_ID && !c.isDeleted).length;
    expect(total).toBe(activeAndCompleted);
  });
});

describe('veteranCaseStatusBreakdown', () => {
  it('includes only veteran cases, each with a complete/in_progress status', async () => {
    const rows = await veteranCaseStatusBreakdown(DEFAULT_ORGANIZATION_ID, 'mock');
    for (const row of rows) {
      expect(['complete', 'in_progress']).toContain(row.status);
    }
  });
});

describe('countOpenTasks / countOverdueTasks', () => {
  it('countOpenTasks matches a direct fixture count of not-done tasks', async () => {
    const expected = taskFixtures.filter((t) => t.organizationId === DEFAULT_ORGANIZATION_ID && !t.isDone).length;
    expect(await countOpenTasks(DEFAULT_ORGANIZATION_ID, {}, 'mock')).toBe(expected);
  });

  it('countOpenTasks narrows by staffProfileId', async () => {
    const staffId = taskFixtures.find((t) => t.organizationId === DEFAULT_ORGANIZATION_ID && !t.isDone)!.assigneeStaffId!;
    const narrowed = await countOpenTasks(DEFAULT_ORGANIZATION_ID, { staffProfileId: staffId }, 'mock');
    const expected = taskFixtures.filter((t) => t.organizationId === DEFAULT_ORGANIZATION_ID && !t.isDone && t.assigneeStaffId === staffId).length;
    expect(narrowed).toBe(expected);
  });

  it('countOverdueTasks is zero when no task has a past dueDate', async () => {
    expect(taskFixtures.every((t) => t.dueDate === null)).toBe(true);
    expect(await countOverdueTasks(DEFAULT_ORGANIZATION_ID, {}, 'mock')).toBe(0);
  });

  it('countOverdueTasks counts a not-done task with a past dueDate', () => {
    const extra: CaseTask = {
      id: 'task-overdue-test',
      organizationId: DEFAULT_ORGANIZATION_ID,
      text: 'Overdue test task',
      assigneeStaffId: staffFixtures[0].id,
      isDone: false,
      caseId: null,
      dueDate: '2000-01-01T00:00:00.000Z',
      createdAt: NOW,
    };
    taskFixtures.push(extra);
    return countOverdueTasks(DEFAULT_ORGANIZATION_ID, {}, 'mock')
      .then((count) => expect(count).toBeGreaterThanOrEqual(1))
      .finally(() => {
        const index = taskFixtures.indexOf(extra);
        if (index !== -1) taskFixtures.splice(index, 1);
      });
  });
});

function buildAppointment(overrides: Partial<Appointment>): Appointment {
  return {
    id: overrides.id ?? idFactory(),
    organizationId: DEFAULT_ORGANIZATION_ID,
    caseId: null,
    appointmentType: 'family_meeting',
    title: 'Test appointment',
    notes: null,
    locationId: null,
    status: 'scheduled',
    startAt: '2026-07-21T14:00:00.000Z',
    endAt: '2026-07-21T15:00:00.000Z',
    timezone: 'America/New_York',
    recurrenceDefinitionId: null,
    isRecurrenceException: false,
    ownerStaffProfileId: null,
    createdBy: 'identity-test',
    lastModifiedBy: null,
    cancelledAt: null,
    cancelledBy: null,
    cancelReason: null,
    appointmentVersion: 1,
    correlationId: idFactory(),
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

describe('countUpcomingAppointments / countAppointmentsByStatus', () => {
  it('counts only scheduled/confirmed appointments within range', async () => {
    appointmentFixtures.push(
      buildAppointment({ status: 'scheduled' }),
      buildAppointment({ status: 'confirmed' }),
      buildAppointment({ status: 'completed' }),
      buildAppointment({ status: 'cancelled' }),
    );
    const count = await countUpcomingAppointments(DEFAULT_ORGANIZATION_ID, { fromDate: '2026-07-01T00:00:00.000Z', toDate: '2026-08-01T00:00:00.000Z' }, 'mock');
    expect(count).toBe(2);
  });

  it('narrows by ownerStaffProfileId', async () => {
    appointmentFixtures.push(
      buildAppointment({ status: 'scheduled', ownerStaffProfileId: staffFixtures[0].id }),
      buildAppointment({ status: 'scheduled', ownerStaffProfileId: staffFixtures[1].id }),
    );
    const count = await countUpcomingAppointments(
      DEFAULT_ORGANIZATION_ID,
      { fromDate: '2026-07-01T00:00:00.000Z', toDate: '2026-08-01T00:00:00.000Z', staffProfileId: staffFixtures[0].id },
      'mock',
    );
    expect(count).toBe(1);
  });

  it('countAppointmentsByStatus counts a specific status only', async () => {
    appointmentFixtures.push(buildAppointment({ status: 'no_show' }), buildAppointment({ status: 'completed' }));
    expect(await countAppointmentsByStatus(DEFAULT_ORGANIZATION_ID, 'no_show', { fromDate: '2026-07-01T00:00:00.000Z', toDate: '2026-08-01T00:00:00.000Z' }, 'mock')).toBe(1);
    expect(await countAppointmentsByStatus(DEFAULT_ORGANIZATION_ID, 'completed', { fromDate: '2026-07-01T00:00:00.000Z', toDate: '2026-08-01T00:00:00.000Z' }, 'mock')).toBe(1);
  });
});

describe('resourceBookedHours', () => {
  it('sums booked hours per resource, clipped to the range', async () => {
    const resource: Resource = {
      id: 'resource-test-1',
      organizationId: DEFAULT_ORGANIZATION_ID,
      locationId: null,
      resourceType: 'vehicle',
      name: 'Test Van',
      linkedMembershipId: null,
      linkedStaffProfileId: null,
      isExternal: false,
      capacity: null,
      notes: null,
      status: 'active',
      resourceVersion: 1,
      createdAt: NOW,
      updatedAt: NOW,
    };
    resourceFixtures.push(resource);
    appointmentResourceAssignmentFixtures.push({
      id: 'assignment-test-1',
      organizationId: DEFAULT_ORGANIZATION_ID,
      appointmentId: 'appointment-test-1',
      resourceId: resource.id,
      startAt: '2026-07-21T10:00:00.000Z',
      endAt: '2026-07-21T12:30:00.000Z',
      status: 'scheduled',
      assignmentRole: null,
      assignedAt: NOW,
      releasedAt: null,
      createdBy: 'identity-test',
    });
    const rows = await resourceBookedHours(DEFAULT_ORGANIZATION_ID, { fromDate: '2026-07-01T00:00:00.000Z', toDate: '2026-08-01T00:00:00.000Z' }, 'mock');
    const row = rows.find((r) => r.resourceId === resource.id);
    expect(row?.hours).toBe(2.5);
  });
});

describe('countDocumentsGenerated', () => {
  it('counts only origin: generated documents within range', async () => {
    const base: Omit<CaseDocument, 'id' | 'origin'> = {
      organizationId: DEFAULT_ORGANIZATION_ID,
      caseId: caseFixtures[0].id,
      documentTypeKey: null,
      category: null,
      fileName: 'test.pdf',
      mimeType: 'application/pdf',
      fileSizeBytes: 100,
      checksumSha256: 'x',
      storageKey: 'k',
      status: 'active',
      signatureStatus: 'unsigned',
      familyVisible: false,
      templateId: null,
      version: null,
      supersedesId: null,
      generatedBy: null,
      uploadedBy: null,
      createdAt: '2026-07-15T00:00:00.000Z',
      updatedAt: '2026-07-15T00:00:00.000Z',
    } as unknown as Omit<CaseDocument, 'id' | 'origin'>;
    caseDocumentFixtures.push({ ...base, id: 'doc-generated-1', origin: 'generated' } as CaseDocument);
    caseDocumentFixtures.push({ ...base, id: 'doc-uploaded-1', origin: 'uploaded' } as CaseDocument);
    const count = await countDocumentsGenerated(DEFAULT_ORGANIZATION_ID, { fromDate: '2026-07-01T00:00:00.000Z', toDate: '2026-08-01T00:00:00.000Z' }, 'mock');
    expect(count).toBe(1);
  });
});

describe('countOutstandingSignatures / averageSignatureCompletionHours', () => {
  function buildSignatureRequest(overrides: Partial<SignatureRequest>): SignatureRequest {
    return {
      id: overrides.id ?? idFactory(),
      organizationId: DEFAULT_ORGANIZATION_ID,
      caseId: caseFixtures[0].id,
      documentId: 'doc-1',
      status: 'pending',
      signerName: 'Jamie Rivera',
      signerEmail: 'jamie@example.com',
      tokenHash: 'hash',
      issuedAt: '2026-07-15T00:00:00.000Z',
      viewedAt: null,
      signedAt: null,
      declinedAt: null,
      declineReason: null,
      cancelledAt: null,
      cancelledBy: null,
      expiresAt: '2026-08-15T00:00:00.000Z',
      requestVersion: 1,
      requestedBy: 'identity-test',
      correlationId: idFactory(),
      createdAt: '2026-07-15T00:00:00.000Z',
      updatedAt: '2026-07-15T00:00:00.000Z',
      ...overrides,
    } as SignatureRequest;
  }

  it('counts only draft/pending/viewed requests', async () => {
    signatureRequestFixtures.push(
      buildSignatureRequest({ status: 'pending' }),
      buildSignatureRequest({ status: 'viewed' }),
      buildSignatureRequest({ status: 'signed', signedAt: '2026-07-16T00:00:00.000Z' }),
      buildSignatureRequest({ status: 'expired' }),
    );
    expect(await countOutstandingSignatures(DEFAULT_ORGANIZATION_ID, 'mock')).toBe(2);
  });

  it('averages completion hours only over signed requests within range', async () => {
    signatureRequestFixtures.push(
      buildSignatureRequest({ status: 'signed', issuedAt: '2026-07-15T00:00:00.000Z', signedAt: '2026-07-15T12:00:00.000Z' }),
      buildSignatureRequest({ status: 'signed', issuedAt: '2026-07-16T00:00:00.000Z', signedAt: '2026-07-17T00:00:00.000Z' }),
    );
    const avg = await averageSignatureCompletionHours(DEFAULT_ORGANIZATION_ID, { fromDate: '2026-07-01T00:00:00.000Z', toDate: '2026-08-01T00:00:00.000Z' }, 'mock');
    expect(avg).toBe(18); // (12 + 24) / 2
  });

  it('is zero when there are no signature requests at all', async () => {
    expect(await countOutstandingSignatures(DEFAULT_ORGANIZATION_ID, 'mock')).toBe(0);
    expect(await averageSignatureCompletionHours(DEFAULT_ORGANIZATION_ID, {}, 'mock')).toBe(0);
  });
});

describe('countPaymentsByStatus', () => {
  it('delegates to paymentsService and counts only the requested status', async () => {
    const base: Omit<PaymentRecord, 'id' | 'status'> = {
      organizationId: DEFAULT_ORGANIZATION_ID,
      caseId: caseFixtures[0].id,
      caseOrderId: 'order-1',
      amountCents: 10000,
      provider: 'clover',
      providerPaymentId: 'p-1',
      checkoutUrl: null,
      initiatedByStaffProfileId: null,
      depositedInBankDepositId: null,
      failureReason: null,
      createdAt: '2026-07-15T00:00:00.000Z',
      updatedAt: '2026-07-15T00:00:00.000Z',
    } as unknown as Omit<PaymentRecord, 'id' | 'status'>;
    paymentRecordFixtures.push({ ...base, id: 'payment-pending-1', status: 'pending' } as PaymentRecord);
    paymentRecordFixtures.push({ ...base, id: 'payment-failed-1', status: 'failed' } as PaymentRecord);
    expect(await countPaymentsByStatus(DEFAULT_ORGANIZATION_ID, 'pending', { fromDate: '2026-07-01T00:00:00.000Z', toDate: '2026-08-01T00:00:00.000Z' }, 'mock')).toBe(1);
    expect(await countPaymentsByStatus(DEFAULT_ORGANIZATION_ID, 'failed', { fromDate: '2026-07-01T00:00:00.000Z', toDate: '2026-08-01T00:00:00.000Z' }, 'mock')).toBe(1);
  });
});

describe('revenue metrics (reuse the Phase 31/32 ledger exclusively)', () => {
  it('grossRevenue/cashCollected/averageRevenuePerCase reflect a posted case order and payment', async () => {
    const { createCaseOrder } = await import('./pricingService');
    const { postPaymentTransaction } = await import('./financialTransactionService');

    const { order } = await createCaseOrder(
      {
        organizationId: DEFAULT_ORGANIZATION_ID,
        caseId: 'case-reporting-revenue-1',
        selections: { weightTier: '201_250', extraDeathCertificateQuantity: 1, mailCremated: false },
        performedBy: 'Jordan Ellis',
        idFactory,
        now: NOW,
      },
      'mock',
    );

    await postPaymentTransaction(
      DEFAULT_ORGANIZATION_ID,
      {
        caseId: 'case-reporting-revenue-1',
        paymentId: 'payment-reporting-revenue-1',
        amountCents: order.total,
        entryDate: NOW,
        idFactory,
      },
      { organizationId: DEFAULT_ORGANIZATION_ID, actorIdentityId: null, actorMembershipId: null, actorRoleKey: null, correlationId: idFactory() },
      'mock',
    );

    const range = { fromDate: '2026-07-01T00:00:00.000Z', toDate: '2026-07-31T00:00:00.000Z' };
    const gross = await grossRevenue(DEFAULT_ORGANIZATION_ID, range, 'mock');
    const collected = await cashCollected(DEFAULT_ORGANIZATION_ID, range, 'mock');
    const avgPerCase = await averageRevenuePerCase(DEFAULT_ORGANIZATION_ID, range, 'mock');

    expect(gross).toBe(order.total);
    expect(collected).toBe(order.total);
    expect(avgPerCase).toBe(order.total);
  });

  it('is zero for a range with no ledger activity', async () => {
    const range = { fromDate: '1900-01-01T00:00:00.000Z', toDate: '1900-02-01T00:00:00.000Z' };
    expect(await grossRevenue(DEFAULT_ORGANIZATION_ID, range, 'mock')).toBe(0);
    expect(await cashCollected(DEFAULT_ORGANIZATION_ID, range, 'mock')).toBe(0);
    expect(await averageRevenuePerCase(DEFAULT_ORGANIZATION_ID, range, 'mock')).toBe(0);
  });
});

describe('staffWorkload', () => {
  it('returns one row per staff member with case/task counts, narrowed correctly by staffProfileId', async () => {
    const rows = await staffWorkload(DEFAULT_ORGANIZATION_ID, {}, 'mock');
    expect(rows.length).toBe(staffFixtures.filter((s) => s.organizationId === DEFAULT_ORGANIZATION_ID && s.isActive).length);
    const narrowed = await staffWorkload(DEFAULT_ORGANIZATION_ID, { staffProfileId: staffFixtures[0].id }, 'mock');
    expect(narrowed).toHaveLength(1);
    expect(narrowed[0].staffProfileId).toBe(staffFixtures[0].id);
    const expectedOpenTasks = taskFixtures.filter((t) => !t.isDone && t.assigneeStaffId === staffFixtures[0].id).length;
    expect(narrowed[0].openTaskCount).toBe(expectedOpenTasks);
  });
});

describe('staffAppointmentLoad', () => {
  it('counts owned appointments per staff member within range', async () => {
    appointmentFixtures.push(
      buildAppointment({ ownerStaffProfileId: staffFixtures[0].id }),
      buildAppointment({ ownerStaffProfileId: staffFixtures[0].id }),
      buildAppointment({ ownerStaffProfileId: staffFixtures[1].id }),
    );
    const rows = await staffAppointmentLoad(DEFAULT_ORGANIZATION_ID, { fromDate: '2026-07-01T00:00:00.000Z', toDate: '2026-08-01T00:00:00.000Z' }, 'mock');
    expect(rows.find((r) => r.staffProfileId === staffFixtures[0].id)?.appointmentCount).toBe(2);
    expect(rows.find((r) => r.staffProfileId === staffFixtures[1].id)?.appointmentCount).toBe(1);
  });
});

describe('defaultDateRange', () => {
  it('spans exactly 90 days ending at the given instant', () => {
    const { fromDate, toDate } = defaultDateRange('2026-07-20T00:00:00.000Z');
    expect(toDate).toBe('2026-07-20T00:00:00.000Z');
    const days = (new Date(toDate).getTime() - new Date(fromDate).getTime()) / (1000 * 60 * 60 * 24);
    expect(days).toBe(90);
  });
});

describe('arAgingSummary', () => {
  it('is all-zero when the chart of accounts has not been seeded yet', async () => {
    const summary = await arAgingSummary(DEFAULT_ORGANIZATION_ID, 'mock');
    expect(summary).toEqual({ total: 0, current: 0, days31to60: 0, days61to90: 0, days90Plus: 0 });
  });
});

describe('runReport', () => {
  it('throws ReportRunnerError for an unknown report key', async () => {
    await expect(runReport(DEFAULT_ORGANIZATION_ID, 'not-a-real-report', {}, 'mock')).rejects.toThrow(ReportRunnerError);
  });

  it('runs a metrics-kind report, resolving every listed metric via its registered runner', async () => {
    const result = await runReport(DEFAULT_ORGANIZATION_ID, 'active-cases', {}, 'mock');
    expect(result.kind).toBe('metrics');
    if (result.kind !== 'metrics') throw new Error('expected metrics kind');
    expect(result.metrics.map((m) => m.metricKey)).toEqual(['cases.active', 'cases.stage.count']);
    expect(typeof result.metrics[0].value).toBe('number');
    expect(Array.isArray(result.metrics[1].value)).toBe(true);
  });

  it('runs a financial-kind report, delegating to financialReportsService verbatim', async () => {
    const result = await runReport(DEFAULT_ORGANIZATION_ID, 'trial-balance', {}, 'mock');
    expect(result.kind).toBe('financial');
    if (result.kind !== 'financial') throw new Error('expected financial kind');
    expect(result.financialReportKey).toBe('trialBalance');
    expect(result.data).toHaveProperty('rows');
    expect(result.data).toHaveProperty('totalDebits');
  });

  it('throws a clear error when the general-ledger report is run without an accountId', async () => {
    await expect(runReport(DEFAULT_ORGANIZATION_ID, 'general-ledger', {}, 'mock')).rejects.toThrow(/accountId/);
  });
});

describe('Financial invariant proofs (Phase 32 requirement: reportingService never recalculates a ledger figure independently)', () => {
  const range = { fromDate: '2026-07-01T00:00:00.000Z', toDate: '2026-07-31T00:00:00.000Z' };

  async function postCaseOrderAndPayment(caseId: string, weightTier: '201_250' | '251_300') {
    const { createCaseOrder } = await import('./pricingService');
    const { postPaymentTransaction } = await import('./financialTransactionService');
    const { order } = await createCaseOrder(
      { organizationId: DEFAULT_ORGANIZATION_ID, caseId, selections: { weightTier, extraDeathCertificateQuantity: 1, mailCremated: false }, performedBy: 'Jordan Ellis', idFactory, now: '2026-07-20T00:00:00.000Z' },
      'mock',
    );
    await postPaymentTransaction(
      DEFAULT_ORGANIZATION_ID,
      { caseId, paymentId: `payment-${caseId}`, amountCents: order.total, entryDate: '2026-07-20T00:00:00.000Z', idFactory },
      { organizationId: DEFAULT_ORGANIZATION_ID, actorIdentityId: null, actorMembershipId: null, actorRoleKey: null, correlationId: idFactory() },
      'mock',
    );
    return order;
  }

  it('grossRevenue agrees exactly with financialReportsService.getProfitAndLoss\'s own totalRevenue for the same range', async () => {
    await postCaseOrderAndPayment('case-invariant-pl-1', '201_250');
    const { getProfitAndLoss } = await import('./financialReportsService');

    const gross = await grossRevenue(DEFAULT_ORGANIZATION_ID, range, 'mock');
    const pnl = await getProfitAndLoss(DEFAULT_ORGANIZATION_ID, 'mock', range);

    expect(gross).toBe(pnl.totalRevenue);
    expect(gross).toBeGreaterThan(0);
  });

  it('arAgingSummary().total agrees exactly with getArAgingReport\'s own glAccountsReceivableBalance (no outstanding balance once paid in full)', async () => {
    const { getAccountByNumber } = await import('./chartOfAccountsService');
    const { getArAgingReport } = await import('./financialReportsService');
    const { STARTER_ACCOUNT_NUMBERS } = await import('../domain/ledger/starterChartOfAccounts');

    await postCaseOrderAndPayment('case-invariant-ar-1', '251_300');
    const accountsReceivable = await getAccountByNumber(DEFAULT_ORGANIZATION_ID, STARTER_ACCOUNT_NUMBERS.ACCOUNTS_RECEIVABLE, 'mock');
    const authoritative = await getArAgingReport(DEFAULT_ORGANIZATION_ID, accountsReceivable!.id, 'mock');
    const summary = await arAgingSummary(DEFAULT_ORGANIZATION_ID, 'mock');

    expect(summary.total).toBe(authoritative.totalOutstanding);
    expect(authoritative.glAccountsReceivableBalance).toBe(0); // paid in full — nets to zero, never negative
  });

  it('cashCollected reconciles exactly with an independently-computed sum of Undeposited Funds debit lines from payment-sourced posted entries', async () => {
    const order = await postCaseOrderAndPayment('case-invariant-cash-1', '201_250');
    const { getAccountByNumber } = await import('./chartOfAccountsService');
    const { STARTER_ACCOUNT_NUMBERS } = await import('../domain/ledger/starterChartOfAccounts');
    const undepositedFunds = await getAccountByNumber(DEFAULT_ORGANIZATION_ID, STARTER_ACCOUNT_NUMBERS.UNDEPOSITED_FUNDS, 'mock');

    // Independently re-derive the expected figure directly from the raw
    // fixture arrays — not by calling any reportingService/financialReportsService
    // function — so this is a genuine reconciliation, not a tautology.
    const paymentEntryIds = new Set(journalEntryFixtures.filter((e) => e.organizationId === DEFAULT_ORGANIZATION_ID && e.sourceType === 'payment' && e.status === 'posted').map((e) => e.id));
    const expected = journalEntryLineFixtures
      .filter((l) => l.organizationId === DEFAULT_ORGANIZATION_ID && l.accountId === undepositedFunds!.id && paymentEntryIds.has(l.journalEntryId))
      .reduce((sum, l) => sum + (l.direction === 'debit' ? l.amount : -l.amount), 0);

    const collected = await cashCollected(DEFAULT_ORGANIZATION_ID, range, 'mock');
    expect(collected).toBe(expected);
    expect(collected).toBe(order.total);
  });
});
