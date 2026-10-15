import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Scheduled-job isolation (2026-10, docs/SCHEDULED_JOBS.md) — Wix-mode
 * behaviour of every cron sweep, against a test-local in-memory stand-in for
 * lib/wixDataApi:
 *  - the deployment allowlist is pushed into the Wix query
 *    (`organizationId` equality for one id, `$in` for several, absent when
 *    unrestricted);
 *  - a row from another organization that the backend returns anyway is
 *    never acted on (per-record re-check: no claim, no read of its
 *    appointment/connection, no notification insert);
 *  - claims: a contended claim skips the row; an already-sent bill
 *    reminder (deterministic id present) is not inserted again.
 */

type Row = { id: string; dataCollectionId: string; data: Record<string, unknown> };

const wix = vi.hoisted(() => ({
  queryAllRows: {} as Record<string, Row[]>,
  queryRows: {} as Record<string, (filter: Record<string, unknown> | undefined) => Row[]>,
  conditionalApplied: true,
}));

vi.mock('../../lib/wixDataApi', () => ({
  WixDataApiError: class WixDataApiError extends Error {},
  queryAllWixDataItems: vi.fn(async (collection: string) => wix.queryAllRows[collection] ?? []),
  queryWixDataItems: vi.fn(async (collection: string, query: { filter?: Record<string, unknown> }) => ({
    dataItems: wix.queryRows[collection]?.(query.filter) ?? [],
    pagingMetadata: { hasNext: false },
  })),
  countWixDataItems: vi.fn(async () => 0),
  insertWixDataItem: vi.fn(async (collection: string, data: Record<string, unknown>, id?: string) => ({ id: id ?? 'x', dataCollectionId: collection, data })),
  updateWixDataItem: vi.fn(async (collection: string, id: string, data: Record<string, unknown>) => ({ id, dataCollectionId: collection, data })),
  deleteWixDataItem: vi.fn(async () => undefined),
  conditionalPatchWixDataItem: vi.fn(async () => (wix.conditionalApplied ? { applied: true, dataItem: {} } : { applied: false })),
  incrementWixDataField: vi.fn(),
}));

const wixDataApi = await import('../../lib/wixDataApi');
const { runBillReminderSweep, billReminderNotificationId } = await import('../accountsPayableNotifications');
const { runNotificationDigestSweep } = await import('../notificationDigestService');
const { runAppointmentReminderSweep } = await import('../appointmentReminderService');
const { runCalendarSyncSweep } = await import('../calendarSyncService');
const { claimWixSweepRow, deploymentOrganizationWixFilter } = await import('./sweepSupport');

const GUS = 'gus-camacho-jr';
const MANORS = 'managed-cremations';
const NOW = '2026-09-10T12:00:00.000Z';
let originalDeploymentIds: string | undefined;

beforeEach(() => {
  originalDeploymentIds = process.env.DEPLOYMENT_ORGANIZATION_IDS;
  process.env.DEPLOYMENT_ORGANIZATION_IDS = GUS;
  wix.queryAllRows = {};
  wix.queryRows = {};
  wix.conditionalApplied = true;
  vi.clearAllMocks();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  if (originalDeploymentIds === undefined) delete process.env.DEPLOYMENT_ORGANIZATION_IDS;
  else process.env.DEPLOYMENT_ORGANIZATION_IDS = originalDeploymentIds;
  vi.restoreAllMocks();
});

const queryAllMock = () => vi.mocked(wixDataApi.queryAllWixDataItems);
const queryMock = () => vi.mocked(wixDataApi.queryWixDataItems);
const insertMock = () => vi.mocked(wixDataApi.insertWixDataItem);
const conditionalMock = () => vi.mocked(wixDataApi.conditionalPatchWixDataItem);

function collectionsQueried(): string[] {
  return [...queryMock().mock.calls.map((c) => c[0]), ...queryAllMock().mock.calls.map((c) => c[0])];
}

describe('deploymentOrganizationWixFilter', () => {
  it('is an exact organizationId match for one id, $in for several, and empty when unrestricted', () => {
    expect(deploymentOrganizationWixFilter()).toEqual({ organizationId: GUS });
    process.env.DEPLOYMENT_ORGANIZATION_IDS = `${GUS},other-org`;
    expect(deploymentOrganizationWixFilter()).toEqual({ organizationId: { $in: [GUS, 'other-org'] } });
    delete process.env.DEPLOYMENT_ORGANIZATION_IDS;
    expect(deploymentOrganizationWixFilter()).toEqual({});
  });
});

