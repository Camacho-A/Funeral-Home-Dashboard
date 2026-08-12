# ADR-038: Scheduling Integrations, Calendar Sync & Automated Reminders

**Status:** Accepted
**Date:** 2026-08-12

## Context

Phase 27 (ADR-031) built Beacon's scheduling core — appointments, resources, recurrence, conflict detection — and deliberately reserved every external-facing capability (Google/Outlook sync, ICS, SMS/email reminders) as a named, unbuilt extension point: `lib/schedulingNotifier.ts`'s `SchedulingNotifier` interface shipped with zero concrete implementation and zero call sites. Phase 33 (ADR-037) closed the one real prerequisite this reservation was blocked on: Beacon had no background/scheduled-job mechanism anywhere, so a time-based reminder ("2 hours before this appointment") had nowhere to run from. Phase 33's Vercel Cron primitive (`CRON_SECRET`-gated route + `vercel.json`) proved out end to end, including a real production bug found and fixed via live verification.

ADR-037 named this exact follow-on explicitly: *"`SchedulingNotifier` concrete implementation / `INVOICE_OVERDUE` real trigger — both now technically unblocked by this phase's cron primitive, but neither is built here; each has its own trigger semantics to design."* This phase is that design for scheduling. It also extends Beacon outward for the first time — real Google/Microsoft calendar connections — new architectural surface with no prior Beacon precedent (OAuth, per-identity encrypted secrets, an external system Beacon must never treat as authoritative).

## Decision

Build three independent, additively-composed capabilities on top of the existing scheduling core, none of which touch `Appointment`/`Resource`/`RecurrenceDefinition` data directly:

1. **Automated appointment reminders** — a new `appointmentReminderService.ts`, called from `schedulingService.ts`'s existing lifecycle points, that pre-computes reminder rows and dispatches them through the already-real `notificationService.ts` (Phase 33's real Resend/Twilio delivery, digest/quiet-hours honoring — all inherited for free).
2. **ICS export** — pure, I/O-free single-event and personal-feed calendar file generation, plus hash-at-rest feed tokens for the personal subscription feed.
3. **One-way Google/Microsoft calendar sync** — OAuth-connected staff calendars, with Beacon remaining canonical and every external write happening asynchronously, in a cron sweep, never in the request path that created the appointment.

`SchedulingNotifier` remains exactly as Phase 27 shipped it — reserved, unused. This phase does not resurrect it; it extends the already-real `notificationService.createNotification()` integration Phase 30 established, the direction the codebase already committed to.

## The single most important invariant

`schedulingService.ts`'s appointment-mutation functions never `await` a Google/Microsoft API call, directly or transitively. They only ever write a `calendarEventLinks` row (`status: 'pending'`) — a cheap, same-Wix-transaction-class operation identical in cost/risk to the `notifyAppointmentOwner()` call that already happens today. The actual external HTTP call to Google/Microsoft happens exclusively inside the cron-triggered sweep, in a separate request entirely. This is *stronger* isolation than Phase 33's own email/SMS dispatch (which calls the provider synchronously inside `dispatchChannel`, with try/catch) — deliberately: appointment creation must never be at risk of io-latency or failure from an OAuth-scoped third-party API the way a notification send already tolerates.

## Architecture

