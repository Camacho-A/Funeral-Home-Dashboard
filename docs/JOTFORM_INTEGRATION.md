# JotForm Integration

How SOLIS receives JotForm submissions, which forms are configured, how a
submission becomes (or updates) a case, and what has to be set up once by
hand.

No secrets appear in this document.

---

## The shape of it

```
JotForm form  ──POST──▶  /api/webhooks/jotform
                              │   (body = an untrusted NOTIFICATION:
                              │    only formID + submissionID are read)
                              │
                              ├─ resolve ExternalFormConfig by (provider, formId)
                              │     └─ this is what determines the ORGANIZATION
                              │
                              ├─ authenticate against JotForm's own API
                              │     GET /submission/{id}  (server-only API key)
                              │     ├─ JotForm won't return it?        ──▶ 401
                              │     ├─ its real form_id ≠ claimed?     ──▶ 401
                              │     ├─ older than the replay bound?    ──▶ 401
                              │     └─ JotForm unreachable?            ──▶ 503 (retry)
                              │     └─ ✅ returns the AUTHORITATIVE answers
                              │
                              ├─ store ExternalFormSubmission (deterministic id = idempotency)
                              │
                              ├─ link token (read from the API answers) resolves? ──▶ attach to that case
                              │
                              └─ no link + config.purpose === 'case_create' ──▶ create a case
```

Three forms, two behaviours, one case.

| Manors form | Form ID | Purpose | On submission |
|---|---|---|---|
| Manors First Call Sheet | `262664842044055` | `case_create` | Creates a new case |
| Manors Cremation Arrangement Forms | `261945978664175` | `case_update` | Updates the case its link token identifies |
| Manors Cremation Vital Statistics | `262605621454050` | `case_update` | Updates the case its link token identifies |

The First Call form was renamed from "First Call Sheet" to **"Manors First Call Sheet"** in
2026-10. The **Form ID did not change**, so nothing in SOLIS's configuration
depended on the rename — only display names and docs did.

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
| `label` | Human name, e.g. "Manors First Call Sheet" |
| `audience` | `'family'` or `'staff'` — who fills it in |
| `purpose` | `'case_create'` or `'case_update'` — **what a submission does** |
| `linkTokenFieldQid` | qid of the hidden field carrying the case link token |
| `webhookAuthFieldQid` | **Deprecated, not read.** See "Webhook authentication" below |
| `isEnabled` | Disabled forms are rejected outright |

### `purpose` is opt-in

A row that omits `purpose`, or carries an unrecognized value, reads as
`'case_update'`. Allocating case numbers is a capability a form must be
explicitly granted — the failure mode of a misconfigured row is always
"cannot create a case", never "unexpectedly created one".

---

## Webhook authentication

### What JotForm actually supports

