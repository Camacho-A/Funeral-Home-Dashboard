# ADR-037: Real Notification Delivery

**Status:** Accepted
**Date:** 2026-08-12

## Context

Phase 28 (ADR-032) built Beacon's entire notification platform — types, registry, RBAC, recipient resolution, orchestration, UI — on top of two delivery abstractions (`IdentityMessageSender` for mandatory security messages, `EmailProvider` for preference-respecting staff/family notifications) that were deliberately shipped **simulated**: dev mode logs to the server console, production mode throws explicitly rather than pretending to send. This was the right call at the time, but it meant every password reset, invitation, signature request, and staff notification Beacon has ever "sent" had only ever reached a server log, never a real inbox. `NotificationPreference` also reserved four fields — `digestFrequency`, `quietHoursStart`/`quietHoursEnd`, `smsEnabled` — that sat inert with zero enforcement logic since Phase 28, by explicit, documented scope cut.

This phase makes delivery real: a production email provider (Resend) backing both abstractions, a new SMS channel (Twilio), and the two preference fields that were reserved but never built.

## Finding, resolved before implementation

### Digest batching and quiet-hours enforcement need a background/scheduled-job mechanism — Beacon had none, anywhere, in any phase to date

`digestFrequency`/`quietHoursStart`/`quietHoursEnd` require something that runs *without* an incoming HTTP request. Every Beacon code path in every prior phase executes exclusively inside a request/response cycle. This exact gap had been named as a blocker three separate times and left unresolved every time: Phase 27's `SchedulingNotifier.notifyReminder` ("no concrete implementation ships this phase"), Phase 28's own digest/quiet-hours deferral, and Phase 31's `INVOICE_OVERDUE` ("can only be evaluated on-demand").

**Resolution:** Vercel Cron — the smallest primitive that closes it, confirmed as the deploy target via the pre-existing `@vercel/blob` dependency (no `vercel.json` existed before this phase). A new `vercel.json` declares one scheduled job hitting one new, `CRON_SECRET`-gated Route Handler (`POST /api/cron/notification-digest`) every 15 minutes.

**Named limitation:** the cron *schedule* itself cannot be exercised end-to-end in this dev environment — Vercel Cron only fires against a live deployment. The route handler and the sweep function it calls are both fully testable (unit tests, and a direct manual invocation during live verification, see below); only "does Vercel actually call this URL every 15 minutes" is unverifiable here, exactly analogous to Clover's own live-verification gap.

## Architecture

```
Route Handlers (existing, unchanged call sites)
    ↓
services/notificationService.ts createNotification()
    ↓ per recipient
    channel selection: in_app (always) / email (preference) / sms (preference, new)
    ↓ per channel
    dispatchChannel()
      in_app  → notifications/inAppChannel.ts                        (unchanged)
      email   → digest/quiet-hours check → notifications/emailChannel.ts → getEmailProvider()
                                                                              ├─ consoleEmailProvider (dev, unchanged)
                                                                              ├─ resendEmailProvider (NEW — real)
                                                                              └─ productionUnconfiguredEmailProvider (unchanged fallback)
      sms     → notifications/smsChannel.ts (NEW) → getSmsProvider()
                                                        ├─ consoleSmsProvider (dev)
                                                        ├─ twilioSmsProvider (NEW — real)
                                                        └─ productionUnconfiguredSmsProvider

lib/identity/messageSender.ts (mandatory flows — separate, unchanged call sites)
    ↓ getIdentityMessageSender()
      ├─ consoleIdentityMessageSender (dev, unchanged)
      ├─ resendIdentityMessageSender (NEW — real, same underlying Resend client as above)
      └─ productionUnconfiguredIdentityMessageSender (unchanged fallback)

vercel.json (NEW) → every 15 min → POST /api/cron/notification-digest (NEW, CRON_SECRET-gated)
    ↓
services/notificationDigestService.ts runNotificationDigestSweep() (NEW)
    queries notificationDeliveries WHERE status = 'queued_for_digest' (org-agnostic — see below)
    groups by (organizationId, identityId), re-checks eligibility, sends one digest email per group,
    patches included deliveries to 'sent'
```

**One real provider, two thin adapters — not two provider integrations.** `resendEmailProvider` and `resendIdentityMessageSender` both call a single `lib/email/resendClient.ts` (a plain `fetch`-based wrapper around Resend's HTTP API, mirroring `lib/clover/cloverProvider.ts`'s "plain fetch, no SDK" precedent). `IdentityMessageSender`/`EmailProvider` remain fully separate types with separate call sites, exactly as ADR-032 established — this phase does not merge the mandatory/unpreferenced and preference-respecting delivery paths, only their underlying transport.

