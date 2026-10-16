# Case concurrency (case revisions)

Introduced 2026-10. Applies to every write to an existing row in the Wix `cases` collection. **Wire-compatible with Gus SOLIS**, which writes the same rows on the same Beacon backend.

## The problem it closes

Before this change, every case update read the row, merged its change into what it read, and wrote the whole row back with a full replace (`updateWixDataItem`) and no precondition. Anything that landed in between was silently undone. These cases were all reproducible:

- A staff checklist click, sent as the whole `checklistState` map from a cache up to 30 seconds old, erased the payment tick set by the Clover webhook.
- Workflow reconciliation re-sent a row it had read before several other Wix reads, undoing checklist ticks and staff edits made in the meantime.
- Two staff editing the same case lost one edit without any warning.
- Auto-archive re-sent the row from the edit's own response.

## The mechanism

1. **Revision.** The Wix field is `revision` (an optional Number). It is never writable by clients. A row without the field is a legacy row and reads as revision 0.
2. **Conditional, field-scoped writes.** Every update is one Wix PatchDataItem that:
   - sets only the fields it changes, plus `revision = read + 1`;
   - is conditioned on `organizationId`, `beaconCaseId`, and `revision` equal to the value read. A legacy row is matched with `$eq: null`, never 0.
   If anything else was written first, Wix refuses the patch (HTTP 428, `WDE0193`) and nothing is written. No case write performs a full replace any more.
3. **Map fields merge per key.** `checklistState`, `fieldValues` and `vaStepsState` patches carry only the keys being changed. The server merges them into the current map. A patch never removes a key.
4. **Staff saves** (`PATCH /api/cases/[caseId]`):
   - **Revision required.** The request must include `expectedRevision` (in the body or as `If-Match`). If it is missing, the route answers **428** `revision_required` and writes nothing. If it is malformed, the route answers **400**.
   - **Stale revision.** The route answers **409** `revision_conflict` with the current case and `currentRevision`, and records a `case.update.conflict` audit event containing field names only. One exception: if the edit changes only map keys and every one of those keys still holds the value staff saw (`baseValues`), the edit is applied to the current case.
   - **Already applied.** A retry of a save that already landed changes nothing and answers 200, so retries never write twice.
5. **Server-side writers** read, decide and conditionally write, re-reading on conflict up to 3 times (`services/caseWriteService.ts#updateCaseWithRetry`). They never loop unbounded. These writers are:
   - reconciliation, which raises the stage only and never moves it back;
   - mark-paid, which sets `paymentStatus` and one checklist key;
   - automatic archiving.
6. **Client.**
   - Edits to one case run in order through a single queue. Each edit is sent with the revision the previous save produced.
   - On a refusal, the case page shows **Refresh** (load the current case and drop the change) and **Retry my change** (apply it to the current case).
   - Bulk Advance sends each list row's revision and reports any rows that had changed. It also used to run in mock mode in production and never persist; that is fixed.
   - Archive and Restore send the revision of the case the page is showing.
   - Form review sends the revision its rows were computed against. A submission already linked to a case can only be applied to that case.
7. **Case-number sequence.** The historical-import counter advance is now a conditional single-field patch. It can no longer roll back a concurrent allocation.

## Compatibility with Gus SOLIS

Both apps implement the same contract:

- the same field, condition shape, increment and legacy `$eq: null` rule;
- the same 409/428 reasons and messages, and the same `case.update.conflict` event type;
- neither app full-replaces a `cases` row.

As a result, each app's writes are visible to the other app's revision checks.

## Not yet verified live

The single-field conditional patch was verified live on 2026-09, on `externalFormSubmissions`. Two things have not been verified:

- the **multi-field** form;
- a condition on the **`revision` field, which the live `cases` collection does not declare**.

Gus's own plan carries the same gap. See the deployment plan for the approved verification step.
