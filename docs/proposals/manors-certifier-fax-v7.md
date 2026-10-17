# Proposal: Manors workflow template v7 (Certifier fax)

**Status: PUBLISHED** on 2026-10-17 at 00:06:38 UTC as `workflow-template-standard-cremation-v7`. A signed-in Manors administrator published it through `POST /api/workflow-templates/.../versions`, using the hash-checked console command.
**Verified after publication (read-only):**
- The stored v7 has 0 value differences from this payload, and exactly 4 differences from v6 (fax and the 12-hour Time of Death, each at raw stages 0 and 1).
- The app's own template lookup resolves new cases to v7.
- All 7 existing cases (B2026-034 to B2026-040) keep their workflow version, stage, and completed checklist items.
- That endpoint records no activity/audit event, so the version row and its timestamp are the only record.
**Organization:** `managed-cremations` (Manors) only
**Template:** `workflow-template-standard-cremation`, current live version **6**

## Why a new version is needed

What completes a checklist item is defined in the workflow template. Each case keeps its own frozen copy of the template version it was created from (`Case.workflowSnapshot`). So the fax requirement has to live in a **new template version**:

- Cases created **after** v7 is published freeze v7. Their Certifier Information item is completed by **Certifier name + Certifier fax**.
- Every case created under v1–v6 keeps the rule it was created with. Nobody is asked for a fax after the fact, no completed item reopens, and no stage moves backwards.

The code that supports v7 has shipped and is safe to deploy before v7 exists. Until v7 is published, new cases keep using v6, so nothing changes.

## Exact change against live v6

`manors-certifier-fax-v7.payload.json` is live v6's `stages` and `intake`, copied verbatim (read on 2026-10-16) with these changes:

| Raw stage | Item | Change |
|---|---|---|
| 0 and 1 | 6 "Certifier Information" | add `requiredCaseFields: ["certifierName", "certifierFax"]` |
| 0 and 1 | 5 "Time of death" | add `valueKind: "time"` (*recommended, separate fix*) |

Nothing else changes: labels, stages, SLA targets (including the admin's v6 change of 4 → 5 days) and intake are all the same as v6.

The `valueKind` line restores the 12-hour Time of Death editor. v6 lost it to the same mapper defect that dropped `requiredCaseFields`, and that defect is now fixed. It is independent of the fax change. To publish the fax change alone, remove the two `"valueKind": "time"` lines.

## How to apply it (once approved)

Use the app's own endpoint, not a raw Wix write. It checks the `workflow.publish` permission, validates the payload, and appends a version. It never edits an existing one.

```
POST /api/workflow-templates/workflow-template-standard-cremation/versions
Body: docs/proposals/manors-certifier-fax-v7.payload.json
```

This must be sent with a signed-in Manors administrator's session, because the route resolves the organization from the session. The payload has been validated locally with `validateWorkflowStagesPayload` and `validateIntakeTemplatePayload`, with no errors.

## After publishing, verify

1. Settings → Workflow Editor shows version 7. Certifier Information reads "Completed by: Certifier name + Certifier fax".
2. A new test case shows **Certifier fax** in the checklist, and the item stays incomplete until a fax is entered.
3. An existing case, such as B2026-039, still shows Certifier name + phone and keeps its progress.

## Rollback

Versions are append-only. To undo, publish a v8 equal to v6 (without the fax requirement). Cases created under v7 keep v7's rule, which is how every version change already works.
