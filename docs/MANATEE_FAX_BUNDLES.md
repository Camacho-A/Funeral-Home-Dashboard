# Manatee County DC application fax bundles (2026-11)

**Select 1 or more cases → Preview one bundle → Send one fax.**

Staff choose exactly which saved Manatee County Death Certificate
Applications go in a bundle (1–20, in the order they choose). SOLIS builds
ONE PDF, numbers each application "n of N" in the form's own
"Request ___ of ___" boxes, stores that exact PDF, shows it, and — on Send
Fax — emails it as ONE attachment from the connected Outlook mailbox to
NuSo's email-to-fax gateway: one bundle = one email = one fax.

Status: built and tested on `feat/manatee-fax-bundle`. **Not live**: the
Wix collections do not exist yet and `sendingEnabled` is `false`.

## Where things are

| Piece | Code |
|---|---|
| Settings (destination, gateway, limit, on/off) | `domain/organization/organizationProfiles.ts` → `features.deathCertificateFax` (Manors only); `domain/faxBundles/faxSettings.ts` |
| Statuses, reference, target day | `domain/faxBundles/faxBundle.ts` |
| Checklist items | `domain/faxBundles/faxChecklist.ts` |
| Bundle PDF + numbering | `services/faxBundles/faxBundlePdf.ts` |
| Storage (Wix / in-memory) | `services/faxBundles/faxBundleStore.ts` |
| Preview, send, outcome, history | `services/faxBundles/faxBundleService.ts` |
| Routes | `app/api/fax-bundles/**`, `app/api/cases/[caseId]/fax-bundles` |
| UI | Cases page → **Fax DC Applications**; case Documents tab → **DC Application Fax** |

## Behaviour

- **Email:** To `9415545490@fax.nuso.io`; Subject `Manors Cremation - DC
  Application Bundle DC-XXXXXX` (random, non-sensitive reference for
  matching NuSo confirmations); Body `Please process the attached document.`;
  one attachment `DC-XXXXXX.pdf`. No decedent information in the email.
- **Numbering:** a saved application is flattened; each field is its own
  drawing at the field's rectangle. The two Request drawings are identified
  by exact position and size (a blank box is an empty, zero-size drawing). In
  the bundle copy only, any text in them is removed and "n" / "N" written in
  them. Anything ambiguous refuses the case. The saved original is never
  modified. Verified on the real signed form (outside the repository): zero
  pixels differ outside the two boxes, including for applications that had
  numbers typed. New saves leave the boxes blank; the dialog no longer has
  Request inputs.
- **Multi-page applications** (none today): later pages carry "Request n of N
  · page k of m" in the bottom margin.
- **Permissions** (2026-11, approved matrix): `fax.send` — prepare, preview,
  send (Administrator, Manager, Funeral Director, Office Staff, Arranger) plus
  `document.view`; `fax.confirm` — record delivered / failed (the same roles
  except Arranger). Checked on the server on every route from the member's
  role in that organization (roles, grants, organization overrides) — never
  from the request; `recordFaxBundleOutcome` checks `fax.confirm` again
  itself. The UI only shows what the member holds. `crematory.send` is
  unchanged. Live roles need the grants added — see "Permission rollout".
- **Checklist:** saving a valid application completes "DC application filled
  out"; a CONFIRMED delivery completes "Sent day before ashes arrive".
  Submission never does. Both only on cases whose workflow has those exact
  items, never over a staff tick. The delivery date and the target day (day
  before the Expected Pickup) are recorded in the activity, never implied.
- **Duplicate protection:** ready → sending once (revision-conditioned); per-
  case claim rows with fixed ids (Wix refuses a second insert); the attempt
  is recorded before Outlook is contacted; an Outlook error that cannot have
  sent returns the bundle to ready (cases released); anything that may have
  sent → needs review (cases held, never retried). An attempt that reached
  Outlook but whose result could not be saved reads as needs review after 5
  minutes. A send abandoned before Outlook releases after 5 minutes.
- **Retention:** submitted/delivered/failed/needs-review bundles keep their
  PDF and full history. Only unsent previews older than 24 hours are
  discarded (their PDF deleted), lazily, on the next preview or send.
