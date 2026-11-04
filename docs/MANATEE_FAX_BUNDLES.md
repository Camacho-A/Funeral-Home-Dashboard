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
- **Permissions:** preview/send — `crematory.send` ("Send Crematory
  Packages"; by default Administrator, Manager, Funeral Director, Office
  Staff) plus `document.view`; record delivered/failed — Administrator or
  Manager role only.
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

## Not built (future)

- Automatic matching of NuSo's confirmation emails (the reference in the
  subject makes it possible once a real confirmation has been seen).
- An Administrator-authorized, audited resend of a delivered application
  (the claim rows support it: an audited admin action would remove the
  claim).
- A settings screen for the destination (it is code configuration now, so
  only a reviewed deploy can change it).
