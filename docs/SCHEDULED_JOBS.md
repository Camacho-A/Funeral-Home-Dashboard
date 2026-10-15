# Scheduled Jobs (cron sweeps)

Status: 2026-10, Manors multi-tenant compatibility update (ported from the Gus
Camacho Jr. hardening, Gus commit `1c004c9`). Scope: every background or
scheduled processor in this repo. Manors org `managed-cremations`, Gus org
`gus-camacho-jr`. Both deployments share one Wix "Beacon" backend.

## TL;DR

- There are four cron sweeps. All four are HTTP Route Handlers under
  `app/api/cron/*`. There is no other background or queue processor: no
  `setInterval` workers, no `waitUntil`/`after` jobs, and no queue consumers.
  The only `setInterval` is the inventory lock lease renewal, which runs
  inside a request. Webhooks (`app/api/webhooks/{clover,jotform}`) are
  request-driven and covered separately.
- Every sweep now processes only the organizations named in
  `DEPLOYMENT_ORGANIZATION_IDS` (Manors: `managed-cremations`). The filter
  goes into the Wix query, and each record is re-checked with
  `isOrganizationAllowedInDeployment` before anything is sent.
- Every sweep is now claim-before-send (idempotent), so overlapping runs do
  not double-send.
- **Production scheduling is deliberately unchanged.** The routes stay
  **POST-only**, exactly as before this port. `vercel.json` still schedules
  `/api/cron/bill-reminders` daily at 08:00 UTC, but Vercel Cron sends GET,
  which these routes do not export, so that run keeps getting 405 and **no
  sweep runs on a schedule** — the same as before. Enabling GET (i.e.
  actually starting scheduled jobs) is a separate, reviewed rollout; see
  [Enabling scheduled runs later](#enabling-scheduled-runs-later).

## Route gate (all four routes)

`app/api/cron/_lib/cronRoute.ts` (`cronHandler`), exported as `POST` only:

| Condition | Response |
|---|---|
| GET (e.g. Vercel Cron) | 405 (Next.js default for an unexported method). Unchanged from before the port. |
| `CRON_SECRET` unset | 503. The sweep never runs. |
| `Authorization` missing, or not exactly `Bearer $CRON_SECRET` | 401. The comparison is constant-time: both sides are SHA-256 hashed and compared with `timingSafeEqual`. |
| `DEPLOYMENT_ORGANIZATION_IDS` unresolvable (unset in production on Wix, or invalid) | 503. The sweep never falls back to "all tenants". |
| Otherwise | 200 `{ result }` |

Behaviour change for a **manual POST** only: before the port it swept every
organization with no dedupe; now it sweeps only `managed-cremations` (once
the env var is set) with claim-before-send.

## Shared mechanisms (`services/scheduledJobs/sweepSupport.ts`)

- **`deploymentOrganizationWixFilter()`** returns:
  - `{ organizationId: 'managed-cremations' }` for a single-org deployment
  - `{ organizationId: { $in: [...] } }` for a multi-org deployment. `$in` is
    already used live by `lib/casePagination.ts`.
  - `{}` when unrestricted. "Unrestricted" (`null`) only happens outside
    production or on mock data. `lib/env.ts` throws in production on Wix.
- **`retainDeploymentRecords()`** plus a per-record
  `isOrganizationAllowedInDeployment` check right before acting. This is
  defense in depth: it holds even if the query filter is dropped or ignored.
- **`claimWixSweepRow()`** is a compare-and-swap built on
  `conditionalPatchWixDataItem`. That primitive uses Wix PatchDataItem's
  `condition` and was live-verified on 2026-09 for single-winner races.
  - On rejection the row is re-read once:
    - If it changed or is gone, the outcome is **contended** and the row is skipped.
    - If it is unchanged, the outcome is **unverifiable**: the backend did not
      apply the condition at all. The sweep falls back to the pre-2026-10
      behaviour and logs a `console.warn`.
    - If the re-read itself fails, the outcome is **contended** (fail safe).
  - `SWEEP_CLAIM_TTL_MS` is 15 minutes, well above any Vercel function
    duration. A claim older than this is treated as abandoned.

## Per-job audit

### 1. Bill reminders: `/api/cron/bill-reminders` → `services/accountsPayableNotifications.ts#runBillReminderSweep`

- **Reads:** `vendorBills` (open and partially paid), `suppliers` (name
  token) and `notifications` (dedupe check). Recipient resolution reads
  memberships and roles. Notification preferences are read during delivery.
- **Writes:** `notifications`, `notificationRecipients`,
  `notificationDeliveries`, `notificationDeliveryAttempts` and
  `activityEvents`, all via `createNotification`. It sends email through
  Resend and SMS through Twilio, using deployment env.
- **Before:** one unfiltered `vendorBills` query (`limit: 500`) covering
  every org. Status was filtered in app code, rows past 500 were silently
  dropped, and there was no dedupe. Every run re-sent every reminder.
- **After:**
  - Scoped to this deployment's orgs.
  - One query per status (`open`, `partially_paid`), each fully paginated
    with `queryAllWixDataItems`. No status `$in` is needed.
  - Every bill is re-checked before acting.
- **Idempotency:** a deterministic notification id,
  `bill-reminder-<organizationId>-<billId>-<YYYY-MM-DD UTC>`.
  - A later run the same day finds that id with `getNotification` and skips.
  - Two concurrent runs both try to insert the same Wix `_id`.
    `persistNotification` inserts with `_id = notification.id`, and a
    duplicate `_id` insert is rejected, so the loser throws before any
    recipient is resolved or any channel is sent.
  - No schema change and no new collection.
  - The bill gets at most one reminder per UTC day. Moving from "due soon"
    to "overdue" on the same day does not add a second one.
- **Residual:** relies on Wix rejecting a duplicate-`_id` insert. This is
  standard Insert Data Item behaviour, but the concurrent case is not yet
  live-verified, so add it to the next live pass.

### 2. Notification digest: `/api/cron/notification-digest` → `services/notificationDigestService.ts` + `notificationService.ts#{listAllQueuedForDigestDeliveries, flushDigestGroup}`

- **Reads:**
  - `notificationDeliveries` with status `queued_for_digest`
  - `notificationPreferences` and `organizations` (timezone)
  - `notifications`
  - identities and portal users (email address)
- **Writes:**
  - `notificationDeliveries` (status, attempt count, `lastAttemptAt`)
  - `notificationDeliveryAttempts`
  - `notificationPreferences.lastDigestSentAt`
  - `activityEvents`
  - Sends Resend email.
- **Before:** read every org's queued deliveries (already paginated). An
  overlapping run could email the same deliveries twice.
- **After:**
  - The query is scoped by org.
  - The org is re-checked per group in the sweep and again inside
    `flushDigestGroup`, which refuses a disallowed org.
- **Idempotency:** each delivery is claimed before sending, using the
  **existing `lastAttemptAt` field**.
  - A `queued_for_digest` row always has `lastAttemptAt = null` until claimed.
  - The claim is a compare-and-swap on `(status, lastAttemptAt)`.
  - A fresh claim is skipped. A claim older than the TTL is reclaimable, so a
    crashed run never strands a row. That gives at-least-once delivery for
    the crash window only.
  - Only claimed deliveries are included in the email and marked.
  - `lastDigestSentAt` advances only when something was flushed.

### 3. Appointment reminders: `/api/cron/appointment-reminders` → `services/appointmentReminderService.ts#runAppointmentReminderSweep`

- **Reads:**
  - `appointmentReminders` (scheduled and due)
  - `appointments`, `organizations` (timezone)
  - recipient data (staff identity or portal user)
- **Writes:**
  - `appointmentReminders` (status, sentAt, notificationId, failureReason)
  - notifications (as in job 1)
  - `activityEvents`
  - Sends Resend email and Twilio SMS. Action URLs come from `getAppBaseUrl()`.
- **Before:** one 250-row page of every org's `scheduled` reminders,
  including far-future ones, with the due check done in app code. A large
  future backlog could hide reminders that were already due. Overlapping
  runs could double-send.
- **After:**
  - The query is `{ organizationId, status: 'scheduled', scheduledFor: { $lte: now } }`,
    sorted by `scheduledFor` ascending and fully paginated. This uses the
    existing `(status, scheduledFor)` index.
  - The due check is still repeated in app code.
  - The org is re-checked per row.
- **Idempotency:** claim-before-send using the **existing `sentAt` field**.
  - The claim is a compare-and-swap of `sentAt` from null to the run's
    timestamp while status is `scheduled`.
  - A fresh claim is skipped.
  - An **abandoned claim** (older than the TTL) is marked `failed` with an
    explanatory reason and **not** re-sent. This is at-most-once, because a
    duplicate family-facing reminder is worse than a visible failure.
  - Skipped and failed outcomes clear `sentAt`.
  - Reschedule reactivation (`upsertReminderRow`) also clears `sentAt`.

### 4. Calendar sync: `/api/cron/calendar-sync` → `services/calendarSyncService.ts#runCalendarSyncSweep`

- **Reads:** `calendarEventLinks` (`pending` and `retry_pending`),
  `calendarConnections` and `appointments`.
- **Writes:**
  - `calendarEventLinks`
  - `calendarConnections`: token refresh in `getValidAccessToken`, which uses
    the Google/Microsoft OAuth client env and `CALENDAR_TOKEN_ENCRYPTION_KEY`
  - notifications (sync-failed) and `activityEvents`
  - Calls the Google and Microsoft Calendar APIs (create, update, delete).
- **Before:** two 250-row queries across every org. If another deployment
  ran this sweep, it would decrypt and refresh our tokens with its own
  OAuth app and key, and the reverse. Two overlapping runs could both
  `createEvent`, producing a duplicate event in a real staff calendar.
- **After:**
  - Both queries are scoped by org, still bounded to 250 per run because
    each link costs provider calls.
  - The org is re-checked per link before any token or provider call.
- **Idempotency:** claim-before-sync. No existing field fits:
  - `updatedAt` drives the retry backoff and is legitimately bumped by every
    re-mark.
  - So there is **one optional new field, `calendarEventLinks.sweepClaimedAt`**
    (Text, ISO, nullable). It is set by compare-and-swap, a fresh claim is
    skipped, a claim older than the TTL is reclaimable, and the claim is
    released (set to null) on every sweep-side link write.
  - **Graceful fallback:** if the field or condition is not accepted, the
    claim is `unverifiable`. The link then syncs exactly as before, with a
    warning.
  - In mock mode, claims are held in memory and the shared fixture shape is
    unchanged.

### Collection/field dependencies (production)

| Dependency | Needed for | If missing |
|---|---|---|
| `calendarEventLinks.sweepClaimedAt` (Text, nullable). Add it to the Wix collection schema; no index needed, because the claim is `_id`-scoped. | Calendar double-create protection | Falls back to the old behaviour (no claim) and logs `[calendar-sync] conditional claim not applied` |
| Wix rejects a duplicate-`_id` insert on `notifications` | Concurrent bill-reminder dedupe | Sequential runs are still deduped through `getNotification`. Only truly simultaneous runs could duplicate. |
| `conditionalPatchWixDataItem` with multi-field `condition.filter` (`status`/`syncStatus` plus the claim field, using `$eq`) | Every claim | The claim is "unverifiable" and the job falls back to the old behaviour with a warning. Verify live with one disposable row per collection. |

No new collections. `docs/WIX_DATA_SCHEMA.md` should gain the
`sweepClaimedAt` field when it is created live; that doc is not owned by
this task.

## Environment each job uses (why cross-deployment processing is wrong)

All four jobs send under the **running deployment's** env:

- `getAppBaseUrl()` (links in emails)
- `RESEND_*` / `RESEND_FROM_ADDRESS`
- `TWILIO_*`
- Calendar OAuth client ids and secrets
- `CALENDAR_TOKEN_ENCRYPTION_KEY`

If the Manors deployment processed a Gus row, Gus families and staff would
get Manors-branded links and sender addresses. Calendar tokens encrypted with
Gus's key would fail to decrypt, or be refreshed with Manors' OAuth app.
Isolation at the sweep is therefore required for correctness, not just
tidiness.

## Enabling scheduled runs later

Not part of this update. Each job, once enabled, starts sending real
reminders, digests or calendar writes, so it needs its own review. To enable:

1. Deploy this change set with `DEPLOYMENT_ORGANIZATION_IDS=managed-cremations`
   and a `CRON_SECRET`.
2. Verify with one manual POST per job that results only count Manors rows,
   in a window where sending is acceptable.
3. Decide which jobs should run, then add `export const GET = POST;` to
   those routes and the matching `vercel.json` entries:

```json
{
  "crons": [
    { "path": "/api/cron/bill-reminders", "schedule": "0 8 * * *" },
    { "path": "/api/cron/appointment-reminders", "schedule": "*/15 * * * *" },
    { "path": "/api/cron/notification-digest", "schedule": "*/15 * * * *" },
    { "path": "/api/cron/calendar-sync", "schedule": "*/15 * * * *" }
  ]
}
```

- Adding GET to `bill-reminders` alone starts the existing daily schedule
  immediately, for the first time ever — vendor-bill reminders would begin
  going out daily.
- Sub-daily schedules need a Vercel Pro plan.
- Add the optional `calendarEventLinks.sweepClaimedAt` field first
  (recommended).

Manual trigger:

```bash
curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://<host>/api/cron/<job>
```

## Multi-deployment rules (Manors + Gus)

- Before this update, Manors' cron code swept every organization. Any manual
  POST on old code after a Gus row exists would process Gus rows under Manors
  env. Deploying this update with `DEPLOYMENT_ORGANIZATION_IDS=managed-cremations`
  closes that; until then, do not trigger `/api/cron/*` on Manors manually.
- Keep `CRON_SECRET` distinct per deployment.
- Each org's rows must be processed by exactly one deployment: the one whose
  allowlist names it. Do not list the same org in two deployments'
  `DEPLOYMENT_ORGANIZATION_IDS`.

## Tests

- `app/api/cron/cronRoutes.test.ts` covers, for all four routes:
  - no GET export (Vercel Cron keeps getting 405)
  - 503 without `CRON_SECRET`
  - 401 for a missing, wrong or malformed bearer
  - 200 with the correct bearer
  - 503 with no deployment scope in production on Wix (and no fetch)
  - the constant-time comparison
  - `vercel.json` still holds only the existing bill-reminders entry
- `services/scheduledJobs/sweepIsolation.test.ts` (mock data) covers, for
  each sweep:
  - rows are processed only for the allowlisted organization
  - the other tenant's rows are byte-for-byte untouched and get no notifications
  - unrestricted mode is unchanged
  - overlapping and repeated runs never double-send
  - stale and fresh claim handling
- `services/scheduledJobs/sweepWixScope.test.ts` (Wix mode, with an in-memory
  `lib/wixDataApi` stand-in) covers:
  - the exact org-scoped query filters (`$in` for multi-org, none when unrestricted)
  - another tenant's row returned anyway is never claimed or acted on
  - a contended claim stops before any appointment, connection or provider call
  - the bill dedupe and deterministic id
  - `claimWixSweepRow` outcomes
