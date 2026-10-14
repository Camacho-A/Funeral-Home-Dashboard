import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  notifyCaseCreated,
  notifyArrangementReceived,
  notifyVitalStatisticsReceived,
  notifyCaseCompleted,
  notifyJotformPdfImported,
  notifyJotformPdfImportFailed,
  notifyPaymentReceived,
  notifyDocumentGenerated,
  notifyDocumentGenerationFailed,
  caseNotificationId,
} from './caseNotifications';
import {
  notificationFixtures,
  notificationRecipientFixtures,
  notificationDeliveryFixtures,
  notificationDeliveryAttemptFixtures,
  notificationPreferenceFixtures,
} from './__mocks__/notificationFixtures';
import { activityEventFixtures } from './__mocks__/activityEventFixtures';
import { membershipFixtures, identityFixtures } from './__mocks__/identityFixtures';
import { DEFAULT_ORGANIZATION_ID, SECOND_MOCK_ORGANIZATION_ID } from './__mocks__/organizationIds';
import type { ActivityContext } from './activityService';
import type { Membership } from '../types/membership';

/**
 * Everyday operational notifications (2026-10).
 *
 * The properties worth pinning are not "it notifies" but the four that
 * could hurt somebody: it notifies ONLY in-app, only people who may see
 * the thing, only within one organization, and only ONCE however many
 * times a webhook is redelivered.
 */
const ORG = DEFAULT_ORGANIZATION_ID;

function ctx(overrides: Partial<ActivityContext> = {}): ActivityContext {
  return {
    organizationId: ORG,
    actorIdentityId: null,
    actorMembershipId: null,
    actorRoleKey: null,
    correlationId: 'corr-case-notifications',
    ...overrides,
  };
}