// ---------------------------------------------------------------------------

function vendorBillRow(organizationId: string): Row {
  return {
    id: `wix-bill-${organizationId}`,
    dataCollectionId: 'vendorBills',
    data: {
      beaconVendorBillId: `bill-${organizationId}`,
      organizationId,
      billNumber: 'INV-1',
      supplierId: 'supplier-1',
      purchaseOrderId: null,
      billDate: '2026-08-01T00:00:00.000Z',
      dueDate: '2026-09-01T00:00:00.000Z',
      status: 'open',
      goodsAmountCents: 100,
      additionalChargesCents: 0,
      totalAmountCents: 100,
      amountPaidCents: 0,
      netVarianceCents: 0,
      journalEntryId: null,
      notes: null,
      createdByStaffProfileId: null,
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
    },
  };
}

describe('bill reminders (Wix)', () => {
  it('queries open and partially_paid bills scoped to the deployment org, fully paginated (no 500 cap)', async () => {
    await runBillReminderSweep(NOW, 'wix');
    const filters = queryAllMock().mock.calls.filter((c) => c[0] === 'vendorBills').map((c) => c[1]);
    expect(filters).toEqual(
      expect.arrayContaining([
        { organizationId: GUS, status: 'open' },
        { organizationId: GUS, status: 'partially_paid' },
      ]),
    );
    expect(queryMock().mock.calls.some((c) => c[0] === 'vendorBills')).toBe(false);
  });

  it('never notifies for a Manors bill even if the backend returns one', async () => {
    wix.queryAllRows.vendorBills = [vendorBillRow(MANORS)];
    const result = await runBillReminderSweep(NOW, 'wix');
    expect(result.notified).toBe(0);
    expect(insertMock()).not.toHaveBeenCalled();
    expect(collectionsQueried()).not.toContain('notifications');
  });

  it('skips a Gus bill already reminded today (deterministic id already present) — no second insert', async () => {
    const row = vendorBillRow(GUS);
    // Only the 'open' status query returns it (each status query is separate).
    vi.mocked(wixDataApi.queryAllWixDataItems).mockImplementation(async (collection, filter) =>
      collection === 'vendorBills' && (filter as { status?: string })?.status === 'open' ? [row] : [],
    );
    const expectedId = billReminderNotificationId(GUS, `bill-${GUS}`, NOW);
    wix.queryRows.notifications = (filter) =>
      filter?.beaconNotificationId === expectedId && filter?.organizationId === GUS
        ? [
            {
              id: expectedId,
              dataCollectionId: 'notifications',
              data: {
                beaconNotificationId: expectedId,
                organizationId: GUS,
                notificationType: 'financial.bill_overdue',
                category: 'financial',
                title: 'Bill overdue',
                body: 'Bill overdue',
                actionUrl: null,
                entityType: 'vendorBill',
                entityId: `bill-${GUS}`,
                recipientScope: 'role',
                recipientRoleKey: 'accounting',
                status: 'active',
                actorIdentityId: null,
                correlationId: 'corr',
                createdAt: NOW,
                updatedAt: NOW,
              },
            },
          ]
        : [];
    const result = await runBillReminderSweep(NOW, 'wix');
    expect(result.notified).toBe(0);
    expect(insertMock().mock.calls.filter((c) => c[0] === 'notifications')).toHaveLength(0);
  });

  it('a Gus bill not yet reminded is inserted under the deterministic id (so a concurrent duplicate insert collides)', async () => {
    const row = vendorBillRow(GUS);
    vi.mocked(wixDataApi.queryAllWixDataItems).mockImplementation(async (collection, filter) =>
      collection === 'vendorBills' && (filter as { status?: string })?.status === 'open' ? [row] : [],
    );
    await runBillReminderSweep(NOW, 'wix');
    const notificationInserts = insertMock().mock.calls.filter((c) => c[0] === 'notifications');
    expect(notificationInserts).toHaveLength(1);
    expect(notificationInserts[0][2]).toBe(billReminderNotificationId(GUS, `bill-${GUS}`, NOW));
  });

  it('unrestricted mode adds no organization filter', async () => {
    delete process.env.DEPLOYMENT_ORGANIZATION_IDS;
    await runBillReminderSweep(NOW, 'wix');
    const filters = queryAllMock().mock.calls.filter((c) => c[0] === 'vendorBills').map((c) => c[1] as Record<string, unknown>);
    expect(filters.length).toBe(2);
    expect(filters.every((f) => !('organizationId' in f))).toBe(true);
  });
});

