# Fax test transmissions (2026-11)

Before real DC application bundles may be faxed (`sendingEnabled: true`), a
**fictional** test PDF is sent through exactly the path Send Fax uses, to a
recipient the business controls, to learn what NuSo and Exchange do to it —
a cover page, email text faxed as pages, a signature or disclaimer — without
turning real sending on.

Settings → Fax Settings → **Test Transmissions** (Administrators who may fax:
`organization.manage` **and** `fax.send`).

## Status

- Built 2026-11-05 on `feat/fax-settings-ui`. **Not deployed.**
- **Off:** Manors' allowlist is empty (`testRecipients` in
  `domain/organization/organizationProfiles.ts`). Nothing can be sent until
  approved recipients are added there by a reviewed deploy.
- Needs one new Wix collection (below) before it can record — and therefore
  send — anything.

## Steps (each needs separate approval, and the previous step to pass)

| Step | Sends | To | Passes when |
|---|---|---|---|
| 0 | `SOLIS-FAX-TEST-1-PAGE.pdf` | an approved **email** address (external, so Exchange's outbound rules apply) | every inspection check holds: from the connected mailbox; subject as shown; empty plain-text body (no signature, disclaimer, footer); exactly one attachment, the PDF; its SHA-256 matches |
| 1 | `SOLIS-FAX-TEST-1-PAGE.pdf` | an approved **fax number** (`{number}@fax.nuso.io`) | exactly **1** page received |
| 2 | `SOLIS-FAX-TEST-2-PAGES.pdf` | an approved fax number | exactly **2** pages received |

The PDFs are built on the server (`services/faxTests/faxTestPdf.ts`): US
Letter, "SOLIS FAX TEST / PAGE n OF N", a large n/N mark, "NOT a death
certificate application", no case or personal data, no dates or producer —
always the same bytes. SHA-256: shown in the page and on every record.

## Safeguards

1. **Isolated.** Own collection, own audit events (`fax_test.*`, category
   `administration`, never a case). Never reads or writes a bundle, claim,
   case, document or checklist (structural test). `sendFaxBundle` and
   `sendingEnabled: false` are untouched — real bundles still refuse (409).
2. **Allowlist in code only.** The browser names a recipient by key
   (`fax:3055550101`, `email:…`); the address comes from the profile. An
   email address on the fax gateway domain is not accepted as a dry-run
   address. Empty allowlist = feature off.
3. **Explicit confirmation.** The request must repeat the confirmed recipient
   and page count with `acknowledged: true`; the page shows a confirmation
   naming them, the attachment and its SHA-256.
4. **Persistent, atomic duplicate protection.**
   - Transmission row id = hash(organization, submission id): the same
     request again (double click, refresh, retried call) finds its record and
     sends nothing (`duplicate: true`).
   - Lock row id = hash(organization): only ONE open test per organization.
     Wix refuses a second insert of the same id (HTTP 409), so concurrent
     requests with different submission ids cannot both proceed. Released
     only when the test is resolved (not sent / delivered / failed).
5. **Recorded before Outlook.** The record (`contacting`) and
   `fax_test.attempted` are written before Graph is called; if either fails,
   nothing is sent.
6. **No retries.** One Graph send. An error that could not have sent
   (refused before the send call) → `not_sent`, lock released. Anything else
   (a 5xx or dropped connection on the send call) → `needs_review`: it may
   have been sent; it stays open and blocks every new test until an
   administrator records what happened (`not_sent` needs a reason).
7. **Stages recorded separately.** `outlookContactedAt` → `submittedAt`
   (Graph accepted: NOT delivery) → `nusoAcceptedAt` (NuSo acknowledged;
   reference) → `outcomeAt` (delivered with **pages received**, or failed).
   Every change is in the record's history and audited.
8. **Removable.** Empty the allowlist (deploy) to turn it off; to remove it,
   revert the commit — the collection can stay as history or be deleted.

## Distinguishing the stages

| Stage | Evidence | Recorded |
|---|---|---|
| Outlook submission | Graph accepted the send; message in Sent Items (`internetMessageId`) | automatically: `submitted` |
| NuSo acceptance | NuSo's acknowledgement email or its outbound log | by an administrator: `nuso_accepted` (+ reference) |
| Delivery | NuSo's delivery report (status, pages) **and** the fax received on our line, every page counted | by an administrator: `delivered` + pages received |
| Failure | an Exchange bounce (e.g. sender not authorized in NuSo) or NuSo's failure report | `failed` |

## Wix migration (needed before deploy — not done)

Collection **`faxTestTransmissions`** — NATIVE, permissions read/insert/
update/remove = **Admin**, all fields optional.

| Field | Type |
|---|---|
| `beaconFaxTestId` (= `_id`: `fxt-`/`fxl-` + 40 hex) | TEXT |
| `recordType` (`transmission` / `lock`), `organizationId`, `submissionId`, `kind`, `recipientKey`, `recipientAddress`, `recipientDisplay`, `senderAddress`, `subject`, `attachmentName`, `pdfChecksumSha256`, `status` | TEXT |
| `step`, `pages`, `pdfSizeBytes`, `revision`, `pagesReceived` | NUMBER |
| `passed` | BOOLEAN |
| `requestedBy`, `createdAt`, `outlookContactedAt`, `submittedAt`, `outlookDraftId`, `internetMessageId`, `failureMessage`, `nusoAcceptedAt`, `nusoReference`, `outcomeAt`, `note`, `updatedAt`, `updatedBy`, `transmissionId` | TEXT |
| `checks` (JSON text) | TEXT |
| `history` | ARRAY |

Index: (`organizationId`, `createdAt`). Before the collection exists every
send is refused ("could not be recorded … Nothing was sent").

## Prerequisites outside SOLIS (business / administrators)

- **NuSo:** email-to-fax enabled; the connected mailbox is an **authorized
  sender** (its absence caused earlier failed tests); account cover page OFF;
  whether the email body or subject is ever rendered as a page; the header
  line it stamps; success/failure notices go to the connected mailbox;
  attachment and TLS limits; cost per page.
- **Exchange / Microsoft 365:** no mail-flow (transport) rule adds a
  disclaimer; no signature service (Exclaimer, CodeTwo, …) is connected; no
  sensitivity label adds a header/footer. These apply to Graph-sent mail;
  Outlook-client signatures do not.
- **Recipients:** a fax number the business controls (never Manatee
  County), received somewhere every page can be counted; an external email
  address the business controls for the dry run.

## Deployment (each needs approval)

1. Create `faxTestTransmissions` (above); verify schema, permissions, index.
2. Deploy this code with the allowlist still EMPTY (feature visible as off).
3. Add the approved recipients (reviewed deploy).
4. Step 0, then 1, then 2 — each transmission separately approved.
5. Empty the allowlist again (deploy). Then, separately, decide on
   `sendingEnabled`.