**JotForm does not sign its webhooks.** Verified from JotForm Support
directly: *"we do not currently offer any security or authentication
mechanisms for webhooks"*
([source](https://www.jotform.com/answers/14043811-authentication-in-webhooks)).
There is no signature header, no HMAC, no timestamp header, and no
shared-secret header. SOLIS therefore invents none.

JotForm's only published suggestion is a secret in the webhook URL's query
string. SOLIS **rejects** that approach: a URL secret is recorded in
platform access logs and request traces, so it replaces one exposed secret
with another.

### The mechanism SOLIS uses instead

The POST body is treated as an untrusted **notification** carrying two
claims and nothing else — `formID` and `submissionID`. Those claims are
checked against JotForm itself:

1. `GET /submission/{id}` with the server-only `JOTFORM_API_KEY` in the
   `APIKEY` header. The key never appears in a URL, a log, or a response.
2. **JotForm returns a submission only if this account owns it.** Confirmed
   empirically: an unknown or foreign submission id answers
   `401 "You're not authorized to use (/submission-id)"` — not `404`. So
   reachability through our own key *is* the proof of provenance.
3. The submission's own `form_id`, as reported by JotForm, must equal the
   claimed one. A real submission on form A can never be presented as a
   submission to form B.
4. **The answers come from that API response**, never from the body's
   `rawRequest`.

So a forged delivery cannot inject case data: fabricated answers are
discarded, and a delivery without a genuine submission id is rejected
outright. The link token is read from the API response too — otherwise a
forged body could pair a genuine submission with a link token of the
attacker's choosing and attach a real submission to the wrong case.

Implementation: `lib/jotform/jotformSubmissionAuthenticity.ts`.

### The retired hidden-field secret

Until 2026-10 the webhook compared a hidden field (`solisWebhookAuth`)
against `JOTFORM_WEBHOOK_SHARED_SECRET`. **That was never authentication.**
A JotForm hidden field is hidden only from the rendering — its default
value ships inside the public form's own markup, so anyone who could open
the form could read the secret and forge a delivery.

It is fully retired: the env var is gone, `lib/jotform/jotformWebhookVerification.ts`
is deleted, and `domain/externalForms/criticalInvariants.test.ts` fails the
build if any of it is reintroduced.

### Residual risk and the replay bound

A submission id is not a secret, so step 2 proves a submission is *genuine*
but must not by itself authorize creation. Two further controls bound that:

- **Idempotency** (unchanged): the submission row's primary key is
  deterministic and case creation sits behind a compare-and-swap claim, so a
  replayed id can never produce a second case.
- **A historical-replay bound** (36 hours), so an attacker cannot walk
  backwards through the account's submission history and force bulk
  ingestion of old submissions.

**Why that bound is hours, not minutes** — a real limitation, stated plainly.
JotForm's `created_at` is formatted `YYYY-MM-DD HH:MM:SS` with **no timezone
offset** (verified against the live API) and is rendered in the JotForm
account's configured timezone, which the server does not know. Any window
tighter than the maximum possible timezone displacement (±14h) would reject
legitimate deliveries rather than add security. It is a replay bound, not a
nonce window, and it supplements the ownership proof rather than replacing it.

### Prefill uses the field NAME; inbound uses the qid

These are two different conventions and conflating them was a real bug
(found and fixed 2026-10).

**Outbound (prefill URL)** — JotForm keys a prefill value by the field's own
`name`. Live-verified against the Arrangement form by loading URLs and
reading the rendered inputs:

| Parameter | Result |
|---|---|
| `?name87[first]=X` | ✅ populates |
| `?input274=X` | ✅ populates |
| `?87_name87[first]=X` | ❌ ignored |
| `?q87_name87[first]=X` | ❌ ignored |
| `?solisLinkToken=X` | ❌ ignored |

SOLIS previously sent `{qid}_{name}`, so **every generated form link arrived
blank — including its case link token**. That is why an Arrangement
submission could never resolve its case, and why the three historical
submissions had to be imported by hand.

`ssoPrefillKey` is *not* the prefill key. Both token fields carry
`ssoPrefillKey: 'solisLinkToken'`, but that is JotForm's SSO-prefill
feature and has no effect on a plain URL.

A `control_datetime` field is compound: it needs `name[month]`,
`name[day]`, `name[year]`. Sending one `MM/DD/YYYY` string filled only the
month dropdown.

`linkTokenFieldName` on the config row therefore stores the hidden field's
real JotForm **name**, which is genuinely unpredictable per form —
`input274` on Arrangement, `solislinktoken` (lowercased) on Vital
Statistics.

Not prefillable: Arrangement qid 1 / 198 (Case No.) are
`form-readonly validate[Numeric]`, so a `B2026-…` value can never land
there. Cosmetic only — the case number is reference text, never linkage.

**Inbound** is unchanged and qid-driven: answers come from JotForm's
authenticated API keyed by qid, never by name.

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

| qid | Manors First Call Sheet | Vital Statistics | Arrangement Forms |
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

### Manors First Call Sheet → Case

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

Compound answer shapes, all confirmed against real submissions: qid 3/22
are `{first, last}` names, qid 6/8 are `{month, day, year}` datetimes, qid
20 is an address (`addr_line1` preferred), qid 23 is `{full}`, and **qid 9
is a `control_time` object** (`{timeInput, hourSelect, minuteSelect, ampm}`)
whose AM/PM value is applied only when the question's own `timeFormat`
says it is a 12-hour question — Jotform emits a vestigial `ampm` even on a
24-hour one, and trusting it blindly puts a twelve-hour error on a legal
record. See `combineTimeParts` in `extractMappedFields.ts`.

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
It is minted only after the form config has been resolved and the delivery
authenticated against JotForm's API, so it attests to checks that already
passed. It carries exactly one capability, expires in five minutes, and is
bound to one form and one submission — strictly narrower than the staff
cookie the other path forwards.

The case is built from JotForm's own authenticated answers, so a forged
delivery cannot reach case creation with data of its own.

Case numbers still come from `reserveNextCaseNumber` through the normal
route. Nothing in this integration allocates or predicts one.

---

## Environment variables

| Variable | Required for | Notes |
|---|---|---|
| `JOTFORM_API_KEY` | **Webhook authentication**, PDF preservation, pulling submissions | Server-only. Sent as an `APIKEY` header, never in a URL. Fails closed — if unset, every delivery is answered 503 and nothing is ingested. |
| `APP_BASE_URL` | Prefill links, absolute URLs | Must be the real public origin in production. |
| `SESSION_SECRET` | Signing the intake authorization | Already required; no new secret is introduced. |

`JOTFORM_WEBHOOK_SHARED_SECRET` was **removed** in 2026-10 and must not be
reintroduced — see "The retired hidden-field secret" above. No code reads
it. Delete it from any deployment environment where it is still set.

**No new secret was introduced by the authentication change.** It reuses the
`JOTFORM_API_KEY` the integration already required.

---

## One-time setup to make intake automatic

Activation status as of 2026-10 (verified against the live JotForm API):

| Step | State |
|---|---|
| Server-side webhook authentication | **Done** — authenticates against JotForm's API; no shared secret to distribute |
| First Call production `externalFormConfigs` row | **Done** — `purpose: 'case_create'` |
| Arrangement / Vital Statistics config rows | **Done** — both carry every required field |
| Arrangement Forms webhook registration | **Done** — `https://solis.manorscremation.com/api/webhooks/jotform` |
| Vital Statistics webhook registration | **Done** — same URL |
| `JOTFORM_API_KEY` in production | **Verify** — now required for the webhook itself, not just PDFs |
| Manors First Call Sheet webhook registration | **Outstanding** — must be added in the JotForm UI |

### Remaining step — register the First Call webhook

JotForm → **Manors First Call Sheet** → Settings → Integrations → Webhooks → add:

```
https://solis.manorscremation.com/api/webhooks/jotform
```

This cannot be automated. `POST /form/{id}/webhooks` answers
`401 "You're not authorized to use (/form-id-webhooks)"` for this account
even though `GET` on the same path succeeds — so it is an account-level API
restriction, not a missing key. The other two forms' webhooks were added
through the UI for the same reason.

Once it is registered, first-call submissions create cases on their own. No
manual import step.

### Verifying `JOTFORM_API_KEY` is live in production

A safe, non-mutating probe — it creates nothing, because the submission id
does not exist:

```
curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  https://solis.manorscremation.com/api/webhooks/jotform \
  -d 'formID=262664842044055&submissionID=1000000000000000001'
```

- `401` → the key is present and working; the fake submission was correctly
  rejected as unverifiable. **This is the expected result.**
- `503` → the key is missing or invalid in production; set `JOTFORM_API_KEY`
  in Vercel and redeploy.

### Safe cleanup now that hidden-field auth is retired

None of this is required for correctness — nothing reads these any more —
but it removes a misleading, publicly-readable value from the live forms:

- **Clear the default values** of the hidden `solisWebhookAuth` fields:
  First Call qid **26** and Arrangement qid **275**. They currently publish
  a string that looks like a credential to anyone who inspects the form.
  Clearing the *value* is safe; leave the fields themselves in place.
- **Delete `JOTFORM_WEBHOOK_SHARED_SECRET`** from the Vercel environment.
- Leave `webhookAuthFieldQid` on the `externalFormConfigs` rows. It is
  ignored, and removing it would be a data migration with no benefit.

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
| Every delivery 503s | `JOTFORM_API_KEY` unset or invalid in the deployment — the webhook needs it to authenticate, and fails closed | Set the key, redeploy, then re-run the probe above. JotForm retries 503s, so nothing is lost |
| A delivery 401s with `submission_not_retrievable` | JotForm would not return that submission to this API key — either it is forged, or the key belongs to a different JotForm account than the form | Confirm the key and the form are the same account |
| A delivery 401s with `form_id_mismatch` | The submission genuinely belongs to a different form than the delivery claimed | Expected for a forged/replayed delivery; otherwise check for a mis-registered webhook URL |
| A delivery 401s with `submission_too_old` | Outside the 36-hour historical-replay bound | Expected for a replay. For a genuine backlog, use the manual import path instead of replaying webhooks |
| Nothing arrives at all for one form | That form has no webhook registered | Check `GET /form/{id}/webhooks`; add it in the JotForm UI |
| Delivery 404s | Form id not configured, or `isEnabled` is false | Add/enable the config row |
| Submission lands in Unmatched Forms instead of creating a case | Config `purpose` is not `'case_create'`, or a required field was blank | Check `purpose`; check the submission has decedent name, NOK name, NOK phone |
| Arrangement submission created a second case | Should be impossible — only `case_create` forms create | Check that form's `purpose` is `'case_update'` |
| Arrangement submission did not attach to its case | Link token missing, unresolvable, or belonging to another organization | Regenerate the form link from the case |
| Case created but no PDF | PDF preservation is best-effort and independent | Retry from the submission's retry-PDF action |
| A first-call submission still shows in Unmatched Forms after creating a case | Fixed 2026-10 — `markCaseCreated` now also sets `status: 'matched'`. Rows written before that fix keep `status: 'unmatched'` | Harmless; mark reviewed, or leave it |
| Time of Death blank on a webhook-created case | Fixed 2026-10 — qid 9 is a compound `control_time` answer that the field map read as absent | Fixed going forward; earlier cases need the field entered by hand |

Failed and unmatched submissions are never silently dropped — they are
visible at `/unmatched-forms` and can be attached to a case by hand.