// ---------------------------------------------------------------------------

function deliveryRow(organizationId: string, lastAttemptAt: string | null = null): Row {
  return {
    id: `delivery-${organizationId}`,
    dataCollectionId: 'notificationDeliveries',
    data: {
      beaconNotificationDeliveryId: `delivery-${organizationId}`,
      organizationId,
      notificationId: `notif-${organizationId}`,
      notificationRecipientId: `notif-${organizationId}-identity-1`,
      identityId: 'identity-1',
      channel: 'email',
      status: 'queued_for_digest',
      attemptCount: 0,
      lastAttemptAt,
      createdAt: '2026-08-01T00:00:00.000Z',
    },
  };
}

describe('notification digest (Wix)', () => {
  it('scopes the queued-delivery query to the deployment org', async () => {
    await runNotificationDigestSweep('wix', NOW);
    expect(queryAllMock().mock.calls.find((c) => c[0] === 'notificationDeliveries')?.[1]).toEqual({ organizationId: GUS, status: 'queued_for_digest' });
  });

  it('never reads preferences for, claims, or sends a Manors delivery the backend returns anyway', async () => {
    wix.queryAllRows.notificationDeliveries = [deliveryRow(MANORS)];
    const result = await runNotificationDigestSweep('wix', NOW);
    expect(result.groupsConsidered).toBe(0);
    expect(collectionsQueried()).not.toContain('notificationPreferences');
    expect(conditionalMock()).not.toHaveBeenCalled();
    expect(insertMock()).not.toHaveBeenCalled();
  });

  it('skips a Gus delivery another sweep claimed moments ago — no claim attempt, no send, no attempt row', async () => {
    const fresh = new Date(Date.now() - 30_000).toISOString();
    wix.queryAllRows.notificationDeliveries = [deliveryRow(GUS, null)];
    wix.queryRows.notificationDeliveries = () => [deliveryRow(GUS, fresh)]; // the per-delivery re-read sees the other sweep's claim
    const result = await runNotificationDigestSweep('wix', new Date().toISOString());
    expect(result.deliveriesFlushed).toBe(0);
    expect(conditionalMock()).not.toHaveBeenCalled();
    expect(insertMock().mock.calls.filter((c) => c[0] === 'notificationDeliveryAttempts')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------

function reminderRow(organizationId: string): Row {
  return {
    id: `wix-reminder-${organizationId}`,
    dataCollectionId: 'appointmentReminders',
    data: {
      beaconAppointmentReminderId: `reminder-${organizationId}`,
      organizationId,
      appointmentId: `appt-${organizationId}`,
      leadTimeMinutes: 120,
      recipientType: 'staff_owner',
      recipientIdentityId: 'identity-1',
      recipientPortalUserId: null,
      scheduledFor: '2026-09-10T11:00:00.000Z',
      status: 'scheduled',
      notificationId: null,
      sentAt: null,
      cancelledAt: null,
      failureReason: null,
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
    },
  };
}

describe('appointment reminders (Wix)', () => {
  it('pushes org scope, status and the due-time bound into one paginated, ordered query', async () => {
    await runAppointmentReminderSweep('wix', NOW);
    const call = queryAllMock().mock.calls.find((c) => c[0] === 'appointmentReminders');
    expect(call?.[1]).toEqual({ organizationId: GUS, status: 'scheduled', scheduledFor: { $lte: NOW } });
    expect(call?.[2]).toEqual({ sort: [{ fieldName: 'scheduledFor', order: 'ASC' }] });
  });

  it('never claims or reads the appointment for a Manors reminder the backend returns anyway', async () => {
    wix.queryAllRows.appointmentReminders = [reminderRow(MANORS)];
    const result = await runAppointmentReminderSweep('wix', NOW);
    expect(result.considered).toBe(0);
    expect(conditionalMock()).not.toHaveBeenCalled();
    expect(collectionsQueried()).not.toContain('appointments');
    expect(insertMock()).not.toHaveBeenCalled();
  });

  it('claims a Gus reminder with a compare-and-swap on sentAt; a lost claim sends nothing', async () => {
    wix.queryAllRows.appointmentReminders = [reminderRow(GUS)];
    wix.conditionalApplied = false;
    // Re-read after the rejected claim: another sweep already set sentAt.
    wix.queryRows.appointmentReminders = () => [{ ...reminderRow(GUS), data: { ...reminderRow(GUS).data, sentAt: NOW } }];
    const result = await runAppointmentReminderSweep('wix', NOW);
    expect(conditionalMock()).toHaveBeenCalledWith('appointmentReminders', `wix-reminder-${GUS}`, 'sentAt', NOW, {
      filter: { status: { $eq: 'scheduled' }, sentAt: { $eq: null } },
    });
    expect(result).toMatchObject({ considered: 1, sent: 0, failed: 0, skipped: 0 });
    expect(collectionsQueried()).not.toContain('appointments');
    expect(insertMock()).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------

function linkRow(organizationId: string): Row {
  return {
    id: `wix-link-${organizationId}`,
    dataCollectionId: 'calendarEventLinks',
    data: {
      beaconCalendarEventLinkId: `link-${organizationId}`,
      organizationId,
      appointmentId: `appt-${organizationId}`,
      calendarConnectionId: `conn-${organizationId}`,
      provider: 'google',
      externalCalendarId: 'primary',
      externalEventId: null,
      syncStatus: 'pending',
      beaconAppointmentVersion: 0,
      lastSyncedAt: null,
      lastError: null,
      retryCount: 0,
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
    },
  };
}

describe('calendar sync (Wix)', () => {
  it('scopes both candidate queries to the deployment org', async () => {
    await runCalendarSyncSweep('wix', NOW);
    const filters = queryMock().mock.calls.filter((c) => c[0] === 'calendarEventLinks').map((c) => (c[1] as { filter: unknown }).filter);
    expect(filters).toEqual([
      { organizationId: GUS, syncStatus: 'pending' },
      { organizationId: GUS, syncStatus: 'retry_pending' },
    ]);
  });

  it('never claims, refreshes tokens for, or reads the connection of a Manors link the backend returns anyway', async () => {
    wix.queryRows.calendarEventLinks = (filter) => (filter?.syncStatus === 'pending' ? [linkRow(MANORS)] : []);
    const result = await runCalendarSyncSweep('wix', NOW);
    expect(result.processed).toBe(0);
    expect(conditionalMock()).not.toHaveBeenCalled();
    expect(collectionsQueried()).not.toContain('calendarConnections');
  });

  it('a lost claim on a Gus link skips it before any connection read or provider call', async () => {
    wix.queryRows.calendarEventLinks = (filter) => {
      if (filter?._id) return [{ ...linkRow(GUS), data: { ...linkRow(GUS).data, sweepClaimedAt: NOW } }]; // re-read: claimed elsewhere
      return filter?.syncStatus === 'pending' ? [linkRow(GUS)] : [];
    };
    wix.conditionalApplied = false;
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const result = await runCalendarSyncSweep('wix', NOW);
    vi.unstubAllGlobals();
    expect(conditionalMock()).toHaveBeenCalledWith('calendarEventLinks', `wix-link-${GUS}`, 'sweepClaimedAt', NOW, {
      filter: { syncStatus: { $eq: 'pending' }, sweepClaimedAt: { $eq: null } },
    });
    expect(result.processed).toBe(0);
    expect(collectionsQueried()).not.toContain('calendarConnections');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------

describe('claimWixSweepRow', () => {
  const params = {
    collection: 'c',
    wixItemId: 'item-1',
    fieldPath: 'claimedAt',
    claimValue: NOW,
    condition: { claimedAt: { $eq: null } },
    isUnchanged: (data: Record<string, unknown>) => data.claimedAt == null,
  };

  it('claimed when the conditional write applies', async () => {
    expect(await claimWixSweepRow(params)).toBe('claimed');
  });

  it('contended when rejected and the row changed or disappeared', async () => {
    wix.conditionalApplied = false;
    wix.queryRows.c = () => [{ id: 'item-1', dataCollectionId: 'c', data: { claimedAt: NOW } }];
    expect(await claimWixSweepRow(params)).toBe('contended');
    wix.queryRows.c = () => [];
    expect(await claimWixSweepRow(params)).toBe('contended');
  });

  it('unverifiable (graceful fallback) when rejected but the row is unchanged', async () => {
    wix.conditionalApplied = false;
    wix.queryRows.c = () => [{ id: 'item-1', dataCollectionId: 'c', data: {} }];
    expect(await claimWixSweepRow(params)).toBe('unverifiable');
  });

  it('contended (fail safe) when the re-read itself fails', async () => {
    wix.conditionalApplied = false;
    wix.queryRows.c = () => {
      throw new Error('network');
    };
    expect(await claimWixSweepRow(params)).toBe('contended');
  });
});
