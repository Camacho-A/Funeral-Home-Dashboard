# One SOLIS, configured per funeral home

SOLIS is one codebase (this repository) serving every funeral home from one
Beacon Wix backend. Each funeral home is an organization with its own data,
case numbers, staff, roles, settings and integrations. Nothing in shared
code should name a specific funeral home's business rule.

## Where each kind of difference lives

| Difference | Where | Examples |
|---|---|---|
| Identity, contact details, legal name | the Organization record (onboarding) | Statement and Receipt letterhead |
| Logo and colors | Settings › Branding (Organization branding record) | sign-in page, sidebar |
| Behaviour switches | `domain/organization/organizationProfiles.ts` (`features`) | Family Portal, hidden modules, SLA, Send to Crematory, service-based workflows |
| Services offered and their workflows | workflow templates (one per service when `workflowByServiceType`) | Direct Cremation, Cremation with Viewing |
| Recipients, mailboxes, form bindings, payment accounts | per-organization settings records and env-referenced credentials | crematory recipients, JotForm form bindings |

## Workflows: a shared foundation plus service extensions

`domain/workflow/cremationFoundation.ts` is the one definition of the
cremation process. It is built from the same constants as the Manors
template, and `cremationFoundation.test.ts` proves it is the Manors process,
item for item. Every stage and item carries a stable `stageKey` / `stepId`.

A service is the foundation plus extensions (`domain/workflow/workflowComposition.ts`,
`domain/workflow/serviceWorkflows.ts`):

- Direct Cremation = foundation
- Cremation with Viewing = foundation + `service.viewing`
- Cremation with Final Goodbye = foundation + `service.final_goodbye`

Extensions only add items to a stage or insert a new stage; they never
remove, rename or reorder a foundation step. The result is flattened into an
ordinary template version, so the checklist engine and every case snapshot
work exactly as before. Viewing and Final Goodbye have no steps yet
(`stepsToBeDefined: true`); adding them later is a new extension version.

Shared logic that needs a particular step finds it by `stepId`
(`domain/workflow/workflowSteps.ts`), falling back to the old position-and-
label check for snapshots created before step ids existed (every existing
Manors case). Storage keys are unchanged (`"{displayStage}:{index}"`).

Organization choices inside the foundation are options, not copies: how the
arrangement form is fulfilled (an external form integration or staff
confirmation) and which fields complete Certifier Information.

## Customization levels

1. **Standard configuration**: services offered, branding, hidden modules,
   recipients, staff and roles. Done by an administrator or at onboarding.
2. **Advanced workflow configuration**: service extensions and
   organization-specific steps. Defined as data on top of the foundation,
   never by editing the foundation.
3. **Custom integration or development**: a new form provider, document
   template or external system. Built as a provider-neutral capability with
   the organization's own binding.

Fixed for everyone: tenant isolation, authorization, audit history,
financial integrity, and the duplicate-send protection of Send to Crematory.

## Live actions stay off until configured

Send to Crematory can be offered with `sendingEnabled: false`: staff can
prepare and review packages, and the server refuses to email anyone
(`services/crematory/crematorySendService.ts`).

## Not yet on the shared codebase (from the Gus repository)

These Gus-only features still live in the separate Gus repository and need
porting, in this order (shared fixes first):

1. Order versioning and the order operation journal (also a Manors data-integrity fix).
2. Full case-revision enforcement differences.
3. Hidden modules enforced on the server.
4. Unpriced service-type catalog items ("Price not set").
5. Workflow version drafts and approval.
6. Completion policies and manual completion.
7. Changing a case's service (workflow remap, coordinated order change).
8. The administrator price catalog (needs Wix schema decisions first).
9. The shared demo store for hosted demos.
