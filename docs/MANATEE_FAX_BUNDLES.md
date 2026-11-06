# Manatee County DC application fax bundles (2026-11)

**Select 1 or more cases → Preview one bundle → Send one fax.**

The dialog (redesigned 2026-11) shows this as three labelled steps:
**1 Select cases** (destination — the default preselected, any other active
destination of the organization selectable — case list with counts, the
bundle order),
**2 Review fax** (the stored PDF fills the dialog; document, application and
page counts beside it; nothing can be sent from this step), and
**3 Confirm & send** (destination name and number, the file, its counts and
applications, a note that Send Fax is not confirmed delivery, and a
confirmation box that must be ticked before Send Fax is enabled). Going
back to step 1 without changing the selection or destination reuses the
prepared bundle (changing either prepares a new one);
a send that may have gone out is never offered again from the dialog. The
requests, checks and audit trail behind it are unchanged.

Staff choose exactly which saved Manatee County Death Certificate
Applications go in a bundle (1–20, in the order they choose). SOLIS builds
ONE PDF, numbers each application "n of N" in the form's own
"Request ___ of ___" boxes, stores that exact PDF, shows it, and — on Send
Fax — emails it as ONE attachment from the connected Outlook mailbox to
NuSo's email-to-fax gateway: one bundle = one email = one fax.

Status (2026-11-04): built and tested on `feat/manatee-fax-bundle`, which
is pushed but **not merged or deployed** — Production still runs code
without this feature. The live Wix collections and the Manors fax
permissions are in place (see "Live record" below). **Fax sending is
disabled** (`sendingEnabled: false`); nothing can be faxed until a reviewed
deploy turns it on.

## Live record (2026-11-04)

Done with approval, step by step; nothing else in live Wix was changed
(record ids and update times of `cases`, `caseDocuments`, `organizations`,
`roles`, `rolePermissions`, `organizationRoles` and
`organizationMemberships` compared before and after: identical).

- **Collections created** in the live Wix site: `faxBundles` (36 fields)
  and `faxBundleCases` (10 fields), NATIVE, permissions Admin ×4, every
  field optional, with the five indexes in §Wix schema. Read back: fields,
  types, permissions and indexes exactly as specified; all five indexes
  ACTIVE. `caseIds` is Wix type `ARRAY_STRING`. Both collections are empty.
- **Concurrency verified live** on those collections (throwaway
  organization `zz-fax-verification`, fictional rows, all deleted after):
  a second insert of the same claim id is refused (409, `WDE0074`); 10
  truly concurrent claim races — exactly one winner each time; a stale
  revision, status or organization condition is refused (428, `WDE0193`)
  and changes nothing; 8 concurrent conditional updates — exactly one
  applied each time; `$in` status queries and organization filtering
  correct; `items` / `history` round-trip intact (Wix may reorder object
  keys; values are unchanged); ids ≤ 128 characters. The branch's own store
  functions (`claimCaseForFaxBundle`, `releaseFaxCaseClaim`,
  `updateFaxBundleIf`, `getFaxBundle`, …) passed the same races live.
- **Permissions applied** — the 9 Manors-only grant overrides below
  (actor `system-fax-permission-rollout-2026-11-04`, with their 9 audit
  entries). Effective permissions verified for all eight roles: each role
  gained exactly its approved fax keys and lost nothing; `crematory.send`
  unchanged; re-running the grant changes nothing. Shared default-role
  rows were not touched.
- **Vercel Preview isolation** (§Vercel preview security) completed; the
  branch push was cancelled on the Manors project as intended.

## Where things are

| Piece | Code |
|---|---|
| Settings (destination, gateway, limit, on/off) | `domain/organization/organizationProfiles.ts` → `features.deathCertificateFax` (Manors only); `domain/faxBundles/faxSettings.ts` |
| Fax Settings (destinations, provider, subject/message, cover page — administrators; branch `feat/fax-settings`) | `docs/FAX_SETTINGS.md` |
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
  matching NuSo confirmations); **body empty** (plain text, no message, no
  signature); one attachment `DC-XXXXXX.pdf`. No decedent information in the
  email. One PDF page = one fax page is the goal: a controlled Outlook test
  (message + signature + a one-page PDF) produced a three-page fax, so any
  body text is treated as becoming extra pages.
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

