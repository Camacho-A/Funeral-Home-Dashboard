# Manors SOLIS — production deployment plan (2026-10)

**Status: pre-deploy checks complete (2026-10-16).** V1 passed 8/8. `DEPLOYMENT_ORGANIZATION_IDS=managed-cremations` was confirmed in both Production and Preview. `AUTH_ADAPTER=identity` was confirmed from the live login page. The original note follows: Nothing in this plan has been run against production. Every step marked **[approval]** needs the owner's explicit go-ahead.

## 1. Commits

| | Commit | Notes |
|---|---|---|
| **Production now** | `5a40b24` (master) | Vercel deployment `dpl_87yajuBdbLDYmEius1EKrS3snUkk`, created 2026-10-14 21:29 EDT. The commit SHA was read from Vercel's deployment metadata, not assumed from master. |
| **Target** | head of `perf/phase-1-auth-and-query-cache` | This plan's own commit. The code commit is `9eee2e8`. |

`master` is an ancestor of the branch, so the merge is a fast-forward and no other work is mixed in.

Production deploys from GitHub through Vercel's integration (`githubCommitRef: master`), so **pushing to master is the deploy.** Vercel reports the repository as public; no secrets are tracked, and `.env*` has never been committed.

## 2. Changes included (5a40b24 → target)

| Commit | Change |
|---|---|
| `6ed3b0a` | Multi-tenant isolation hardening for the shared Beacon backend: a `DEPLOYMENT_ORGANIZATION_IDS` allowlist enforced server-side; identity-only auth when `DATA_ADAPTER=wix`. |
| `58a1e68` | Performance: fewer sequential Wix calls during staff auth; a per-request permission memo; a 30-second client cache scoped per user and organization. |
| `305643b` | Keeps `next/headers` out of the browser bundle. |
| `ed509ca` | The First Call document is named "First Call". Step 2 now reads "Attestation Received / Hard Saved" (display-only, Manors only). |
| `66f1bd5` | JotForm PDF import is retry-safe (deterministic document IDs). Staff "Create Case" imports the PDF. A case created from a form is never reported as failed. |
| `1ec0662` | Code support for workflow v7 (certifier fax). It does nothing until v7 is published. |
| `9eee2e8` | Case revisions and concurrency (`docs/CASE_CONCURRENCY.md`). Bulk Advance actually saves. The case-number sequence race is fixed. A JotForm 429/5xx now means "retry later". |

## 3. Environment variables (Vercel, Production **and** Preview)

| Variable | Requirement | State observed (names only; values are encrypted) |
|---|---|---|
| `DEPLOYMENT_ORGANIZATION_IDS` | **Exactly** `managed-cremations`: lowercase, no quotes, no spaces. If it is missing or malformed, every staff request gets a 500 (an outage that leaks nothing). | Present in Production and Preview. **Value not readable — confirm in the dashboard [owner].** |
| `AUTH_ADAPTER` | `identity`, or unset (unset now defaults to identity when `DATA_ADAPTER=wix`). `mock` or `wix` is now refused. | Present. **Confirm it is `identity` [owner].** |
| `DATA_ADAPTER` | `wix` | Present |
| `RESEND_FROM_ADDRESS` | A valid sender. Without one, email fails safely. | Present |
| `JOTFORM_API_KEY`, `CRON_SECRET`, `WIX_API_KEY`, `WIX_SITE_ID` | Unchanged | Present |

No new variables are required.

**Note:** Preview deployments use the same live Wix credentials as Production. A preview of this branch is connected to live Beacon and restricted only by its own `DEPLOYMENT_ORGANIZATION_IDS`.

## 4. Wix schema changes

**None are applied, and none are required by the code.** Case writes add a `revision` (Number) field. The live `cases` collection does not declare it today (58 declared fields, checked read-only on 2026-10-16), and Gus does not declare it either.

Two things have not been verified live:
- that Wix stores and filters on a field the collection does not declare;
- that the **multi-field** conditional patch is all-or-nothing.

The single-field form was verified live in 2026-09. This is step **V1**.

## 5. JotForm configuration

**None needed.** `externalFormConfigs` (read-only check on 2026-10-16) has exactly one enabled row for each Manors form, all owned by `managed-cremations`, and no other organization uses those form IDs. So the new "duplicate config → 409" rule cannot fire.

Arrangement is `case_create`. No live form changes are needed.

## 6. Pre-deploy steps

1. **[owner]** Confirm the `DEPLOYMENT_ORGANIZATION_IDS` and `AUTH_ADAPTER` values (section 3).
2. **[approval] V1 — live Wix verification of the case write.** Run against a disposable row, never a real case:
   - Insert one `cases` row with `organizationId: "verification-sandbox"`. That organization is not on any allowlist, so no app can show it.
   - Run the five checks below.
   - Delete the row.

   **Checks** (each is a live write):

   | # | Write | Expected result |
   |---|---|---|
   | a | Conditional patch with `revision $eq null` | Applies and sets `revision: 1` |
   | b | The same condition again | HTTP 428 |
   | c | A multi-field patch with a stale revision | Nothing applied, including the other fields |
   | d | A multi-field patch with the current revision | Every field applied |
   | e | A query filtering on `revision` | Returns the row |

   This is the only blocker that cannot be cleared without a live write.