```
┌─ Reminders (reuses NotificationService, Phase 33 cron pattern) ─────────────┐
│ schedulingService.ts (create/reschedule/cancel/complete, + draft promotion) │
│   → appointmentReminderService.ts (sole writer of appointmentReminders)     │
│       schedules/cancels AppointmentReminder rows at the same 4 lifecycle    │
│       points notifyAppointmentOwner() already hooks into                    │
│                                                                               │
│ vercel.json (+1 crons entry) → POST /api/cron/appointment-reminders         │
│   → appointmentReminderService.runAppointmentReminderSweep()                │
│       queries appointmentReminders WHERE status='scheduled' AND             │
│       scheduledFor<=now (bounded, dedicated index, org-agnostic —           │
│       the sweep's one deliberate exception)                                 │
│       → notificationService.createNotification() only — never a channel/    │
│         collection touched directly                                         │
└───────────────────────────────────────────────────────────────────────────┘

┌─ ICS (read-only projection, no external accounts) ───────────────────────────┐
│ GET /api/appointments/[id]/ics          → icsService.ts                     │
│ GET /api/calendar-feed/[token]          → calendarFeedTokenService.ts       │
│ GET /api/family/cases/[caseId]/appointments/[id]/ics (family, capability-   │
│   gated identically to the existing view)                                   │
└───────────────────────────────────────────────────────────────────────────┘

┌─ Calendar connections + one-way sync ────────────────────────────────────────┐
│ Settings → Calendar Integrations UI                                         │
│   → app/api/calendar-connections/*  (list/disconnect, self-scoped)          │
│   → app/api/calendar-connections/{google,microsoft}/start   (OAuth kickoff) │
│   → app/api/calendar-connections/{google,microsoft}/callback (OAuth return) │
│       → calendarConnectionService.ts (sole writer of calendarConnections)   │
│           ↓ behind a provider-neutral interface                             │
│           CalendarProvider: authorize/exchangeCode/refresh/createEvent/     │
│             updateEvent/deleteEvent/listCalendars                           │
│           ├─ googleCalendarProvider.ts (real, direct fetch, no SDK)         │
│           └─ microsoftCalendarProvider.ts (real, direct fetch, no SDK)      │
│                                                                               │
│ schedulingService.ts (create/reschedule/cancel) → calendarSyncService.ts    │
│   marks/creates calendarEventLinks rows status='pending' — SYNCHRONOUS      │
│   Wix write only, NEVER calls Google/Microsoft in the request path          │
│                                                                               │
│ vercel.json (+1 crons entry) → POST /api/cron/calendar-sync                 │
│   → calendarSyncService.runCalendarSyncSweep()                              │
│       queries calendarEventLinks WHERE syncStatus IN                        │
│       ('pending','retry_pending') (bounded, dedicated index, org-agnostic)  │
│       → calls the CalendarProvider for that link's connection               │
│       → provider failure: retry_pending (bounded backoff) → failed          │
│         (never touches the Appointment itself; never blocks scheduling)     │
└───────────────────────────────────────────────────────────────────────────┘
```

## Reminder model

`AppointmentReminder` (`types/appointmentReminder.ts`) — one row per (appointment, lead time, recipient), deterministic id (`` `${appointmentId}-${leadTimeMinutes}-${recipientType}-${recipientRef}` ``) so re-scheduling an unchanged appointment is a no-op upsert, not a duplicate. **No `'processing'`/intermediate-claim state**, deliberately — Wix Data has no optimistic-concurrency/compare-and-swap support (confirmed negative since Phase 22). The digest sweep (Phase 33) already accepted this exact class of risk without a claim step; a row's status flipping away from the query-matched state as the very next persisted action after `createNotification` succeeds is the only guard, plus Vercel Cron invocations not overlapping in practice within a 15-minute window a sweep completes in seconds. Delivery-time duplication is prevented the same way: a row already `sent`/`cancelled`/`skipped`/`failed` is never re-matched by the sweep's `status='scheduled'` filter.

`AppointmentReminder` does **not** store its own delivery channel. It triggers exactly one `notificationService.createNotification()` call per recipient per lead time; channel selection (in-app/email/SMS) is entirely `NotificationPreference`'s job, exactly as for every other notification type. Pre-deciding a channel here would duplicate logic Phase 33 already owns.

**Reminder rows are created eagerly, at the same 4 lifecycle points `notifyAppointmentOwner()` already hooks into** — never computed lazily by scanning `appointments` (impossible anyway: `appointments` has zero free index slots):

