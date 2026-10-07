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

Activation status as of 2026-10:

| Step | State |
|---|---|
| First Call Sheet hidden `solisWebhookAuth` field | **Done** — created via the Jotform API, qid **26**, hidden |
| First Call production `externalFormConfigs` row | **Done** — `purpose: 'case_create'`, `webhookAuthFieldQid: '26'` |
| Arrangement Forms webhook registration | **Done** — already pointed at `https://solis.manorscremation.com/api/webhooks/jotform` |
| Arrangement / Vital Statistics config rows | **Done** — both carry every required field |
| `JOTFORM_WEBHOOK_SHARED_SECRET` | **Outstanding** — must be set in Vercel AND as the value of First Call qid 26 |
| First Call Sheet webhook registration | **Outstanding** — the API key is not authorized for `/form/{id}/webhooks` writes |

**Remaining step A — the shared secret.** Pick one long random string and
put the SAME value in both places:

- Vercel → project `manors-cremation-dashboard` → Settings → Environment
  Variables → `JOTFORM_WEBHOOK_SHARED_SECRET` (Production), then redeploy.
- Jotform → First Call Sheet (`262664842044055`) → the hidden
  `solisWebhookAuth` field (qid 26) → set its **default value** to that
  same string.

The Arrangement form already carries its own copy at qid 275; whatever
value that field holds must equal the env var too, since one secret gates
both forms.

**Remaining step B — register the First Call webhook.** Jotform →
First Call Sheet → Settings → Integrations → Webhooks → add:

```
https://solis.manorscremation.com/api/webhooks/jotform
```

The Jotform API returns 401 for webhook creation with the current key, so
this one has to be done in the Jotform UI (or the key's permissions
raised).

After those two, submissions import on their own. No manual import step.

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