**A fully-configured real provider wins regardless of `NODE_ENV`** — checked first in each `get*Provider()`/`getIdentityMessageSender()` selection function, so a developer can opt into real sending locally by setting the env vars, matching Clover's own sandbox-flag posture rather than gating real delivery behind `NODE_ENV=production`.

## Digest/quiet-hours mechanism

1. `NotificationPreference` gains `lastDigestSentAt: string | null` and `categoryOverrides: Partial<Record<NotificationCategory, {emailEnabled, inAppEnabled, smsEnabled}>>`.
2. In `dispatchChannel`, before an `'email'` send: if `preference.digestFrequency !== 'instant'` **or** the org-local current time falls inside `[quietHoursStart, quietHoursEnd)`, the delivery is persisted with `status: 'queued_for_digest'` instead of being sent immediately. `'in_app'` and `'sms'` are never deferred.
3. `runNotificationDigestSweep()` (cron-triggered) queries every `'queued_for_digest'` row **without an `organizationId` filter** — a deliberate, singular, documented exception to this codebase's otherwise-universal "every query is organization-scoped" rule, justified because this is the one genuinely system-level job in the codebase. Groups by `(organizationId, identityId)`, re-checks real eligibility per group via `domain/notifications/digestTiming.ts#isDigestGroupEligible` before sending anything. A group not yet eligible is left queued, untouched, for a later sweep.
4. Eligible groups: one digest email is composed and sent, every included delivery row is patched to `'sent'`, `lastDigestSentAt` is updated.
5. **`'sms'` is deliberately never subject to digest/quiet-hours** — a staff member who opts into SMS has asked for immediacy; deferring it would silently defeat the reason they enabled it.

`domain/notifications/digestTiming.ts` is pure, `now`-parameterized logic (no `Date.now()` anywhere) — `orgLocalTime` resolves org-local `"HH:mm"` via `Intl.DateTimeFormat` with `hourCycle: 'h23'` (mirrors `utils/scheduling.ts`'s Phase 27 precedent, avoiding the API's known midnight-format quirk), `isWithinQuietHours` handles the overnight-wrap case, `hasDigestIntervalElapsed` treats a never-sent identity (`lastDigestSentAt === null`) as immediately eligible.

**Structural containment.** The pre-existing structural-boundary tests ("only `notificationService.ts` writes to the 5 notification collections", "only `notificationService.ts` imports the email/sms/in-app channel") meant `listAllQueuedForDigestDeliveries`/`flushDigestGroup` had to live *inside* `notificationService.ts` itself, with `notificationDigestService.ts` as a thin orchestrator calling only those two exported functions plus `getPreferences` — a deliberate divergence from the plan's literal wording ("one new file does everything") in favor of respecting already-tested invariants. A new structural test (`services/notificationService.test.ts`) asserts `listAllQueuedForDigestDeliveries` is never called from anywhere but `notificationDigestService.ts`, containing the one cross-tenant-scan exception to a single, reviewed call site.

## SMS channel

`services/notifications/smsChannel.ts` mirrors `emailChannel.ts`'s exact shape: `SmsProvider` interface, `consoleSmsProvider`, `productionUnconfiguredSmsProvider`, `twilioSmsProvider` (reads `TWILIO_ACCOUNT_SID`/`TWILIO_AUTH_TOKEN`/`TWILIO_FROM_NUMBER`), `getSmsProvider()`. SMS is staff-only — `Identity` gained a nullable `phone` field; `PortalUser` was deliberately not touched (no SMS-consent capture flow exists — a real, separate feature, not just a schema field). In `dispatchChannel`'s `'sms'` branch, a recipient with `smsEnabled` but no `phone` on file fails silently for that one channel (logged via the same `recordNotificationFailed` pattern every other channel failure already uses) — mirrors `recipientResolver.ts`'s established "unresolvable target → drop, never throw" philosophy; one recipient's missing phone number never blocks delivery to every other recipient in the loop.

## Account Settings: phone number field

No prior phase built a current-identity-profile editing surface, despite an earlier ADR's plan text assuming one existed — that assumption was wrong, confirmed via grep, and corrected here rather than silently worked around. Built from scratch: `GET/PATCH /api/auth/profile` (caller's own `Identity` only, `isPlausiblePhone()` validation), `lib/identityProfileClient.ts`, `hooks/useIdentityProfile.ts`, and a new "Profile" section on `SecuritySettingsPanel.tsx`. Gated to functioning only under `AUTH_ADAPTER=identity` — `Identity` is a Phase 21-only concept; mock/wix session `userId` never resolves to a real `Identity.id`, so the route correctly 404s under those modes.

## Schema changes

