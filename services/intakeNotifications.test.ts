import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  notifyIntakeSubmissionNeedsAttention,
  resolveIntakeNotificationRecipients,
  intakeNotificationId,
} from './intakeNotifications';
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
 * Intake activation (2026-10) — the first notification trigger wired for
 * work Manors actually does, and the first notification delivery of any
 * kind in this product's production life.
 *
 * The safety property these pin down is not "it notifies" but "it
 * notifies ONLY in-app". In production every staff preference row has
 * email on with instant digest, one has SMS on, and Resend and Twilio are
 * both configured — so a trigger that trusted preferences alone would
 * have sent real email and a real text on the first stuck submission.
 */
const ORG = DEFAULT_ORGANIZATION_ID;

function ctx(overrides: Partial<ActivityContext> = {}): ActivityContext {
  return {
    organizationId: ORG,
    actorIdentityId: null,
    actorMembershipId: null,
    actorRoleKey: null,
    correlationId: 'corr-intake',
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

const params = {
  submissionId: 'sub-1',
  formLabel: 'Manors Cremation Arrangement Forms',
  submissionReference: '6674600018717643738',
  reason: 'Could not be matched to a case' as const,
  receivedAt: '2026-10-13T12:00:00.000Z',
};

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

describe('intake notifications are in-app only', () => {
  it('creates an in_app delivery and NO email or sms, even with every channel enabled', async () => {
    // Exactly the live production preference shape.
    const staff = membership({ identityId: 'identity-intake', role: 'officeStaff' });
    membershipFixtures.push(staff);
    notificationPreferenceFixtures.push({
      id: `${ORG}-identity-intake`,
      organizationId: ORG,
      identityId: 'identity-intake',
      emailEnabled: true,
      inAppEnabled: true,
      smsEnabled: true,
      digestFrequency: 'instant',
      quietHoursStart: null,
      quietHoursEnd: null,
      categoryOverrides: {},
    typeOverrides: {},
      lastDigestSentAt: null,
      updatedAt: '2026-10-01T00:00:00.000Z',
    });

    await notifyIntakeSubmissionNeedsAttention(ctx(), params, 'mock');

    const channels = notificationDeliveryFixtures.map((d) => d.channel);
    expect(channels).toEqual(['in_app']);
    expect(channels).not.toContain('email');
    expect(channels).not.toContain('sms');
  });

  it('still respects a recipient who has turned in-app OFF — the bound narrows, never overrides', async () => {
    membershipFixtures.push(membership({ identityId: 'identity-optout', role: 'officeStaff' }));
    notificationPreferenceFixtures.push({
      id: `${ORG}-identity-optout`,
      organizationId: ORG,
      identityId: 'identity-optout',
      emailEnabled: true,
      inAppEnabled: false,
      smsEnabled: true,
      digestFrequency: 'instant',
      quietHoursStart: null,
      quietHoursEnd: null,
      categoryOverrides: {},
    typeOverrides: {},
      lastDigestSentAt: null,
      updatedAt: '2026-10-01T00:00:00.000Z',
    });

    await notifyIntakeSubmissionNeedsAttention(ctx(), params, 'mock');
    expect(notificationDeliveryFixtures).toHaveLength(0);
  });
});

describe('intake notification recipients', () => {
  it('goes to staff who can act on it, by permission rather than role name', async () => {
    // officeStaff and funeralDirector both hold case.create; readOnly does not.
    membershipFixtures.push(
      membership({ identityId: 'identity-office', role: 'officeStaff' }),
      membership({ identityId: 'identity-director', role: 'funeralDirector' }),
      membership({ identityId: 'identity-readonly', role: 'readOnly' }),
    );

    const recipients = await resolveIntakeNotificationRecipients(ORG, 'mock');
    expect(recipients).toContain('identity-office');
    expect(recipients).toContain('identity-director');
    expect(recipients).not.toContain('identity-readonly');
  });

  it('skips removed memberships', async () => {
    membershipFixtures.push(
      membership({ identityId: 'identity-active', role: 'officeStaff' }),
      membership({ identityId: 'identity-gone', role: 'officeStaff', status: 'removed' }),
    );
    const recipients = await resolveIntakeNotificationRecipients(ORG, 'mock');
    expect(recipients).toEqual(['identity-active']);
  });

  it('never reaches another organization', async () => {
    membershipFixtures.push(
      membership({ identityId: 'identity-mine', role: 'officeStaff' }),
      membership({ identityId: 'identity-theirs', role: 'officeStaff', organizationId: SECOND_MOCK_ORGANIZATION_ID }),
    );

    await notifyIntakeSubmissionNeedsAttention(ctx(), params, 'mock');

    expect(notificationRecipientFixtures.map((r) => r.identityId)).toEqual(['identity-mine']);
    expect(notificationFixtures.every((n) => n.organizationId === ORG)).toBe(true);
  });

  it('a second organization notifies its OWN staff for its own submission', async () => {
    membershipFixtures.push(
      membership({ identityId: 'identity-mine', role: 'officeStaff' }),
      membership({ identityId: 'identity-theirs', role: 'officeStaff', organizationId: SECOND_MOCK_ORGANIZATION_ID }),
    );

    await notifyIntakeSubmissionNeedsAttention(ctx({ organizationId: SECOND_MOCK_ORGANIZATION_ID }), params, 'mock');

    expect(notificationRecipientFixtures.map((r) => r.identityId)).toEqual(['identity-theirs']);
  });
});

describe('intake notification content', () => {
  beforeEach(() => {
    membershipFixtures.push(membership({ identityId: 'identity-intake', role: 'officeStaff' }));
  });

  it('names the form, the submission and the reason', async () => {
    await notifyIntakeSubmissionNeedsAttention(ctx(), params, 'mock');
    const created = notificationFixtures[0];
    expect(created.title).toBe('JotForm submission needs attention');
    expect(created.body).toContain('Manors Cremation Arrangement Forms');
    expect(created.body).toContain('6674600018717643738');
    expect(created.body).toContain('Could not be matched to a case');
  });

  it('carries no deceased or family information', async () => {
    // The whole reason the template has no decedent token: triaging a
    // stuck submission never needs it, and this lands in several inboxes.
    await notifyIntakeSubmissionNeedsAttention(
      ctx(),
      { ...params, formLabel: 'Arrangement Forms' },
      'mock',
    );
    const created = notificationFixtures[0];
    expect(`${created.title} ${created.body}`).not.toMatch(/decedent|deceased|next of kin/i);
  });

  it('links to the review screen and references the submission', async () => {
    await notifyIntakeSubmissionNeedsAttention(ctx(), params, 'mock');
    const created = notificationFixtures[0];
    expect(created.actionUrl).toBe('/unmatched-forms');
    expect(created.entityType).toBe('externalFormSubmission');
    expect(created.entityId).toBe('sub-1');
  });

  it('distinguishes the failure reasons', async () => {
    await notifyIntakeSubmissionNeedsAttention(
      ctx(),
      { ...params, submissionId: 'sub-fail', reason: 'Automatic case creation failed' },
      'mock',
    );
    expect(notificationFixtures[0].body).toContain('Automatic case creation failed');
  });
});

describe('repeated webhook delivery does not duplicate', () => {
  beforeEach(() => {
    membershipFixtures.push(membership({ identityId: 'identity-intake', role: 'officeStaff' }));
  });

  it('a redelivery of the same unresolved submission creates nothing new', async () => {
    const first = await notifyIntakeSubmissionNeedsAttention(ctx(), params, 'mock');
    const second = await notifyIntakeSubmissionNeedsAttention(ctx(), params, 'mock');

    expect(first.notified).toBe(1);
    expect(second.notified).toBe(0);
    expect(notificationFixtures).toHaveLength(1);
    expect(notificationRecipientFixtures).toHaveLength(1);
  });

  it('preserves read state across a redelivery — a handled issue does not resurface', async () => {
    await notifyIntakeSubmissionNeedsAttention(ctx(), params, 'mock');
    const recipient = notificationRecipientFixtures[0];
    const index = notificationRecipientFixtures.indexOf(recipient);
    notificationRecipientFixtures[index] = { ...recipient, readAt: '2026-10-13T13:00:00.000Z' };

    await notifyIntakeSubmissionNeedsAttention(ctx(), params, 'mock');

    expect(notificationRecipientFixtures).toHaveLength(1);
    expect(notificationRecipientFixtures[0].readAt).toBe('2026-10-13T13:00:00.000Z');
  });

  it('a DIFFERENT submission still notifies', async () => {
    await notifyIntakeSubmissionNeedsAttention(ctx(), params, 'mock');
    await notifyIntakeSubmissionNeedsAttention(ctx(), { ...params, submissionId: 'sub-2' }, 'mock');
    expect(notificationFixtures).toHaveLength(2);
  });

  it('uses a deterministic id per (submission, recipient)', () => {
    expect(intakeNotificationId('sub-1', 'identity-a')).toBe('intake-attention-sub-1-identity-a');
    expect(intakeNotificationId('sub-1', 'identity-a')).toBe(intakeNotificationId('sub-1', 'identity-a'));
    expect(intakeNotificationId('sub-1', 'identity-a')).not.toBe(intakeNotificationId('sub-2', 'identity-a'));
  });
});

describe('intake notification failure is never fatal', () => {
  it('returns zero rather than throwing when there are no recipients at all', async () => {
    const result = await notifyIntakeSubmissionNeedsAttention(ctx(), params, 'mock');
    expect(result.notified).toBe(0);
    expect(notificationFixtures).toHaveLength(0);
  });
});
