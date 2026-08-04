/**
 * Phase 27 (Scheduling & Resource Management). The notification-sending
 * interface a future phase's real reminder/notification delivery would
 * implement — mirrors `lib/signatureNotifier.ts`'s exact provider-neutral
 * shape (a plain `const x: Interface = concreteImpl` assignment, no
 * factory function, matching every provider in this codebase).
 *
 * **No concrete implementation ships this phase.** Per explicit scope
 * (appointment reminders, staff notifications, and family reminders are
 * named integration points, not a feature to build — "do not build a full
 * notification platform, reserve extension points only"), this interface
 * exists purely so a future phase's real delivery implementation is a new
 * file + one import line in `services/schedulingService.ts`, never a
 * change to that file's own orchestration logic. This is a deliberate
 * difference from Phase 26, where `SignatureNotifier`'s concrete
 * implementation was load-bearing — a signing link cannot reach a signer
 * without it. An appointment has no equivalent hard requirement.
 */
export type SchedulingNotifier = {
  notifyAppointmentCreated(params: { caseDisplayName: string | null; appointmentTitle: string; startAt: string }): Promise<void>;
  notifyAppointmentRescheduled(params: { caseDisplayName: string | null; appointmentTitle: string; fromStartAt: string; toStartAt: string }): Promise<void>;
  notifyAppointmentCancelled(params: { caseDisplayName: string | null; appointmentTitle: string; reason: string | null }): Promise<void>;
  notifyReminder(params: { caseDisplayName: string | null; appointmentTitle: string; startAt: string }): Promise<void>;
};
