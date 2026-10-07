# JotForm Integration

How SOLIS receives JotForm submissions, which forms are configured, how a
submission becomes (or updates) a case, and what has to be set up once by
hand.

No secrets appear in this document.

---

## The shape of it

```
JotForm form  ──POST──▶  /api/webhooks/jotform
                              │
                              ├─ resolve ExternalFormConfig by (provider, formId)
                              │     └─ this is what determines the ORGANIZATION
                              ├─ verify shared secret (hidden field, qid from config)
                              ├─ store ExternalFormSubmission (deterministic id = idempotency)
                              │
                              ├─ link token present and resolves?  ──▶ attach to that case
                              │
                              └─ no link + config.purpose === 'case_create' ──▶ create a case
```

Two forms, two behaviours, one case.

| Manors form | Form ID | Purpose | On submission |
|---|---|---|---|
| First Call Sheet | `262664842044055` | `case_create` | Creates a new case |
| Arrangement Forms | `261945978664175` | `case_update` | Updates the case its link token identifies |
| Vital Statistics | `262605621454050` | `case_update` | Updates the case its link token identifies |

---

## Configuration lives in data, not code

A form is known to SOLIS by a row in the `externalFormConfigs` Wix
collection (`types/externalFormConfig.ts`). The row is what maps a form to
an organization — the webhook never trusts an `organizationId` from the
request body.

| Field | Meaning |
|---|---|
| `organizationId` | Which funeral home owns this form |
| `provider` | `'jotform'` |
| `externalFormId` | JotForm's own form id |
| `label` | Human name, e.g. "First Call Sheet" |
| `audience` | `'family'` or `'staff'` — who fills it in |
| `purpose` | `'case_create'` or `'case_update'` — **what a submission does** |
| `linkTokenFieldQid` | qid of the hidden field carrying the case link token |
| `webhookAuthFieldQid` | qid of the hidden field carrying the shared secret |
| `isEnabled` | Disabled forms are rejected outright |

### `purpose` is opt-in

A row that omits `purpose`, or carries an unrecognized value, reads as
`'case_update'`. Allocating case numbers is a capability a form must be
explicitly granted — the failure mode of a misconfigured row is always
"cannot create a case", never "unexpectedly created one".

### qid, not field name

Hidden fields are located by **qid**, never by name. A live audit found
JotForm's internal name for a hidden field is unreliable — sometimes
lowercased, sometimes an auto-generated placeholder like `input274`. The
qid is stable, so it is what the config stores and what the webhook reads.

---

## Field mapping

The authoritative map is **code**, in `domain/externalForms/fieldMapping.ts`,
keyed by form id via `fieldMapForForm(provider, externalFormId)`. The
`fieldMap` column on the config row is a display/debugging serialization
only and is never parsed.

### Each form gets its own map — never a shared block

This matters more than it looks. The same qid number means different
things on different forms:

| qid | First Call Sheet | Vital Statistics | Arrangement Forms |
|---|---|---|---|
| 3 | Decedent name | Decedent name | — |
| 6 | **Date of birth** | **Date of death** | — |
| 8 | Date of death | — | Date of birth |
| 10 | — | **Date of birth** | **Date of death** |
| 24 | **NOK email** | **NOK phone** | — |

A "common" block of qids applied across forms caused a real bug in
2026-09 (prefill writing Vital Statistics' qids onto Arrangement Forms).
It was removed. Do not reintroduce one: adding a form means adding its own
map, nothing else.

### First Call Sheet → Case

| qid | Question | Case field |
|---|---|---|
| 3 | Name of Deceased | `decedentName` (first + last) |
| 6 | Date of Birth | `dateOfBirth` |
| 7 | Weight | `weight` |
| 8 | Date of Death | `dateOfDeath` |
| 9 | Time of Death | `timeOfDeath` |
| 20 | Place of Death | `placeOfDeath` |
| 22 | Next of Kin / Family Contact | `nextOfKinName` |
| 23 | Next of Kin Phone Number | `nextOfKinPhone` |
| 24 | Next of Kin Email | `nextOfKinEmail` |

Deliberately **not** mapped: qid 14 "Name on Card" (payment-instrument
data — SOLIS stores no card data of any kind), qid 21 "Hospice or Dr. to
sign D/C" (free text with no single canonical destination; SOLIS uses the
structured `certifierName`/`certifierPhone` pair instead), qid 25
"Facility Phone Number" (no Case field exists). All three remain
submission-only data, visible for staff review.

`decedentName`, `nextOfKinName`, and `nextOfKinPhone` are required. A
submission missing any of them does **not** create a case — it stays
unmatched for staff to resolve by hand. Nothing is guessed.

### Arrangement Forms → Case

Unchanged by the automated-intake work. See `FIELD_MAP_ARRANGEMENT_FORMS`
and `domain/externalForms/arrangementNokDerivation.ts` (qid 276 decides
whether next-of-kin comes from the Informant block or from qids 277-279).

---

## How the two forms reach one case

```
First Call submission
   └─▶ creates case B2026-XXX

Staff open the Arrangement form from that case
   └─▶ generate-link mints a CaseFormLink + raw link token
   └─▶ the token is prefilled into the form's hidden field (qid 274)

Arrangement submission comes back carrying that token
   └─▶ webhook resolves the token to the CaseFormLink
   └─▶ updates B2026-XXX — never creates a second case
```

Case identity travels as an **opaque link token**, not as a name, phone,
or date. There is no fuzzy matching anywhere in this pipeline. A token
that does not resolve means the submission is stored unmatched, never
attached to a guessed case.

---