3. Take a progress snapshot (read-only):
   ```
   node scripts/case-progress-snapshot.mjs snapshot managed-cremations > before.json
   ```
   The snapshot taken on 2026-10-16 showed 7 cases, B2026-034 to B2026-040, on workflow versions 3, 5 and 6, none with a revision.

## 7. Deploy **[approval]**

1. Fast-forward master: `git push origin <target-sha>:master`. Vercel builds and promotes production.
2. Watch the build in Vercel. If the build fails, production is untouched.

## 8. Smoke tests (production, signed in as Manors staff)

1. **Login and isolation**
   - Manors staff can sign in.
   - A Gus-only account is refused on the Manors domain.
   - The organization switcher lists Manors only.
2. **Existing case progress**
   - Run `snapshot` again into `after.json`, then `compare before.json after.json`. It must print `OK`.
   - Open B2026-039: the checklist is unchanged, Certifier shows **name + phone**, and Step 2 reads **"Attestation Received / Hard Saved"**.
3. **Concurrency**
   - Open the same case in two tabs.
   - Tick a different checklist item in each tab: both ticks stick.
   - Edit the same field in both tabs: the second save shows the **"changed by someone else"** banner. Refresh and Retry both work.
4. **Documents:** a case's First Call PDF reads "First Call.pdf", and Arrangement PDFs read "Arrangement Forms.pdf". Both open.
5. **Bulk Advance** on the cases list persists after a page reload. It used to do nothing in production.
6. **JotForm:** the next real Arrangement submission attaches its PDF once. Confirm in the case's Documents tab and Forms section.

## 9. Workflow v7 publication **[approval]** (only after section 8 passes)

1. A Manors administrator publishes the version: `POST /api/workflow-templates/workflow-template-standard-cremation/versions` with `docs/proposals/manors-certifier-fax-v7.payload.json`, sent from a signed-in administrator session.
   - The payload was re-verified on 2026-10-16: it equals live v6 plus exactly the two approved changes (certifier fax and the 12-hour Time of Death editor), at raw stages 0 and 1.
2. **Existing cases keep progress:** re-run the snapshot compare. It must print `OK`, and no `workflowTemplateVersion` may change. Cases are frozen to their own version.
3. **New cases use the fax:**
   - Settings → Workflow Editor shows v7, with "Completed by: Certifier name + Certifier fax".
   - The next new case shows **Certifier fax** in its checklist, and the item is incomplete until a fax is entered.
   - A test case uses a real case number, so verify on the next genuine case, or archive the test case afterwards.
4. **12-hour Time of Death:** on that new case, Time of Death in the checklist shows hour / minute / AM-PM selectors.

## 10. Rollback

- **Code:** in Vercel, promote the previous production deployment (`dpl_87yajuBdbLDYmEius1EKrS3snUkk`) using Instant Rollback, or `git push --force-with-lease origin 5a40b24:master`. No data migration needs undoing.
- **Data written by the new code stays readable by the old code.**
  - The `revision` field is an extra field the old code ignores and preserves.
  - The new PDF document IDs are ordinary IDs.
  - The old code does not bump `revision`, so it reintroduces the old stale-write risk until it is rolled forward again.
- **If v7 is already published, roll back the workflow before the code.** The old code does not render the fax field, and it treats a phone number as completing the v7 certifier item. Publish a v8 equal to live v6 first (the same endpoint, with v6's stages and intake). Cases created under v7 keep v7.

## 11. Manors stays isolated from Gus

- **Allowlist:** `DEPLOYMENT_ORGANIZATION_IDS=managed-cremations` is enforced server-side on staff APIs, the portal, the family portal, public signing and calendar links, webhooks and crons. Each is covered by tests in `lib/auth/*Isolation*.test.ts` and `services/scheduledJobs/sweep*`.
- **Case writes:** every write is conditioned on `organizationId`, so a write can never land on another organization's row.
- **Shared rows:** Gus has written no `cases` rows (read-only check on 2026-10-16: all 7 rows are Manors). Both apps now use the same revision contract.

## 12. Open risks

| Risk | Status |
|---|---|
| V1 | **Cleared.** Passed 8/8 on 2026-10-16; the sandbox row was deleted |
| `DEPLOYMENT_ORGANIZATION_IDS` / `AUTH_ADAPTER` | **Cleared.** `managed-cremations` in both Production and Preview; `identity` shown by the live login |
| Ingestion items deferred (section 13) | Can follow deployment |
| Client permission cache can show already-loaded data for up to 30 s after a role is revoked (server enforcement is immediate) | Can follow |
| Payment-status poll (GET) can trigger mark-paid with organization membership only, no `can*()` check. Only a Clover-confirmed payment is written. | Can follow |

## 13. JotForm ingestion: what remains

**Fixed on this branch:**
- duplicate PDFs;
- lost "stored" state;
- create-case PDF import;
- a created case reported as failed;
- failure logging;
- JotForm 429/5xx dropping a delivery;
- a review applied to the wrong case.

**Can safely follow deployment:**
- A case whose form link failed to write (rare) cannot be repaired from the UI.
- A failure in the matched-case path is not repaired by JotForm redelivery. Retry PDF covers the PDF.
- A link token can be reused by a second submission.
- The duplicate-case guard compares dates as exact strings.
- JotForm file-upload and signature attachments are not imported. Only the filled submission PDF is.

**Requires live verification:**
- First Call and Arrangement PDF naming on the next real submissions.
- Retry PDF on a real failed import.