- **Size:** the bundle must be ≤ `maxAttachmentBytes` (10 MB until NuSo's
  limit is confirmed) and never above 25 MB (Exchange's 35 MB message limit
  after encoding). A real application is ~220 KB, so 20 ≈ 4.4 MB.

## Wix schema (approved in principle 2026-11-04; NOT created)

Both collections: permissions read/insert/update/remove = **Admin** (API key
only). All fields optional at the Wix level (the app validates).

### `faxBundles`

| Field | Type |
|---|---|
| `beaconFaxBundleId` (= `_id`, `fxb-` + 32 hex) | TEXT |
| `organizationId`, `reference`, `purpose`, `status` | TEXT |
| `revision`, `applicationCount`, `pdfSizeBytes`, `pdfPageCount` | NUMBER |
| `items` | ARRAY (objects: position, caseId, caseNumber, documentId, documentVersion, documentChecksumSha256, pageCount, numbering) |
| `caseIds` | ARRAY (text) |
| `pdfStorageKey`, `pdfChecksumSha256` | TEXT |
| `destinationName`, `destinationFaxNumber`, `destinationAddress`, `gatewayDomain`, `subject`, `senderAddress` | TEXT |
| `createdBy`, `createdAt`, `updatedAt`, `submissionId`, `sentBy`, `outlookContactedAt`, `submittedAt` | TEXT |
| `outlookDraftId`, `internetMessageId`, `failureCode`, `failureMessage` | TEXT |
| `confirmedBy`, `confirmedAt`, `deliveredAt`, `nusoReference`, `confirmationDocumentId` | TEXT |
| `history` | ARRAY (objects: at, actorId, action, fromStatus, toStatus, note, details) |

Indexes: (`organizationId`, `createdAt`), (`organizationId`, `status`),
(`organizationId`, `reference`).

### `faxBundleCases`

| Field | Type |
|---|---|
| `beaconFaxBundleCaseId` (= `_id`; `fxl-`/`fxc-` + 40 hex) | TEXT |
| `organizationId`, `kind` (`link`/`claim`), `bundleId`, `caseId`, `documentId`, `createdAt` | TEXT |
| `position`, `applicationCount`, `documentVersion` | NUMBER |

Indexes: (`organizationId`, `caseId`), (`organizationId`, `bundleId`).

## Permission rollout (live data — needs approval)

Live role grants are rows in Wix written when an organization was set up;
new code keys reach nobody until granted. The rollout adds **9
organization-level grant overrides for Manors only**
(`organizationRolePermissionOverrides`, the rows Settings > Roles writes,
with its lock and audit) — never the shared default-role rows Gus also
reads:

| Role | `fax.send` | `fax.confirm` |
|---|---|---|
| administrator | grant | grant |
| manager | grant | grant |
| funeralDirector | grant | grant |
| officeStaff | grant | grant |
| arranger | grant | — |

Override ids are deterministic
(`roleoverride-managed-cremations-{role}-{key}`); a pair Manors has
explicitly revoked is left alone and reported. No new collection or field.

Run: `GET /api/organization/rbac/fax-permissions?organizationId=managed-cremations`
(read-only plan, Administrator) → `POST` the same (applies; idempotent).
Validation: the GET afterwards shows every pair `already_granted`; one
member per role checks the Cases page button and the Documents tab
"Record delivery result". Rollback: remove the 9 overrides in Settings >
Roles (or `removeOverrideById`).

Side effect: the platform RBAC health report compares the shared rows with
the code definitions and will list `fax.send`/`fax.confirm` as missing
default grants. That is informational; its "apply" refuses to run on any
deployment limited to specific organizations (Manors Production is), so the
shared rows cannot be changed from there.

## Wix collections — migration checklist (needs approval)

1. Create `faxBundles` and `faxBundleCases` with exactly the fields above,
   all optional at the Wix level; permissions read/insert/update/remove =
   Admin; the indexes above. Creating new collections changes no existing
   collection, index or row, so SOLIS keeps working while it happens; until
   they exist the fax routes fail closed (no data, nothing sent).