## Duplicate protection

Four independent layers, all of which survive a restart because they are
persisted:

1. **Deterministic submission id** — `{organizationId}-{provider}-{externalSubmissionId}`
   is the row's primary key, so a redelivery is a duplicate-key insert,
   not a second row.
2. **`wasNew` gate** — a redelivery returns immediately; no second case,
   no second PDF fetch, no duplicate activity.
3. **Compare-and-swap claim** on `createdCaseId` — two concurrent
   deliveries of one submission cannot both create a case. The loser
   backs off; a failure releases the claim rather than latching it.
4. **PDF dedup** — `pdfStatus === 'stored'` short-circuits re-upload.

---

## Multi-tenant safety

- Organization comes **only** from the server-side config row, resolved by
  form id. The payload's own fields are never trusted for it.
- A link token resolves by hash with no org filter, so the webhook
  explicitly checks that the resolved link's organization matches the
  config's. A mismatch is treated as no link at all — the submission is
  stored unmatched and no cross-tenant write occurs.
- The intake authorization token (below) is bound to one organization, one
  form, and one submission, and `POST /api/cases` requires the request
  body's `organizationId` to match the token's.

---

## How a webhook creates a case without a session

`POST /api/cases` is the only case-creation path, and every JotForm
surface is structurally forbidden from duplicating it (enforced by
`domain/externalForms/criticalInvariants.test.ts`). The historical-import
route reaches it by forwarding a staff member's session cookie. A webhook
has no cookie.

So the webhook mints a **signed intake authorization**
(`lib/auth/externalFormIntakeAuthorization.ts`) and presents that instead.
It is minted only after the form config has been resolved and the shared
secret verified, so it attests to checks that already passed. It carries
exactly one capability, expires in five minutes, and is bound to one form
and one submission — strictly narrower than the staff cookie the other
path forwards.

Case numbers still come from `reserveNextCaseNumber` through the normal
route. Nothing in this integration allocates or predicts one.

---

## Environment variables

| Variable | Required for | Notes |
|---|---|---|
| `JOTFORM_API_KEY` | PDF preservation, pulling submissions | Server-only. Sent as an `APIKEY` header, never in a URL. |
| `JOTFORM_WEBHOOK_SHARED_SECRET` | **The webhook itself** | Fails closed — if unset, every delivery is rejected 401. |
| `APP_BASE_URL` | Prefill links, absolute URLs | Must be the real public origin in production. |
| `SESSION_SECRET` | Signing the intake authorization | Already required; no new secret is introduced. |

---

## One-time setup to make intake automatic

These are the steps that cannot be done from the repository.

**1. Set the shared secret.** Choose a long random string. Set
`JOTFORM_WEBHOOK_SHARED_SECRET` to it in the deployment environment.

**2. Add two hidden fields to the First Call Sheet** (form
`262664842044055`), which currently has neither:

- a hidden short-text field whose **value** is the shared secret from step
  1. Note the qid JotForm assigns it.
- no link-token field is needed — a first call has no case to link to yet.

**3. Record that qid.** Set the First Call config row's
`webhookAuthFieldQid` to the qid from step 2. The seeded value is `'26'`,
which is the next qid the form would allocate — if JotForm assigns a
different one, the config must be corrected or every delivery will 401.

**4. Register the webhook on both forms.** In each form's
*Settings → Integrations → Webhooks*, add:

```
https://<your-APP_BASE_URL>/api/webhooks/jotform
```

Both `262664842044055` (First Call Sheet) and `261945978664175`
(Arrangement Forms).

**5. Confirm the Arrangement form's hidden fields exist** — qid 274 (link
token) and qid 275 (`solisWebhookAuth`). These are already configured in
SOLIS; the form must actually carry them.

**6. Live Wix config rows.** `externalFormConfigs` rows in production are
documented as still missing `linkTokenFieldQid` / `webhookAuthFieldQid`
(see `docs/WIX_DATA_SCHEMA.md`). Until those columns exist and are
populated, every config maps to `null` in `wix` mode and the integration
cannot resolve any form. The new `purpose` column should be added at the
same time; rows without it read as `'case_update'`, so only the First Call
row strictly needs it set.

After that, submissions import on their own. No manual import step.

---

## Adding another organization or form

Nothing in the engine is Manors-specific.

**Another organization** (e.g. Gus Camacho): add an `externalFormConfigs`
row per form with that organization's `organizationId`, the form's own id,
and the appropriate `purpose`. Add a field map for each form in
`fieldMapping.ts` and register it in `fieldMapForForm`. Register the same
webhook URL on those forms. No webhook, service, or route changes.

**Another form for an existing organization**: a config row plus a field
map. That is all.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Every delivery 401s | `JOTFORM_WEBHOOK_SHARED_SECRET` unset, or the hidden field's qid in the config does not match the live form | Check the env var, then the qid |
| Delivery 404s | Form id not configured, or `isEnabled` is false | Add/enable the config row |
| Submission lands in Unmatched Forms instead of creating a case | Config `purpose` is not `'case_create'`, or a required field was blank | Check `purpose`; check the submission has decedent name, NOK name, NOK phone |
| Arrangement submission created a second case | Should be impossible — only `case_create` forms create | Check that form's `purpose` is `'case_update'` |
| Arrangement submission did not attach to its case | Link token missing, unresolvable, or belonging to another organization | Regenerate the form link from the case |
| Case created but no PDF | PDF preservation is best-effort and independent | Retry from the submission's retry-PDF action |

Failed and unmatched submissions are never silently dropped — they are
visible at `/unmatched-forms` and can be attached to a case by hand.