## Wix schema (created and verified live 2026-11-04)

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

## Permission rollout (applied to Manors 2026-11-04)

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

## Wix collections — migration checklist (done 2026-11-04)

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

## Vercel preview security (done 2026-11-04)

Verified read-only on 2026-11-04: all three projects expose system
environment variables (`autoExposeSystemEnvs: true`), have no custom
environments and no Ignored Build Step; the Manors project has exactly 3
Preview deployments (2 × `feat/price-catalog`, 1 × `fix/nok-email-wrap`),
all READY; both Blob stores (`manors-case-documents`, `manors-branding`)
are connected to the Manors project for Preview AND Production.

Risk: every Preview of the Manors project gets Production's credentials
(Wix, Resend, Twilio, Clover sandbox, Microsoft/Google secrets, R2,
database, session secret, `CALENDAR_TOKEN_ENCRYPTION_KEY` — which decrypts
the stored Outlook mailbox token) and both Blob stores, and the code has no
preview check. Mitigation today: Previews need Vercel team sign-in.
Environment variables are fixed into a deployment when it is created, so
changing them does NOT take access away from an existing Preview — only
deleting it does.

Ignored Build Step command (Manors project only), tested in sh and bash:

    if [ "$VERCEL_ENV" = "production" ] || { [ -z "$VERCEL_ENV" ] && [ "$VERCEL_GIT_COMMIT_REF" = "master" ]; }; then exit 1; else exit 0; fi

Exit 1 builds, exit 0 cancels (Vercel). Production (master) → build;
any Preview → cancelled; if `VERCEL_ENV` were ever missing, master still
builds, so Production can never be blocked by it. Instant Rollback /
promote do not build, so they are unaffected.

Done 2026-11-04: steps 1–3 and 5 below. Manors Preview now has only
`APP_BASE_URL`, `RESEND_FROM_ADDRESS` and `DEPLOYMENT_ORGANIZATION_IDS`;
both Blob stores are Production-only; the first branch push built CANCELED
on the Manors project. Step 4 (rotation) was not done.

Procedure (each step needs approval; only the Manors project is touched —
`gus-solis-sandbox`, `manors-solis-sandbox` and the legacy Gus project are
not):
1. Set the Ignored Build Step above. Production keeps serving; the next
   master merge still builds.
2. Delete the 3 existing Manors Preview deployments (the only way to take
   their access away). Production deployments are not touched.
3. Remove the Preview target from every live credential (keep Production),
   set Preview `DATA_ADAPTER=mock` and `AUTH_ADAPTER=mock`, and disconnect
   Preview from both Blob stores. Production values and the running
   Production deployment are unchanged (a deployment keeps the values it
   was built with).
4. Optional hardening: rotate the live secrets if anyone outside the team
   ever had Preview access (signs everyone out if the session secret
   rotates).
5. Safe push: `git push origin feat/manatee-fax-bundle`; confirm the
   Manors project shows that build CANCELED and only the two mock
   sandboxes built.
6. Rollback: clear the Ignored Build Step; re-add Preview targets / Blob
   connections. Restores today's behaviour exactly.

## Live setup — each step needs separate approval

1. ~~**Create the two collections**~~ — done 2026-11-04 (Live record).
2. ~~**Disposable live check**~~ — done 2026-11-04, all passed.
   ~~**Fax permissions**~~ — 9 Manors grants applied 2026-11-04.
3. **Deploy with `sendingEnabled: false`** — staff can preview bundles.
   Not done yet; needs approval.
4. **Activation checks:**
   - the connected mailbox (Settings → Crematory) is an authorized outbound
     sender in NuSo — its missing authorization caused earlier failed tests;
   - NuSo account: email-to-fax enabled; Secure IPFax / TLS requirements;
     attachment size limit (set `maxAttachmentBytes`); the account's cover
     page setting (off), and that an empty body and the subject add no
     page; that an empty body is accepted;
   - Exchange admin: no mail-flow rule or signature service appends a
     disclaimer/signature to the mailbox's outgoing mail (it would become
     a fax page);
   - controlled tests WITHOUT turning sending on: Settings → Fax Settings →
     Test Transmissions (docs/FAX_TEST_TRANSMISSIONS.md) — an email dry run,
     then a fictional one-page fax to a number we own (exactly 1 page), then
     a two-page one (exactly 2 pages).
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