1. `identities` — `+ phone: string | null`.
2. `notificationDeliveries` — `NotificationChannel` gains `'sms'`, `DeliveryStatus` gains `'queued_for_digest'`. Both are plain Text-backed fields at the Wix level (confirmed live, same as the Phase 23 precedent for `activityEvents.action`) — no schema change needed for either new value.
3. `notificationPreferences` — `+ lastDigestSentAt: string | null`, `+ categoryOverrides` (JSON-serialized Text, mirroring `ReportPreset.filters`'s Phase 32 precedent) — both added live via `POST /wix-data/v2/collections/create-field` (see "Live Wix verification" below for the corrected mechanism).
4. No new collections. No new indexes.

## RBAC

**No new permission keys.** Every field this phase activates is a personal preference (`PATCH /api/notifications/preferences`), gated by nothing beyond authentication — the existing, correct posture. `notification.admin` (Phase 28) remains reserved, unused — this phase does not build the org-level policy screen it was reserved for. Catalog stays at **54** (unchanged from Phase 32).

## New/changed files

- `lib/email/resendClient.ts` (new), `lib/identity/messageSender.ts` (`+ resendIdentityMessageSender`), `services/notifications/emailChannel.ts` (`+ resendEmailProvider`), `services/notifications/smsChannel.ts` (new).
- `services/notificationService.ts` — `dispatchChannel`'s `'sms'` branch and digest/quiet-hours deferral, category-override-aware channel selection, `listAllQueuedForDigestDeliveries`/`flushDigestGroup`.
- `services/notificationDigestService.ts` (new), `app/api/cron/notification-digest/route.ts` (new), `vercel.json` (new).
- `domain/notifications/digestTiming.ts` (new).
- `services/organizationsService.ts` — `+ getForOrganization(organizationId, dataAdapterMode)`, a server-safe read mirroring `casesService.ts#listForOrganization`'s Phase 32 precedent — a second instance of the same "client-only `fetch` wrapper, unusable server-side" gap, found and fixed the same way.
- `components/settings/NotificationPreferencesPanel.tsx` — SMS toggle, digest-frequency select, quiet-hours inputs, per-category override table.
- `app/api/auth/profile/route.ts`, `lib/identityProfileClient.ts`, `hooks/useIdentityProfile.ts`, `components/settings/SecuritySettingsPanel.tsx` (new "Profile" section).
- `.env.example` — `RESEND_API_KEY`, `RESEND_FROM_ADDRESS`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`, `CRON_SECRET`.

## Testing

Every new provider adapter (`resendClient.test.ts`, `smsChannel.test.ts`, and the `messageSender`/`emailChannel` extensions) stubs `fetch` (`vi.stubGlobal('fetch', ...)`) — no real third-party HTTP call is ever made in this codebase's test suite, mirroring `cloverProvider.test.ts`'s exact precedent. `notificationService.test.ts` covers the new `'sms'` branch (success, missing-phone silent-skip), digest deferral, and quiet-hours deferral, all with a fixed, injected `now` — never a real clock. `notificationDigestService.test.ts` covers grouping across organizations and interval-elapsed/not-yet-elapsed eligibility. `app/api/cron/notification-digest/route.test.ts` covers the auth gate. `app/api/auth/profile/route.test.ts` and `components/settings/SecuritySettingsPanel.test.tsx` (new — no prior test file existed for this component) cover the profile surface.

**Two real bugs found and fixed during this phase, both invisible to mock-mode unit tests:**

- `dispatchChannel` originally computed a fresh `nowIso()` internally instead of using the notification's actual creation time — a real quiet-hours-timing bug, caught by a test that injected a specific `now` into `createNotification` and found `dispatchChannel`'s own internal clock disagreed. Fixed by threading `now: string` through as an explicit parameter.
- **`lib/wixNotificationDeliveryMapper.ts`'s `VALID_CHANNELS`/`VALID_STATUSES` allowlists were never updated for the widened `NotificationChannel`/`DeliveryStatus` unions** — `mapWixNotificationDeliveryItem` silently returned `null` for any real `'sms'`-channel or `'queued_for_digest'`-status row read back from Wix, which `listAllQueuedForDigestDeliveries` then filtered out entirely. This is invisible to every mock-mode test (`notificationDeliveryFixtures` never round-trips through this mapper — mock mode returns the fixtures array directly), and was only discovered live: Pass 2 of live verification (below) found the digest sweep reporting `groupsConsidered: 0` against a row it had itself just confirmed existed with the correct status via a direct id-scoped query. Fixed by widening both arrays; `lib/wixNotificationDeliveryMapper.test.ts` gained explicit round-trip tests for `'sms'`/`'queued_for_digest'`, plus a structural test (`notificationService.test.ts`) containing the org-agnostic digest query to its one intended call site.

## Live Wix verification

Two passes against the real Manor's Cremation tenant (`organizationId: "managed-cremations"`), mirroring every prior phase's disposable-lifecycle discipline.

**Pass 1 (read-only).** Confirmed `identities.phone`, `notificationDeliveries.channel`/`.status`, and `notificationPreferences.lastDigestSentAt`/`.categoryOverrides` all resolve correctly against real, already-live-extended collections (every pre-existing row correctly reads the new fields as `undefined`/absent, not an error — matching this codebase's established "missing field is a valid, expected state for pre-existing rows" pattern).

**Schema extension mechanism, corrected live.** The `PUT /wix-data/v2/collections/{id}` "resend the full field list" mechanism documented by every prior phase (`organizations`, `caseDocuments`, `paymentRecords`) returned a bare, infra-level 404 for both `identities` and `notificationPreferences` — this endpoint does not accept `PUT`. A `PATCH` to the same URL routed correctly but rejected a `fields` field-mask path (`WDE0075: Unsupported field mask path(s): fields`) — `PatchDataCollection` only supports `displayName`/`displayField`/`permissions`. The correct, dedicated endpoint (confirmed against Wix's own current REST reference) is `POST https://www.wixapis.com/wix-data/v2/collections/create-field` with `{dataCollectionId, field: {key, displayName, type, required, description}}`, adding one field per call rather than resending the full array. All three new fields (`identities.phone`, `notificationPreferences.lastDigestSentAt`, `notificationPreferences.categoryOverrides`) were added this way and confirmed present in a follow-up `GET`. This corrects, not merely extends, every prior phase's documented mechanism — the field-list-resend approach may have worked at the time it was written, or may never have been verified against this exact endpoint; either way, `create-field` is now the confirmed-correct primitive for future phases extending an existing collection's fields.

**Pass 2 (disposable write, on explicit user approval).** Set the real administrator identity's (`angelica@manorscremations.com`) `notificationPreferences.digestFrequency` to `'daily'` (no prior row existed for this identity — confirmed via a raw query before mutating, with an abort-if-a-real-row-already-exists guard as a safety check that was never actually needed here), then called `createNotification` for a disposable `system.announcement` targeted at that identity. The in-app delivery sent immediately as expected; the email delivery correctly deferred to `status: 'queued_for_digest'` — confirming the digest-deferral branch live, not just in unit tests. This is where the mapper bug above was caught: the org-agnostic sweep query initially returned zero groups despite the row visibly existing. After the mapper fix, re-running end to end: `runNotificationDigestSweep` found 1 group, flushed 1 delivery, sent one digest email via the dev-console adapter (no `RESEND_API_KEY` set in this environment — confirmed correctly falling back rather than attempting a real send), flipped the delivery's status to `'sent'`, and advanced `lastDigestSentAt`. The cron route itself was verified directly (not through an actual Vercel Cron trigger, which cannot be exercised from this environment): rejected both a missing and an incorrect `Authorization` header with `401`, accepted the correct `CRON_SECRET` bearer token and invoked the sweep successfully. Every disposable row (1 Notification, 1 NotificationRecipient, 2 NotificationDeliveries, 1 NotificationPreference) was deleted afterward; a final residual-check query confirmed zero leftover rows across `notifications`/`notificationRecipients`/`notificationDeliveries`, and `identities`/`notificationPreferences` counts matched their pre-verification baseline exactly (4 and 1 rows respectively).

**Explicitly not exercised: real Resend/Twilio API calls.** No provider credentials exist in this environment, and — matching Clover's own precedent exactly — this phase does not fabricate test credentials or send a real email/SMS as part of automated verification. The adapters are complete and correct per their unit tests; activating them in production is a matter of setting the env vars, no code change, identical to Clover's own "flip `isEnabled`, no code change" story.

## Deferred

- **Push notifications** — Beacon has no PWA/service-worker infrastructure anywhere; a materially different feature, not a channel swap.
- **Webhooks** — organization-configurable outbound webhook endpoints is a distinct "integrations" feature, not a notification channel.
- **`SchedulingNotifier` concrete implementation / `INVOICE_OVERDUE` real trigger** — both now technically unblocked by this phase's cron primitive, but neither is built here; each has its own trigger semantics to design, not the same shape as "flush a digest queue."
- **Real SMS delivery to family (`portal_user`) recipients** — `PortalUser` has no phone field and no SMS-consent capture flow exists. (Real email to family is a side effect of this phase, not new work: `dispatchChannel`'s existing `portal_user` fallback already resolved email and called the same `sendEmailNotification`, so family members already receive real email now that `EmailProvider`'s real adapter exists.)
- **Per-organization notification policy defaults** — `notification.admin` stays reserved for whenever an org-wide default/override screen is designed.
- **`smsDigestFrequency`** — SMS is deliberately never digest-batched this phase; a future per-channel digest frequency is a named possible refinement, not built speculatively.
