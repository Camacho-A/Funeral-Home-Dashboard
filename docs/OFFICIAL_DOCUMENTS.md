# Official documents: Envelope and Certificate of Cremation

Introduced 2026-10. Both documents are filled from Manors' own files. Nothing
redraws them.

## When they are generated

- **Envelope:** needs only the decedent's name. It prints "<Name>
  (Deceased)" and never the Tag Number, so a Tag Number is not required
  (2026-10).
  - Created automatically when a valid Tag Number is first saved and the
    case has no Envelope yet.
  - Regenerated when the name changes on a case that has an Envelope (or a
    Tag Number).
  - Never merely because a case was created, and never a second, identical
    copy because a Tag Number was added or corrected.
- **Certificate of Cremation:** as soon as the case has everything the form
  prints (the name, a valid Tag Number, the date of death and the date of
  cremation), and again whenever any of them changes.
- **On demand:** Documents tab → **Generate Envelope** (needs the name
  only) / **Generate Certificate** (needs all four). Use this for cases
  that existed before the feature, or to retry after a failure. If something
  is missing, staff are told exactly what to add; nothing is stored.
- **Never:** for archived cases, or for organizations without these templates
  (`domain/documents/officialDocumentTriggers.ts`).

Each document is stored like every other generated document: versioned, the
previous version moved to History, audited, and announced.

## Envelope

- **Background:** `assets/documents/manors-envelope.pdf`. This is "Manors
  Envelope English Broward Office.docx" exported by Microsoft Word with only
  the sample name removed. A pixel comparison against Word's export of the
  untouched file differs inside that name's box and nowhere else.
- **Name:** drawn as "<Name> (Deceased)" on Word's baseline, centered,
  calibrated to the same width as Word's rendering.
- **Font:** Libre Baskerville (SIL OFL, licence in
  `assets/documents/fonts/`). The template's Baskerville is an Apple system
  font and cannot be distributed in this public repository.

## Certificate of Cremation

- **The template is the signed, fillable PDF itself.** Its own form fields
  are filled in their own fonts (Times-Bold 14, Times-Roman 13). The
  on-screen Reset/Print buttons are removed, and the form is flattened.
- **The two date fields are filled by position, not by name.** The official
  file names them the wrong way round: its "DateOfCremation" field sits beside
  "Date of Death:".
- **The template is not in this repository.** It contains a real signature,
  a seal and a license number, and the repository is public. It is read at
  runtime from private document storage.

### Production setup (requires approval)

1. Upload `Manors Cremation Certificate of Cremation Broward Signed.pdf` to
   the app's private document storage (Vercel Blob, private), for example at
   `managed-cremations/templates/certificate-of-cremation.pdf`.
2. Set `CERTIFICATE_OF_CREMATION_TEMPLATE_STORAGE_KEY` to that key in the
   Vercel Production environment, and in Preview if wanted.

The key must be the file's **exact path** in the store. Uploading through
the Vercel dashboard keeps the file's original name and the folder that is
open at the time, so either open (or create) `managed-cremations/templates/`
and upload a copy named `certificate-of-cremation.pdf`, or set the variable
to the path the dashboard shows. The variable is read on each request, so
moving the file to the configured path needs no redeploy; changing the
variable does.

Until both are done, staff see "the signed Certificate of Cremation template
could not be found in document storage", and the logs name the key that was
looked up. (2026-10-20: the template had been uploaded to the top of the
store as `Manors Cremation Certificate of Cremation Broward Signed.pdf`,
which is why Production reported "no blob found".)
Nothing is approximated. For local development,
`CERTIFICATE_OF_CREMATION_TEMPLATE_PATH` may point at a local copy instead.

## Manatee County — Death Certificate Application

Form DH 1961, "Application for a Florida Death Record" (Florida Department of
Health in Manatee County), in Manors' own copy — prefilled with the applicant
(Gus Camacho Jr., Funeral Director, license, address) and his signature.
Made on demand: Documents → Create document → "Manatee County — Death
Certificate Application…". Code: `domain/documents/manateeDeathCertificateApplication.ts`,
`services/manateeApplicationTemplate.ts`, `services/manateeApplicationService.ts`.

- **Staff review every value first.** Names come only from the intake forms'
  first / middle / last boxes; the SSN from the Arrangement Form or the Vital
  Statistics form (shown in the window only as its last four digits); city of
  death from the forms; date of death, next of kin and relationship from the
  case. No record holds the county, so staff enter it — never inferred from a
  city. Corrections apply to the document only, never the case.
- **Only the form's own fields are filled**, plus, when staff confirm the
  FedEx fee, "1" and "15.00" in the FedEx row's blank quantity and total
  spaces (the $15.00 is printed). "Request ___ of ___" only when staff type
  both numbers. Totals: $8.00 per certificate; Grand Total includes FedEx
  only when confirmed. A template whose printed price is not $8.00 is refused.
- **The saved PDF is flattened** (cannot be edited). A correction is a new
  version made through SOLIS; the previous one stays in History.
- **The template is not in this repository** (it carries a real signature).
  It is read from private document storage. Verified 2026-10: filling changes
  no pixel outside the filled fields and the two FedEx spaces; flattening
  itself only re-renders the prefilled text's edges (at most 64/255).

### Production setup (requires approval)

1. Upload the signed form — `GCFH MANATEE COUNTY - Vital Statistics _Fill-In_[857]new_MANORS.pdf`,
   SHA-256 `4b102fb06af43a6717434cfd0096332c9bd783bd3f378ba53089508d5f4aa9dc` —
   to the app's private document storage:

   ```
   BLOB_READ_WRITE_TOKEN=… node scripts/uploadManateeTemplate.mjs "<path to the PDF>" --dry-run
   BLOB_READ_WRITE_TOKEN=… node scripts/uploadManateeTemplate.mjs "<path to the PDF>"
   ```

   It refuses any other file, refuses if anything already exists at
   `managed-cremations/templates/manatee-death-certificate-application.pdf`
   (nothing is overwritten), and reads the upload back to verify it.
2. Set `MANATEE_DC_APPLICATION_TEMPLATE_STORAGE_KEY=managed-cremations/templates/manatee-death-certificate-application.pdf`
   in the Vercel Production environment (and Preview if wanted), then redeploy.

Until both are done, staff see "The Manatee County form is not set up yet."
For local development, `MANATEE_DC_APPLICATION_TEMPLATE_PATH` may point at a
local copy instead.

## Deployment note

PDF routes must ship what they read at runtime. `next.config.ts` lists:

- `CHROMIUM_PDF_ROUTES`: routes that render HTML through Chromium.
- `OFFICIAL_TEMPLATE_ROUTES`: routes that read `assets/documents`.

`next.config.test.ts` fails if a listed route does not exist.