- `createAppointment` → schedule fresh reminders (only once `saveAsDraft` is false — never for a draft).
- `rescheduleAppointment` → cancel every existing `scheduled` reminder for the appointment, then re-schedule fresh ones against the new `startAt`. This is the direct fix for "a reschedule must not leave obsolete reminders active."
- `cancelAppointment` → cancel every existing `scheduled` reminder. Terminal — never rescheduled.
- `completeAppointment` (both `completed` and `no_show`) → cancel every remaining future `scheduled` reminder (a reminder for an appointment that already happened is meaningless).
- Draft → Scheduled promotion (`updateAppointmentResources`'s existing auto-promotion path) → schedules reminders for the first time, since none exist yet for a row created as a draft.
- Recurring series: each materialized occurrence goes through the same `createAppointment` path, so reminders are scheduled per-occurrence automatically, with zero extra recurrence-aware logic. A recurrence exception is mechanically just a row that went through `rescheduleAppointment` — already correctly handled.

## Reminder policy — bounded, not a rules engine

`SchedulingReminderPolicy`, one row per organization (deterministic Wix `_id = organizationId`, no `beacon<Thing>Id` field — mirrors `caseSequences`/`paymentIntegrations`' natural-key precedent): `leadTimesMinutes: number[]`, `notifyOwner: boolean` (default `true`), `notifyFamily: boolean` (default `false`, explicit opt-in). No per-appointment-type variation this phase — a single bounded, admin-editable list is the right level of power for one organization's reminder policy; a per-appointment-type override is a plausible future need, not one any current Beacon customer has asked for, so it is named as deferred rather than built speculatively. A missing row resolves to a synthetic default, mirroring `NotificationPreference`'s own "missing row = default view, never eagerly seeded" pattern.

**Family-reminder gating is derived, not configured**: `notifyFamily` only ever applies where `Appointment.caseId` is non-null *and* at least one active `PortalAccess` grant exists for that case with the `appointment.read` capability, via a new `portalAccessService.ts#listActiveAccessForCase` (a small, additive, read-only function — no such multi-grant lookup existed before this phase; only single-grant `(portalUserId, caseId)` lookups did).

## Recipient resolution — real identity relationships only

**Staff**: `Appointment.ownerStaffProfileId` → `StaffProfile` (must be `isActive: true`, its `Membership.status === 'active'`, mirroring `assertStaffProfileIsActiveAndInOrganization`'s exact existing check) → `StaffProfile.identityId`. If `ownerStaffProfileId` is null or the check fails, the reminder is written with `recipientIdentityId` unresolved and immediately marked `status: 'skipped'` (with a reason) at scheduling time — never invented, never silently defaulted to "notify an admin."

**Family**: one `AppointmentReminder` row per active `PortalAccess` grant with `appointment.read`, `recipientType: 'family_portal_user'`. At send time, `notificationService.createNotification({ recipientScope: 'portal_user', recipientPortalUserId, notificationType: 'family.appointment_reminder', ... })` — activating, for the first time, the notification type Phase 28 registered but never wired.

**Never**: display-name matching, email-address matching, or a legacy `StaffProfile.id` used without the identity hop.

## NotificationService integration

Two notification types, added to `domain/notifications/notificationTypeRegistry.ts` following the existing pattern: `scheduling.appointment_reminder` (staff, new) and `family.appointment_reminder` (already registered by Phase 28, this phase adds its first real emitter). A new `appointmentStartAt` token was added to `NotificationTokens`/`RECOGNIZED_TOKENS`, following Phase 32/33's own safe-token-addition mechanism (`assertOnlyRecognizedTokens` catches a typo at test time, not in production).

Everything Phase 33 already enforces is inherited for free: preference/category-override honoring, email/SMS availability gating, digest/quiet-hours deferral, tenant isolation, delivery-status persistence, provider-failure honesty. `appointmentReminderService.ts` never imports a channel file, the recipient resolver, or activity helpers directly — it calls only `notificationService.createNotification()`, the same single-call-surface discipline `notificationDigestService.ts` established in Phase 33.

## ICS architecture

**Materialized VEVENTs, not RRULE export** — a deliberate answer, not a default. Beacon's recurrence is already fully materialized into independent `Appointment` rows (Phase 27); reconstructing an RRULE would mean reverse-engineering a pattern Beacon doesn't store abstractly, risking an RRULE whose expansion silently diverges from Beacon's real, edited-exception-aware occurrence list. One independent `VEVENT` per materialized `Appointment` is simpler, always correct by construction, and the 104-occurrence recurrence cap already bounds any feed's size.

`lib/icsService.ts` is pure and I/O-free: `UID: beacon-appointment-{appointmentId}@beacon.app` (deterministic, stable across re-downloads); `DTSTART`/`DTEND` emitted in UTC (`...Z`, derived from the already-ISO `startAt`/`endAt`) rather than `TZID`+`VTIMEZONE`, sidestepping DST-edge-case bugs a hand-rolled timezone block could introduce; a cancelled appointment emits `STATUS:CANCELLED` (RFC5545's own mechanism for "this event is now cancelled") rather than silently disappearing from the feed; `LOCATION` resolves through a new `services/scheduling/appointmentLocationText.ts#resolveLocationText` from `Appointment.locationId` → the real `OrganizationLocation` address text. RFC5545 §3.3.11 text escaping and §3.1 75-octet line folding (char-count approximation) are both implemented directly — no ICS library dependency was added.

**Two distinct DTO→ICS mapping paths**, matching the pre-existing staff/family DTO split — never one shared path risking over-exposure: staff (`GET /api/appointments/[id]/ics`, and the personal feed) may include `DESCRIPTION` from `Appointment.notes`; family (`GET /api/family/cases/[caseId]/appointments/[id]/ics`) is built from `PortalAppointmentView` only — no `notes`, matching every other family-facing surface's existing withholding.

**Feed scope, this phase's baseline: one type of subscription feed — a staff member's personal feed** (their own owned appointments), token-gated. Organization-wide and resource-specific feeds are named as deferred extension points, not built speculatively.

**Feed tokens** (`calendarFeedTokens`): the bearer token is high-entropy random (32 bytes, base64url), shown exactly once at generation time; only its SHA-256 hash is ever persisted — reusing `lib/identity/tokens.ts`'s existing `generateToken()`/`hashToken()`/`verifyTokenHash()` (built for Phase 21's email-verification/password-reset tokens) rather than reimplementing. `GET /api/calendar-feed/[token]` hashes the incoming token and looks up by hash — never a plaintext-token query. A revoked token resolves identically to a nonexistent one, never distinguished (existence-hiding, matching the Family Portal's own established discipline). Revocation sets `revokedAt`; regenerating revokes the old row and mints a new one. `lastAccessedAt` updates on every successful pull.

## Calendar connection model

`CalendarConnection` (`types/calendarConnection.ts`), keyed by `staffProfileId` — never `identityId` directly, per ADR-034's hard layering invariant. `types/identityLayeringInvariant.test.ts`'s `FILES_TO_CHECK` array gained `'calendarConnection.ts'`, extending the invariant's coverage to this genuinely new operational-assignment entity (a persistent row saying "this StaffProfile's calendar is connected").

Deterministic id (`` `${organizationId}-${staffProfileId}-${provider}` ``) enforces at most one connection per (staff, provider) by construction — Wix Data has no compound-unique support.

**Encryption**: a new sibling module `lib/identity/calendarTokenEncryption.ts`, structurally identical to `mfaSecretEncryption.ts` (AES-256-GCM, random 12-byte IV, `iv‖authTag‖ciphertext` base64), keyed by a new, dedicated `CALENDAR_TOKEN_ENCRYPTION_KEY` — deliberately not reusing `MFA_ENCRYPTION_KEY`, since no precedent in this codebase shares one secret-class key across unrelated secret classes; a compromise of one key must not expose the other. Same dev-fallback/prod-hard-fail shape as every other secret-material env var in `lib/env.ts`.

**Self-scoped by default**, mirroring `NotificationPreference`'s posture: connecting/disconnecting one's own calendar needs no RBAC permission beyond authentication, resolved via `resolveStaffProfileForCaller`. Organization-wide oversight (viewing every connection's health, force-disconnecting someone else's) repurposes `calendar.manage` (Phase 27, reserved, never wired until now).

## Provider abstraction

```ts
// services/calendar/calendarProvider.ts
interface CalendarProvider {
  buildAuthorizeUrl(state: string): string;
  exchangeCodeForTokens(code: string): Promise<{ accessToken, refreshToken, expiresAt, accountEmail }>;
  refreshAccessToken(refreshToken: string): Promise<{ accessToken, refreshToken, expiresAt }>;
  listCalendars(accessToken: string): Promise<Array<{ id, name }>>;
  createEvent(accessToken: string, calendarId: string, draft: CalendarEventDraft): Promise<CalendarEventRef>;
  updateEvent(accessToken: string, ref: CalendarEventRef, draft: CalendarEventDraft): Promise<void>;
  deleteEvent(accessToken: string, ref: CalendarEventRef): Promise<void>;
}
```

Mirrors `EmailProvider`/`SmsProvider`'s exact shape: one real implementation per provider (`googleCalendarProvider.ts`, `microsoftCalendarProvider.ts` — direct `fetch`, no SDK, matching every existing external-API integration in this codebase: Clover, Resend, Twilio). Selected only inside `calendarSyncService.ts`/`calendarConnectionService.ts`, never imported by `schedulingService.ts` or any UI component. Unlike email/SMS's single global `getXProvider()`, calendar provider selection is **per-connection-row** (`connection.provider`), not a singleton — the interface shape accommodates this directly.

**Google**: scope `calendar.events` (not the broader `calendar` scope, and not the narrower, less-documented `calendar.events.owned`), plus `calendar.readonly` for `listCalendars()`. `access_type=offline&prompt=consent` for a reliable refresh token. Recurrence is irrelevant to the push model — every materialized occurrence is pushed as its own independent event, the same reasoning as ICS's own materialized-VEVENT choice. Push notifications (watch/webhook) are not used — the one-way baseline never needs to learn about external changes. Google app-verification (required before `calendar.events` can be used by more than an allowlisted test-user set) is a real, external, non-code blocker this ADR cannot resolve — disclosed, not solved.

**Microsoft**: scopes `Calendars.ReadWrite` + `offline_access` + `openid profile email`. Registered as multi-tenant + personal ("Accounts in any organizational directory and personal Microsoft accounts") since Beacon serves many independent, potentially differently-tenanted funeral homes. **Refresh tokens rotate on every use** and expire after 90 days of inactivity — `refreshTokenCiphertext` is overwritten on every single refresh, never treated as static; the sync sweep proactively refreshes a connection nearing `tokenExpiresAt` even between real sync activity. Tenant-admin-consent friction (some M365 business tenants require an admin to grant consent before any third-party app OAuth completes) is a real, external limitation entirely outside Beacon's control — the UI surfaces Microsoft's own error clearly rather than presenting it as a Beacon bug.

## Synchronization model — one-way, Beacon → external

**Recommended, not merely defaulted to.** Two-way sync would require Beacon to treat inbound external edits/deletions as a new class of untrusted, asynchronous input needing a reconciliation strategy Beacon has no versioning/OCC mechanism to build "last-writer-wins with a real conflict signal" on (confirmed negative, Phase 22); a policy for external deletions on appointments tied to a signature request or payment; and — most fundamentally — a real risk of external calendar data becoming a second, competing source of truth for exactly the invariant this phase exists to protect ("Beacon appointments remain canonical"). None of this has a customer-driven need behind it. One-way avoids all of it by construction, not by omission.

## Sync lifecycle

`CalendarEventLink` (`types/calendarEventLink.ts`), deterministic id `` `${appointmentId}-${calendarConnectionId}` `` (idempotency by construction — a repeated sync trigger upserts, never duplicates):

| Appointment event | Effect on `CalendarEventLink` |
|---|---|
| Created (not draft, owner has an active connection) | New link, `syncStatus: 'pending'`, `externalEventId: null` |
| Rescheduled / resources changed | Existing link → `'pending'` again |
| Cancelled | → `'pending'`; sweep branches on live `Appointment.status`: `cancelled` → `deleteEvent` then **delete the link row entirely** (so "a link exists" always means "an external event exists") |
| Completed / no-show | No sync action — the external event is left as-is, matching how a real calendar naturally retains past events |
| Owner changed to a different StaffProfile | Cancel-on-old-owner's-connection + create-on-new-owner's-connection, never a "move" — Google/Microsoft's OAuth-scoped APIs have no cross-user move operation; each user's calendar is only writable via their own token |
| Calendar disconnected | `CalendarConnection.status → 'disconnected'`; existing links for that connection → `syncStatus: 'disconnected'`, left as historical record, **never retried**; the `Appointment` itself is completely untouched |
| Provider unavailable during a sync attempt | `syncStatus: 'retry_pending'`, `retryCount++`; the `Appointment` write that triggered this already succeeded — failure is discovered and handled entirely inside the separate cron sweep |

**Lazy detection at sweep time** (a pattern established here, new to this codebase): `calendarConnectionService.ts#disconnect` does not eagerly write to `calendarEventLinks` — doing so would require a circular import back from the connection service into the sync service. Instead, `runCalendarSyncSweep` itself detects a non-`'connected'` connection status at sweep time and flips the affected link to `'disconnected'` on the spot, never retried again.

**Reactivation, not recreation**: `markPendingForAppointment`'s upsert resets `retryCount: 0` on every fresh trigger (a new desired state supersedes stale backoff history) while preserving `externalEventId`/`beaconAppointmentVersion`/`lastSyncedAt` from any existing row.

## Failure/retry model

Bounded exponential backoff: `RETRY_BACKOFF_MS = [60_000, 300_000, 1_800_000, 14_400_000, 86_400_000]` (1m/5m/30m/4h/24h), `MAX_RETRY_COUNT = 5`, terminal transition to `'failed'` fires exactly one in-app `notificationService.createNotification()` (`notificationType: 'calendar.sync.failed'`, category `system`) to the connection's owning staff member — "your calendar sync has stopped working, reconnect from Settings" — and exactly one `calendar.sync.failed` activity event. Neither fires on any transient retry — that would be alert-noise, and this codebase's own established discipline (Phase 24, Phase 32) already rejects high-frequency low-information audit/notification events.

## OAuth/security architecture

- **State parameter**: the `start` route mints a high-entropy random `state`, sets it in a signed, httpOnly cookie (`lib/auth/calendarOAuthState.ts`'s `OAUTH_STATE_COOKIE_NAME`/`oauthStateCookieOptions()`, mirroring `lib/auth/session.ts#cookieOptions()`); the `callback` route verifies the returned `state` matches before exchanging the authorization code. This is the OAuth-native substitute for `requireSameOrigin` on the callback specifically, since Google/Microsoft's redirect is never same-origin — the same shape of solution the Clover webhook already established (skip the origin check, substitute a purpose-built authenticity mechanism), a different mechanism.
- **CSRF**: the `start` route (initiated by an authenticated staff member clicking "Connect") **does** call `requireSameOrigin` — a normal same-origin, cookie-authenticated action up until the redirect. Only the `callback` route is exempt.
- **Token storage**: AES-256-GCM per the encryption section above, never plaintext, never logged.
- **Tenant isolation**: `CalendarConnection`/`CalendarEventLink`/`AppointmentReminder`/`SchedulingReminderPolicy` all carry `organizationId`; every route-level read scopes via `requireAuthorizedOrganization`, identical to every other route in this codebase.
- **Connection ownership**: only the owning `StaffProfile` (or an administrator/manager via `calendar.manage`) may disconnect a connection, enforced via `resolveStaffProfileForCaller` matching `connection.staffProfileId` or the `calendar.manage` policy check as an alternate path.
- **Revoked/disabled staff**: the sync sweep and reminder sweep both re-verify the owning StaffProfile/Membership is still active immediately before acting, mirroring `assertStaffProfileIsActiveAndInOrganization`'s existing check — a disabled Membership silently halts further sync/reminders for that connection without deleting historical data.
- **Logging redaction**: no access token, refresh token, authorization code, `client_secret`, or ICS feed token is ever passed to `console.log`/`console.error` — every new error path logs only bounded, human-readable messages (`lastErrorCode`/`lastErrorMessage`), the discipline `resendClient.ts`/`smsChannel.ts` already established for provider secrets.
- **Rate limiting**: the `start`/`callback` routes reuse `lib/rateLimiter.ts`'s existing `checkRateLimit` — the same disclosed process-local limitation as every other use of it in this codebase, not newly solved here.

## RBAC

**Zero new permission keys.** `calendar.manage` (Phase 27, reserved, never wired) is repurposed and its catalog description broadened, rather than proliferating a `calendar.connection.read`/`calendar.connection.manage`/`calendar.sync` cluster. Connecting/disconnecting one's *own* calendar needs no permission beyond authentication; viewing/force-disconnecting *any* staff member's connection and configuring `SchedulingReminderPolicy` both require `calendar.manage` (administrator, manager — unchanged tier). Catalog stays at **54**.

## Activity events

Five new types added to `ACTIVITY_EVENT_TYPES`, category `scheduling` for the calendar/reminder ones and `system` for sync-failed: `CALENDAR_CONNECTED` (`scheduling.calendar.connected`), `CALENDAR_DISCONNECTED` (`scheduling.calendar.disconnected`), `APPOINTMENT_REMINDER_SENT` (`scheduling.appointment.reminder_sent`), `APPOINTMENT_REMINDER_FAILED` (`scheduling.appointment.reminder_failed`), `CALENDAR_SYNC_FAILED` (`system.calendar.sync_failed`). **Explicitly not recorded**: routine successful syncs (`pending → synced`), routine reminder-row scheduling/cancellation on ordinary reschedule, or individual retry attempts — all high-frequency, low-information events matching this codebase's own established discipline (Phase 32 made the identical call for routine report views/exports).

**A genuine gap self-discovered during implementation, not part of the original design surface**: the approved plan's own RBAC/activity-event section specified these 5 event types, but no earlier implementation task in this phase had actually added them to the registry or wired their emitters — found and fixed as part of completing the approved plan's own scope, not a deviation from it. The fix also caught and corrected a block-comment self-termination bug in `types/activityEvent.ts`'s own header comment (a literal `*/` embedded mid-prose inside markdown-style emphasis silently closed the `/** */` block early, producing ~50 cascading, superficially unrelated TypeScript syntax errors starting several lines later).

## Wix Data — new collections (63–67)

All five respect the confirmed 3-regular/1-unique-per-collection cap; created via the confirmed-correct `POST /wix-data/v2/collections` + `POST /wix-data/v2/indexes` (always separate calls) mechanisms. Full field-level detail: [`docs/WIX_DATA_SCHEMA.md`](../WIX_DATA_SCHEMA.md), Collections 63–67.

| Collection | Purpose | Indexes |
|---|---|---|
| 63 `appointmentReminders` | Pre-computed reminder schedule | `(organizationId, appointmentId)`; `(status, scheduledFor)` — org-agnostic, sweep's exception |
| 64 `calendarConnections` | OAuth-connected staff calendars | `(organizationId, staffProfileId)` |
| 65 `calendarEventLinks` | External-event mapping | `(organizationId, appointmentId)`; `(syncStatus)` — org-agnostic, sweep's exception |
| 66 `schedulingReminderPolicies` | Org-wide reminder policy, one row/org | none — `_id = organizationId` |
| 67 `calendarFeedTokens` | Hash-at-rest ICS feed tokens | `(tokenHash)`; `(organizationId, ownerStaffProfileId)` |

**No changes to `appointments`/`resources`' own fields** — both are already at Wix Data's 3-regular-index cap with zero slots free, which is exactly why every new access pattern this phase needs (reminders due soon, pending calendar syncs) lives in these five new, freshly-indexed collections rather than attempting a new index on either existing collection.

**Documentation correction made opportunistically while already touching `WIX_DATA_SCHEMA.md` this phase**: `resources.linkedStaffProfileId` and `appointments.ownerStaffProfileId` have been real, live fields since Phase 30 (ADR-034) but were missing from that document's own Collection 37/40 field tables — a pre-existing gap, unrelated to this phase, corrected alongside the new-collection additions.

## API routes

```
GET    /api/calendar-connections                            — list caller's own + (if calendar.manage) org-wide
DELETE /api/calendar-connections/[id]                        — disconnect (owner or calendar.manage)
POST   /api/calendar-connections/google/start                — CSRF-checked, redirects to Google's authorize URL
GET    /api/calendar-connections/google/callback              — state-verified, cross-origin, exchanges code, persists
POST   /api/calendar-connections/microsoft/start              — same shape, Microsoft
GET    /api/calendar-connections/microsoft/callback            — same shape, Microsoft

GET    /api/scheduling/reminder-policy                        — org's SchedulingReminderPolicy (or default)
PATCH  /api/scheduling/reminder-policy                         — calendar.manage only
GET    /api/calendar-sync/links                                — read-only sync-status list, schedule.read

GET    /api/appointments/[appointmentId]/ics                   — single-event download, staff-authenticated
GET    /api/calendar-feed/[token]                               — personal subscription feed, token-authenticated (no session)
GET    /api/family/cases/[caseId]/appointments/[appointmentId]/ics — family single-event download, capability-gated
GET/POST /api/calendar-feed-tokens, DELETE /api/calendar-feed-tokens/[id] — self-scoped generate/list/revoke

POST   /api/cron/appointment-reminders                          — CRON_SECRET-gated, mirrors notification-digest exactly
POST   /api/cron/calendar-sync                                   — CRON_SECRET-gated, same shape
```

Every route follows the established shape: `requireSameOrigin` (except the two OAuth callbacks and the two cron routes, each with its own documented substitute authenticity check) → `getSession`/`resolveStaffProfileForCaller` or `CRON_SECRET`/feed-token check → exactly one service call → `NextResponse.json`.

## UI

**Settings → Calendar Integrations** (`app/(portal)/settings/calendar-integrations/page.tsx`, following the `settings/notifications` precedent shape): connected accounts with health badge/last-sync time, Connect Google/Microsoft, reconnect/disconnect; an additional org-wide section for `calendar.manage` holders. One new manually-added `<a>` link in `TopBar.tsx`'s existing hardcoded nav list — no shared nav registry exists to extend, confirmed rather than assumed. Calendar page gained a small, unobtrusive per-appointment sync-status badge, rendered only when a `CalendarEventLink` exists (unobtrusive by omission), fetched alongside the existing appointments query — no second polling loop. `AppointmentDialog.tsx` gained no reminder-configuration field — reminders are governed entirely by the org-wide policy, so there is nothing appointment-specific to configure, deliberately keeping the dialog's already-substantial field set from growing further. Family Portal's appointments page gained an "Add to calendar" ICS download link, gated by the already-existing `appointment.read` capability — no new portal capability key needed.

## Testing

Provider adapters (`googleCalendarProvider.test.ts`/`microsoftCalendarProvider.test.ts`) stub `fetch` throughout — no real Google/Microsoft call in the automated suite, matching `cloverProvider.test.ts`/`resendClient.test.ts`/`smsChannel.test.ts`'s established, unbroken precedent. `appointmentReminderService.test.ts`/`calendarSyncService.test.ts`/`icsService.test.ts`/`calendarFeedTokenService.test.ts` cover lifecycle hooks, sweep eligibility with a fixed injected `now`, idempotency via deterministic ids, RFC5545 correctness, and feed-token verification (valid/revoked/malformed/nonexistent all handled distinctly and safely). `services/calendarStructuralBoundaries.test.ts` (21 tests) mirrors `financialStructuralBoundaries.test.ts`'s exact walk-the-source-tree harness: sole-writer-per-collection, provider containment (only `calendarConnectionService.ts`/`calendarSyncService.ts` import either provider file), no-route-imports-provider-directly, activity-event emitter boundary, no-direct-Wix boundary for calendar UI/routes, and the extended ADR-034 layering invariant. It also documents explicitly why `listDueReminders`/`listSweepCandidates` need no dedicated structural test: both are private, unexported functions, so TypeScript module privacy alone already enforces "called from nowhere else" — a structural "only file X calls query Y" test is only meaningful when Y is *exported* across a file boundary, as `notificationService.ts#listAllQueuedForDigestDeliveries` is.

The full pre-existing suite (3300+ tests as of Phase 33's close) re-ran unchanged.

## Live Wix verification

Two passes against the real Manor's Cremation tenant (`organizationId: "managed-cremations"`), mirroring every prior phase's disposable-lifecycle discipline.

**Pass 1.** All five collections and their 7 indexes created live via `POST /wix-data/v2/collections` + `POST /wix-data/v2/indexes`, confirmed `ACTIVE`. Field-type vocabulary (`TEXT`/`NUMBER`/`BOOLEAN`/`DATETIME`) confirmed via a live read-only probe of the pre-existing `appointments` collection before creating the new ones.

**Pass 2 (disposable write, on explicit user approval).** (A) `getReminderPolicy`/`updateReminderPolicy` round-tripped correctly against the real organization. (B) A disposable `appointmentReminders` row with a deliberately fake, nonexistent `appointmentId` was run through `runAppointmentReminderSweep('wix')` — proving the org-agnostic `(status, scheduledFor)` index-backed query and the safe "not found → skip" transition, without ever calling `createNotification`, by design (never risking a real notification to a real recipient). (C) A disposable `appointments` row plus a disposable `calendarConnections` row were run through the real `markPendingForAppointment()` and a real `runCalendarSyncSweep('wix')`, with `global.fetch` stubbed *only* for requests to `googleapis.com` — every other fetch call, including Beacon's own internal Wix Data HTTP calls (`runCalendarSyncSweep` needs to query Wix to even find sweep candidates), passed through to the real network unmodified. This proved the full happy-path sync write (pending → provider call → synced) against real production data, with zero real Google/Microsoft credentials ever used or contacted. (D) `calendarFeedTokens` received its own supplementary live round trip: `generateFeedToken` → `resolveFeedToken` (matched) → `listTokensForStaffProfile` (1 row) → `revokeFeedToken` → `resolveFeedToken` again (confirmed `null` — a revoked token no longer resolves).

Every disposable row was deleted afterward; a final residual-check query confirmed zero leftover rows across all five new collections plus `appointments`. **No real notification was ever delivered to a real inbox/phone, and no real external Google/Microsoft calendar was ever connected** — both remain gated on a separate, explicit go-ahead beyond this phase's own plan approval, exactly matching the governing instruction this phase was implemented under.

**Two operational issues found and fixed during this pass, both instructive, neither a design defect:**
- A first attempt's `global.fetch` stub was unscoped and intercepted every fetch call, including Beacon's own internal `queryWixDataItems` calls — breaking `runCalendarSyncSweep`'s own candidate-lookup query with `TypeError: pending.dataItems is not iterable`. Fixed by checking `String(url).includes('googleapis.com')` before returning the stub response, delegating everything else to the real `fetch`. This required a manual cleanup pass (via direct REST calls) of 5 orphaned disposable rows left by the failed first attempt before the corrected script could be re-run cleanly.
- The 5 ActivityEvent types this phase's own plan specified had not actually been added to the registry by any prior task in this phase, and `types/activityEvent.ts`'s new header comment contained a literal `*/` mid-prose that silently terminated its own `/** */` block, cascading into ~50 unrelated-looking TypeScript syntax errors. Both fixed as part of completing this phase's already-approved scope — see "Activity events" above.

## Risks and known limitations

- Wix Data has no OCC/compare-and-swap — the reminder/sync sweeps' theoretical concurrent-overlap race is a real, accepted limitation, identical in class and severity to the one Phase 33's digest sweep already carries.
- Google app verification and Microsoft tenant-admin-consent policies are both real, external, non-code blockers this ADR cannot resolve — only disclosed and routed around at the UX-error-messaging level.
- `lib/rateLimiter.ts` remains process-local — reused, not newly solved, for OAuth callback rate limiting.
- A quiet-hours-deferred 2-hour-ahead reminder landing inside a daily/weekly email digest is a real, disclosed UX edge case — not solved this phase, named as a future `smsDigestFrequency`-style refinement if it proves to matter in practice.
- One-way sync means an appointment deleted directly inside Google/Microsoft (outside Beacon) will silently reappear on that calendar the next time the sweep runs a routine update to a *different* field on the same appointment, since Beacon has no way to detect the external deletion in a one-way model. A direct, accepted consequence of choosing one-way sync, not a surprise discovered mid-implementation.
- Neither Google nor Microsoft's real OAuth flow has been exercised against a live provider in this environment — no real client credentials exist here. The adapters are unit-tested and structurally complete; activating either provider in production is a matter of setting the corresponding env vars, no code change, identical to Clover's own "flip a flag, no code change" story.

## Deferred (explicitly out of scope this phase)

Two-way calendar synchronization (justified against above); public appointment booking; vehicle routing/GPS tracking; automatic resource optimization; AI scheduling; organization-wide or resource-specific ICS subscription feeds (personal-only baseline); per-appointment-type reminder policy variation; a `SchedulingReminderPolicy` rules engine of any kind; push/webhook-based external-change detection for either provider; Zoom/Teams meeting creation; arbitrary workflow automation; native mobile push calendar integration.