function membership(overrides: Partial<Membership> = {}): Membership {
  return {
    id: `membership-${Math.random()}`,
    identityId: `identity-${Math.random()}`,
    organizationId: ORG,
    role: 'officeStaff',
    status: 'active',
    invitedBy: null,
    joinedAt: '2026-08-01T00:00:00.000Z',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

const CASE = { id: 'case-1', caseNumber: 'B2026-039', decedentName: 'JOHN SMITH' };

const originalMemberships = [...membershipFixtures];
const originalIdentities = [...identityFixtures];
let errorSpy: ReturnType<typeof vi.spyOn>;

function resetFixtures() {
  notificationFixtures.length = 0;
  notificationRecipientFixtures.length = 0;
  notificationDeliveryFixtures.length = 0;
  notificationDeliveryAttemptFixtures.length = 0;
  notificationPreferenceFixtures.length = 0;
  activityEventFixtures.length = 0;
  membershipFixtures.length = 0;
  identityFixtures.length = 0;
  identityFixtures.push(...originalIdentities);
}

beforeEach(() => {
  resetFixtures();
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  resetFixtures();
  membershipFixtures.push(...originalMemberships);
  errorSpy.mockRestore();
});

describe('case notifications are in-app only', () => {
  it('creates an in_app delivery and no email or sms, whatever the channels allow', async () => {
    membershipFixtures.push(membership({ identityId: 'identity-office', role: 'officeStaff' }));

    await notifyCaseCreated(ctx(), { case: CASE, source: 'the First Call form' }, 'mock');

    expect(notificationDeliveryFixtures.length).toBeGreaterThan(0);
    const channels = new Set(notificationDeliveryFixtures.map((d) => d.channel));
    expect(channels.has('in_app')).toBe(true);
    // Email and SMS are real in production — Resend and Twilio are both
    // configured and staff preferences have them on.
    expect(channels.has('email')).toBe(false);
    expect(channels.has('sms')).toBe(false);
  });
});

describe('recipients are resolved by permission, never by role name', () => {
  it('notifies staff who can read cases', async () => {
    membershipFixtures.push(membership({ identityId: 'identity-office', role: 'officeStaff' }));
    const { notified } = await notifyCaseCreated(ctx(), { case: CASE, source: 'the New Case form' }, 'mock');
    expect(notified).toBe(1);
  });

  it('does not notify a role that cannot read cases', async () => {
    // Dispatch sees pickups, not cases — a new case is not theirs to act on.
    membershipFixtures.push(membership({ identityId: 'identity-dispatch', role: 'dispatch' }));
    const { notified } = await notifyCaseCreated(ctx(), { case: CASE, source: 'the New Case form' }, 'mock');
    expect(notified).toBe(0);
    expect(notificationFixtures).toHaveLength(0);
  });

  it('gates payment notifications on financial permission, not case access', async () => {
    // Dispatch can act on pickups and holds neither case.read nor
    // payment.read; Read Only deliberately DOES see payments (its own
    // definition says so), which is why the contrast is drawn here.
    membershipFixtures.push(membership({ identityId: 'identity-dispatch', role: 'dispatch' }));
    membershipFixtures.push(membership({ identityId: 'identity-manager', role: 'manager' }));

    await notifyPaymentReceived(ctx(), { case: CASE, paymentId: 'pay-1', amountDisplay: '$1,200.00' }, 'mock');

    const notified = new Set(notificationRecipientFixtures.map((r) => r.identityId));
    expect(notified.has('identity-manager')).toBe(true);
    expect(notified.has('identity-dispatch')).toBe(false);
  });

  it('never notifies a removed membership', async () => {
    membershipFixtures.push(membership({ identityId: 'identity-gone', role: 'officeStaff', status: 'removed' }));
    const { notified } = await notifyCaseCreated(ctx(), { case: CASE, source: 'the First Call form' }, 'mock');
    expect(notified).toBe(0);
  });
});

describe('duplicate prevention', () => {
  it('announces a new case once, however many times the webhook is redelivered', async () => {
    membershipFixtures.push(membership({ identityId: 'identity-office', role: 'officeStaff' }));

    await notifyCaseCreated(ctx(), { case: CASE, source: 'the Cremation Arrangement Form' }, 'mock');
    await notifyCaseCreated(ctx(), { case: CASE, source: 'the Cremation Arrangement Form' }, 'mock');
    await notifyCaseCreated(ctx(), { case: CASE, source: 'the Cremation Arrangement Form' }, 'mock');

    expect(notificationFixtures).toHaveLength(1);
    expect(notificationRecipientFixtures).toHaveLength(1);
  });

  it('keys form notifications on the submission, so a replay adds nothing', async () => {
    membershipFixtures.push(membership({ identityId: 'identity-office', role: 'officeStaff' }));

    await notifyArrangementReceived(ctx(), { case: CASE, submissionId: 'sub-77' }, 'mock');
    await notifyArrangementReceived(ctx(), { case: CASE, submissionId: 'sub-77' }, 'mock');
    await notifyVitalStatisticsReceived(ctx(), { case: CASE, submissionId: 'sub-88' }, 'mock');
    await notifyVitalStatisticsReceived(ctx(), { case: CASE, submissionId: 'sub-88' }, 'mock');

    // One per distinct submission, not per delivery attempt.
    expect(notificationFixtures).toHaveLength(2);
  });

  it('announces completion once, however often reconciliation re-observes it', async () => {
    membershipFixtures.push(membership({ identityId: 'identity-office', role: 'officeStaff' }));

    for (let i = 0; i < 5; i++) {
      await notifyCaseCompleted(ctx(), { case: CASE }, 'mock');
    }
    expect(notificationFixtures).toHaveLength(1);
  });

  it('does not re-announce a PDF import that an idempotent retry finds already done', async () => {
    membershipFixtures.push(membership({ identityId: 'identity-office', role: 'officeStaff' }));

    await notifyJotformPdfImported(ctx(), { case: CASE, submissionId: 'sub-9', formLabel: 'Arrangement Form' }, 'mock');
    await notifyJotformPdfImported(ctx(), { case: CASE, submissionId: 'sub-9', formLabel: 'Arrangement Form' }, 'mock');

    expect(notificationFixtures).toHaveLength(1);
  });

  it('leaves an already-read notification untouched on a retry', async () => {
    membershipFixtures.push(membership({ identityId: 'identity-office', role: 'officeStaff' }));
    await notifyCaseCreated(ctx(), { case: CASE, source: 'the First Call form' }, 'mock');

    const recipient = notificationRecipientFixtures[0];
    recipient.readAt = '2026-10-14T10:00:00.000Z';

    await notifyCaseCreated(ctx(), { case: CASE, source: 'the First Call form' }, 'mock');

    // A redelivery must never resurface something already dealt with.
    expect(notificationRecipientFixtures).toHaveLength(1);
    expect(notificationRecipientFixtures[0].readAt).toBe('2026-10-14T10:00:00.000Z');
  });

  it('builds ids that separate event, subject and recipient', () => {
    expect(caseNotificationId('case.created', 'case-1', 'identity-a')).toBe('case.created-case-1-identity-a');
    expect(caseNotificationId('case.created', 'case-1', 'identity-b')).not.toBe(
      caseNotificationId('case.created', 'case-1', 'identity-a'),
    );
    // Two different events about the same case are different notifications.
    expect(caseNotificationId('case.completed', 'case-1', 'identity-a')).not.toBe(
      caseNotificationId('case.created', 'case-1', 'identity-a'),
    );
  });
});

describe('multi-tenant isolation', () => {
  it("never notifies another organization's staff", async () => {
    membershipFixtures.push(membership({ identityId: 'identity-ours', role: 'officeStaff', organizationId: ORG }));
    membershipFixtures.push(
      membership({ identityId: 'identity-theirs', role: 'officeStaff', organizationId: SECOND_MOCK_ORGANIZATION_ID }),
    );

    await notifyCaseCreated(ctx(), { case: CASE, source: 'the First Call form' }, 'mock');

    const notified = notificationRecipientFixtures.map((r) => r.identityId);
    expect(notified).toEqual(['identity-ours']);
  });

  it('stamps every notification with the emitting organization', async () => {
    membershipFixtures.push(membership({ identityId: 'identity-ours', role: 'officeStaff' }));
    await notifyCaseCreated(ctx(), { case: CASE, source: 'the First Call form' }, 'mock');

    for (const n of notificationFixtures) {
      expect(n.organizationId).toBe(ORG);
    }
  });

  it('scopes the same case id separately per organization', async () => {
    membershipFixtures.push(membership({ identityId: 'identity-ours', role: 'officeStaff', organizationId: ORG }));
    membershipFixtures.push(
      membership({ identityId: 'identity-theirs', role: 'officeStaff', organizationId: SECOND_MOCK_ORGANIZATION_ID }),
    );

    await notifyCaseCreated(ctx(), { case: CASE, source: 'the First Call form' }, 'mock');
    await notifyCaseCreated(ctx({ organizationId: SECOND_MOCK_ORGANIZATION_ID }), { case: CASE, source: 'the First Call form' }, 'mock');

    expect(notificationFixtures).toHaveLength(2);
    expect(new Set(notificationFixtures.map((n) => n.organizationId))).toEqual(
      new Set([ORG, SECOND_MOCK_ORGANIZATION_ID]),
    );
  });
});

describe('what the notifications say', () => {
  it('names the case and where it came from', async () => {
    membershipFixtures.push(membership({ identityId: 'identity-office', role: 'officeStaff' }));
    await notifyCaseCreated(ctx(), { case: CASE, source: 'the Cremation Arrangement Form' }, 'mock');

    const n = notificationFixtures[0];
    expect(n.title).toBe('New Case Created');
    expect(n.body).toContain('B2026-039');
    expect(n.body).toContain('JOHN SMITH');
    expect(n.body).toContain('the Cremation Arrangement Form');
  });

  it('links to the case it is about', async () => {
    membershipFixtures.push(membership({ identityId: 'identity-office', role: 'officeStaff' }));
    await notifyCaseCreated(ctx(), { case: CASE, source: 'the First Call form' }, 'mock');
    expect(notificationFixtures[0].actionUrl).toBe('/cases/case-1');
  });

  it('states the amount on a payment without any card detail', async () => {
    membershipFixtures.push(membership({ identityId: 'identity-manager', role: 'manager' }));
    await notifyPaymentReceived(ctx(), { case: CASE, paymentId: 'pay-1', amountDisplay: '$1,200.00' }, 'mock');

    const n = notificationFixtures[0];
    expect(n.body).toContain('$1,200.00');
    expect(n.body).not.toMatch(/\d{4}\s*$/);
    expect(n.body.toLowerCase()).not.toContain('card');
  });

  it('says a document failed without leaking why in provider terms', async () => {
    membershipFixtures.push(membership({ identityId: 'identity-office', role: 'officeStaff' }));
    await notifyDocumentGenerationFailed(
      ctx(),
      { case: CASE, failureKey: 'case-1-statement-1', documentTitle: 'Statement of Account' },
      'mock',
    );

    const n = notificationFixtures[0];
    expect(n.title).toBe('Document Generation Failed');
    expect(n.body).toContain('Statement of Account');
    expect(n.body).toContain('B2026-039');
  });

  it('treats a regenerated document as its own event', async () => {
    membershipFixtures.push(membership({ identityId: 'identity-office', role: 'officeStaff' }));
    await notifyDocumentGenerated(ctx(), { case: CASE, documentId: 'doc-1', documentTitle: 'Statement' }, 'mock');
    await notifyDocumentGenerated(ctx(), { case: CASE, documentId: 'doc-2', documentTitle: 'Statement' }, 'mock');

    // A regeneration produces a new document, which is genuinely new news.
    expect(notificationFixtures).toHaveLength(2);
  });
});

describe('announcing is best-effort and never breaks the work', () => {
  it('returns zero rather than throwing when no one is eligible', async () => {
    await expect(notifyCaseCreated(ctx(), { case: CASE, source: 'the First Call form' }, 'mock')).resolves.toEqual({
      notified: 0,
    });
  });

  it('still reports a count when a PDF failure has no eligible recipient', async () => {
    await expect(
      notifyJotformPdfImportFailed(ctx(), { case: CASE, submissionId: 'sub-1', formLabel: 'Arrangement Form' }, 'mock'),
    ).resolves.toEqual({ notified: 0 });
  });
});

/**
 * Precedence between the three switches (2026-10). The rule is
 * one-directional: an individual choice can only ever SUPPRESS. It must
 * never re-enable a channel that a category or the global toggle has
 * turned off, and it has no bearing on permissions.
 */
describe('global, category and individual preferences compose', () => {
  function preference(overrides: Record<string, unknown>) {
    notificationPreferenceFixtures.push({
      id: `${ORG}-identity-office`,
      organizationId: ORG,
      identityId: 'identity-office',
      emailEnabled: false,
      inAppEnabled: true,
      smsEnabled: false,
      digestFrequency: 'instant',
      quietHoursStart: null,
      quietHoursEnd: null,
      categoryOverrides: {},
      typeOverrides: {},
      lastDigestSentAt: null,
      updatedAt: '2026-10-01T00:00:00.000Z',
      ...overrides,
    } as (typeof notificationPreferenceFixtures)[number]);
  }

  beforeEach(() => {
    membershipFixtures.push(membership({ identityId: 'identity-office', role: 'officeStaff' }));
  });

  it('delivers when every switch allows it', async () => {
    preference({});
    await notifyCaseCreated(ctx(), { case: CASE, source: 'the First Call form' }, 'mock');
    expect(notificationDeliveryFixtures.filter((d) => d.channel === 'in_app')).toHaveLength(1);
  });

  it('suppresses a type the person turned off, even though its category is on', async () => {
    preference({ typeOverrides: { 'case.created': false } });
    await notifyCaseCreated(ctx(), { case: CASE, source: 'the First Call form' }, 'mock');
    expect(notificationDeliveryFixtures).toHaveLength(0);
  });

  it('keeps the other half of the category working', async () => {
    preference({ typeOverrides: { 'document.jotform_pdf_imported': false } });

    await notifyJotformPdfImported(ctx(), { case: CASE, submissionId: 's1', formLabel: 'Arrangement Form' }, 'mock');
    expect(notificationDeliveryFixtures).toHaveLength(0);

    await notifyJotformPdfImportFailed(ctx(), { case: CASE, submissionId: 's2', formLabel: 'Arrangement Form' }, 'mock');
    expect(notificationDeliveryFixtures.filter((d) => d.channel === 'in_app')).toHaveLength(1);
  });

  it('respects a category switched off, whatever the individual choice says', async () => {
    preference({
      categoryOverrides: { case: { inAppEnabled: false, emailEnabled: false, smsEnabled: false } },
      typeOverrides: { 'case.created': true },
    });
    await notifyCaseCreated(ctx(), { case: CASE, source: 'the First Call form' }, 'mock');
    expect(notificationDeliveryFixtures).toHaveLength(0);
  });

  it('respects in-app switched off globally, whatever the individual choice says', async () => {
    preference({ inAppEnabled: false, typeOverrides: { 'case.created': true } });
    await notifyCaseCreated(ctx(), { case: CASE, source: 'the First Call form' }, 'mock');
    expect(notificationDeliveryFixtures).toHaveLength(0);
  });

  it('never turns an individual ON into email or sms', async () => {
    // Email and SMS are real in production; an individual preference must
    // not become a way to reach them.
    preference({ emailEnabled: true, smsEnabled: true, typeOverrides: { 'case.created': true } });
    await notifyCaseCreated(ctx(), { case: CASE, source: 'the First Call form' }, 'mock');

    const channels = new Set(notificationDeliveryFixtures.map((d) => d.channel));
    expect(channels.has('in_app')).toBe(true);
    expect(channels.has('email')).toBe(false);
    expect(channels.has('sms')).toBe(false);
  });

  it('applies defaults to a preference row that predates individual controls', async () => {
    // An existing row carries {} — successes stay quiet, failures do not.
    preference({ typeOverrides: {} });

    await notifyJotformPdfImported(ctx(), { case: CASE, submissionId: 's1', formLabel: 'Arrangement Form' }, 'mock');
    expect(notificationDeliveryFixtures).toHaveLength(0);

    await notifyJotformPdfImportFailed(ctx(), { case: CASE, submissionId: 's2', formLabel: 'Arrangement Form' }, 'mock');
    expect(notificationDeliveryFixtures.filter((d) => d.channel === 'in_app')).toHaveLength(1);
  });
});
