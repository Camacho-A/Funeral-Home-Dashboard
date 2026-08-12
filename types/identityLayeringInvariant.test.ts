import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

/**
 * Phase 30 (Identity Model Hardening & Staff Assignment Unification). The
 * hard layering invariant (`types/staffProfile.ts`'s own header comment):
 * no *operational-assignment* field on `Case`/`CaseTask`/`Appointment`/
 * `Resource` is ever allowed to reference `Identity.id` directly — every
 * one terminates at `StaffProfile.id`, and only `StaffProfile` itself
 * resolves further, through its own `identityId`/`membershipId`, into
 * `Membership`/`Identity`.
 *
 * This is a forward-looking regression guard, not a fix for anything
 * currently wrong: a grep-based check that none of these four files ever
 * declares a field literally named `*IdentityId` — the exact naming shape
 * a future "shortcut" field (e.g. `Appointment.ownerIdentityId`, skipping
 * the `StaffProfile` layer this phase just built) would take. The
 * existing, correct **actor-attribution** fields (`createdBy`/
 * `lastModifiedBy`/`cancelledBy`/`generatedBy`/`uploadedBy`/`requestedBy`)
 * are named differently and never trip this pattern today — allow-listed
 * explicitly below anyway, so a future reader can tell at a glance that
 * this is a deliberate, permanent boundary, not an oversight waiting to be
 * "fixed."
 */
const ALLOWED_IDENTITY_ID_FIELDS: readonly string[] = [];

/**
 * Phase 34 (Scheduling Integrations, Calendar Sync & Automated
 * Reminders) adds `calendarConnection.ts` — a genuinely new, stored,
 * *operational* entity ("this staff member's calendar is connected"),
 * so it belongs in this same guarded list; it correctly keys off
 * `staffProfileId`, never `identityId`. `appointmentReminder.ts` is
 * deliberately NOT added here — `AppointmentReminder.recipientIdentityId`
 * is a notification-delivery-layer resolution (resolved once from
 * `Appointment.ownerStaffProfileId` at scheduling time, purely to hand
 * off to `notificationService.createNotification`), the exact same
 * carve-out ADR-034 already describes for `NotificationRecipient.identityId`
 * — never stored back onto the originating entity, never itself an
 * operational-assignment field.
 */
const FILES_TO_CHECK: readonly string[] = ['case.ts', 'task.ts', 'appointment.ts', 'resource.ts', 'calendarConnection.ts'];

describe('Phase 30: hard layering invariant — no *IdentityId operational-assignment field', () => {
  for (const fileName of FILES_TO_CHECK) {
    it(`${fileName} declares no forbidden *IdentityId field`, () => {
      const source = readFileSync(join(__dirname, fileName), 'utf8');
      const fieldPattern = /^\s*(\w+)\??:\s*/gm;
      const offenders: string[] = [];
      let match: RegExpExecArray | null;
      while ((match = fieldPattern.exec(source)) !== null) {
        const fieldName = match[1];
        if (fieldName.endsWith('IdentityId') && !ALLOWED_IDENTITY_ID_FIELDS.includes(fieldName)) {
          offenders.push(fieldName);
        }
      }
      expect(offenders).toEqual([]);
    });
  }
});
