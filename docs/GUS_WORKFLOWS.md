# Gus Camacho Jr. — service workflows

Each of Gus's six service types has its own workflow template. The service
chosen on a case decides which stages and checklist the case follows. This
applies only to `gus-camacho-jr`. Its profile turns on two features:
`workflowByServiceType` and `workflowApprovalRequired`. Manors and the test
organization keep "first enabled template", unchanged.

The definitions are in `domain/workflow/gusServiceWorkflows.ts`. Both the
local mock fixtures and live onboarding are built from that file.

## Workflows

| Service | Status | Stages (checklist items) |
|---|---|---|
| Direct Cremation | **Approved** | 1. First Call & Payment (11) · 2. JotForm Application (1) · 3. EDRS & Doctor / Cause of Death (3) · 4. Permit & Authorization Sent to Crematory (2) · 5. Death Certificate Application Sent (2) · 6. Ready for Pickup / Contact Family (6) · 7. Completed (1) |
| Cremation with Final Goodbye | **Draft — requires approval** | Copy of Direct Cremation (starting point only) |
| Cremation with Viewing | **Draft — requires approval** | Copy of Direct Cremation (starting point only) |
| Graveside Burial Service Only (No Viewing) | **Draft — requires approval** | Copy of Direct Cremation (starting point only) |
| U.S. Veterans, Graveside Burial Service Only (No Viewing) | **Draft — requires approval** | Copy of Direct Cremation (starting point only) |
| Direct Entombment (Embalming Required) | **Draft — requires approval** | Copy of Direct Cremation (starting point only) |

First Call & Payment and JotForm Application are always separate stages. Gus
never shows "Intake & JotForm"; that combined label is a Manors display
setting.

Direct Cremation uses the same stage numbering and checklist items as the
cremation workflow Gus started from. Only the stage names changed, to the names
the funeral home supplied. Every completion rule that depends on an item's
label still works.

## What needs approval

The stages for the other five services have not been supplied. Their drafts
are only an editable starting point. Crematory stages (permit and authorization
to the crematory, ashes pickup) probably do not apply to burial or entombment.
Before cases can use one of these services, an administrator must:

1. Open Settings › Workflow Templates and select the service.
2. Correct the stages and checklist, then save. Saving creates a new **draft**
   version.
3. Click **Approve version N**, then **Confirm approval**.

Until then, New Case shows this message and the Create button stays disabled:

> The workflow for *Service* has not been approved yet. An administrator must
> review and approve it in Settings › Workflow Templates before cases can use
> it.

The server refuses the same request with HTTP 422.

## How it works

- **Creating a case.** The selected service picks the one enabled template
  whose `serviceTypeCodes` contains that service. The case gets that
  template's latest **approved** version, and the service type is stored on
  the case's workflow snapshot. If no service is chosen, the service has no
  template, its template is still a draft, or two templates claim the same
  service, case creation is refused. SOLIS never guesses a workflow. The rule
  lives in `domain/workflow/selectWorkflowTemplate.ts` and every creation path
  uses it.
- **Form intake and historical import.** A JotForm submission does not name a
  service, so for Gus it does not create a case automatically. The submission
  stays **unmatched** in Unmatched Forms. Staff then create the case from New
  Case, choosing the service, and link the submission there.
- **Editing a workflow.** Saving in Settings always creates a new version.
  For Gus that version is a draft. New cases keep using the latest approved
  version until the draft is approved. Existing cases never change.
- **Changing a case's service.** In Edit Services, choosing another service
  first shows a confirmation. It lists the completed steps that carry over, the
  completed steps that do not, the new requirements (which start unchecked)
  and the stage the case will land on. It warns when that stage is earlier than
  the current one. Nothing changes until staff click **Confirm workflow
  change**. The previous workflow and all its progress are appended to the
  case's `workflowHistory`, and a `case.workflow.changed` activity event is
  recorded. The route is `POST /api/cases/[caseId]/workflow` and requires
  `case.update`.
- **Dashboard, Cases list and Reports.** Stages are grouped by name across
  the approved workflows. Each case is counted by its own workflow template
  and raw stage, so the same raw-stage number on two different workflows never
  gets mixed up.

## Admin configuration gaps

The editor can rename stages and checklist items, reorder stages, and change
SLA, attention flags and intake fields. It **cannot** yet add or remove stages
or checklist items, create a template, rename a template, or change which
service a template serves. Defining a burial or entombment workflow that needs
different stages therefore still requires a developer to prepare the version
data. Approving it is a normal Settings action.

## Migration

None is required. Gus has not been onboarded to live Beacon, so no Gus case
exists there. If a Gus case had been saved earlier with the single starter
template, it keeps its own snapshot and progress. The case detail page shows
the service as "Not recorded". To move such a case onto a service workflow,
use the service-change flow above, which shows the confirmation and records
history.