2. Read back (read-only): fields, types, permissions, indexes.
3. Disposable live check (fictional rows, throwaway organization id
   `zz-fax-verification`, deleted afterwards), proving on THESE collections
   what the code relies on:
   - a second insert with the same id → 409 (claim guard);
   - a conditional patch whose `revision`/`status` condition is stale →
     428 and nothing changed; two simultaneous ones → exactly one applied;
   - a `$in` status query returns the right rows;
   - array/object fields (`items`, `history`) round-trip unchanged;
   - ids ≤ 128 characters.
   (The same Wix mechanisms are already live-verified and relied on
   elsewhere: conditional patch — `lib/wixDataApi.ts`, case revisions;
   duplicate-id 409 — payments.)
4. Rollback: delete the two collections (only while they hold no real
   bundles); nothing else references them.

## Vercel preview security (before ANY push — needs approval)

Pushing any branch builds a Preview in all three projects. The Manors
project's Previews carry the Production values of every live credential
except JotForm, SSN and templates — Wix API key and site, Resend, Twilio,
Clover sandbox, Microsoft/Google secrets, R2, the database URL, the session
secret, the MFA/calendar encryption keys, `DATA_ADAPTER=wix` — and both
Blob stores (case documents, branding) are connected to Preview too. The
code has no preview check. So a Preview can read and write live Wix cases
and documents, decrypt the stored Outlook token and send email, send SMS,
and accept a Production session token. Mitigation today: Previews require
Vercel team sign-in. Crons run only on Production deployments.

Recommended (each a Vercel change needing approval), in order:
1. Manors project → Ignored Build Step
   `[ "$VERCEL_ENV" = "production" ] && exit 1 || exit 0` — no Previews
   are built in the Manors project at all. Production unaffected; existing
   Preview deployments keep running until deleted.
2. Remove the Preview target from every live credential in the Manors
   project; set Preview `DATA_ADAPTER=mock`, `AUTH_ADAPTER=mock`; delete
   existing Manors Preview deployments. Production unaffected.
3. Previews happen only in `manors-solis-sandbox` (mock data, no live
   credentials, team sign-in). No new credentials are needed for that; a
   separate non-production Wix site/mailbox would be needed only if a
   Preview must exercise real integrations.
4. Safe push: after 1–2, `git push origin feat/manatee-fax-bundle`, then
   confirm in Vercel that the Manors project shows the build as skipped
   ("Ignored Build Step") and only the sandbox built.
5. Rollback: clear the Ignored Build Step / re-add Preview targets
   (restores today's behaviour exactly).

Alternative without touching Vercel: add the same command as
`"ignoreCommand"` to this branch's `vercel.json`. It takes effect for every
deployment built from a branch containing it — so after a merge, Previews
stop in all three projects. Not done; needs approval.

## Live setup — each step needs separate approval

1. **Create the two collections** exactly as above; read back fields,
   permissions and indexes (read-only script).
2. **Disposable live check** (fictional rows under a throwaway organization
   id, then deleted): a duplicate claim insert is refused (409); a stale
   conditional patch is refused (428) and changes nothing; array/object
   fields round-trip; ids ≤ 128 characters.
3. **Deploy with `sendingEnabled: false`** — staff can preview bundles.
4. **Activation checks:**
   - the connected mailbox (Settings → Crematory) is an authorized outbound
     sender in NuSo — its missing authorization caused earlier failed tests;
   - NuSo account: email-to-fax enabled; Secure IPFax / TLS requirements;
     attachment size limit (set `maxAttachmentBytes`); whether the subject
     or body becomes a cover page;
   - one controlled test: a fictional application, to a fax number we own
     (temporarily the destination, via a reviewed code change), delivered
     and confirmed.
5. **Turn on** `sendingEnabled: true` for Manors (reviewed deploy).

Rollback: set `sendingEnabled: false` (deploy). The collections affect no
other feature.

## Known issue elsewhere (separate fix, not part of this feature)

Send to Crematory treats a dropped connection during Outlook's final send
call as "not sent" (`crematorySendService.ts` checks only
`OutlookMailError.mayHaveSent`; a network `TypeError` is not one), so a
send that went out could be offered again. The fax feature treats any such
failure as Needs Review. Left unchanged here, as instructed.

## Not built (future)

- Automatic matching of NuSo's confirmation emails (the reference in the
  subject makes it possible once a real confirmation has been seen).
- An Administrator-authorized, audited resend of a delivered application
  (the claim rows support it: an audited admin action would remove the
  claim).
- A settings screen for the destination (it is code configuration now, so
  only a reviewed deploy can change it).
