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

## Ported from the Gus repository (2026-11, branch feat/gus-parity-port)

- Non-destructive order versioning, journaled order operations and their
  administrator repair (docs/ORDER_VERSIONING.md) — every organization.
- Unpriced service-type catalog items ("Price not set"; an order with one is
  refused) and Settings › Services & Pricing (profile
  `priceCatalogManagement`; off for Manors).
- Archive/restore refreshes after a revision conflict (the rest of Gus's
  case-revision contract was already here).
- Hidden modules enforced on the server (`enforceHiddenModulesServerSide`).
- Workflow drafts and approval (`workflowApprovalRequired`), the structural
  workflow editor (only where approval is required; Manors keeps its
  editor), completion policies and manual completion, changing a case's
  service, per-template stage lists and reports.
- Organization settings instead of code: certifier fields
  (`certifierRequiredCaseFields`), stage names (`cremationStageLabels`), the
  crematory authorization document source
  (`sendToCrematory.authorizationDocumentSource`).

## Not yet ported

1. The administrator price catalog (Gus f3a09c6, 3042bf0): categories,
   catalog items, FTC classification, deactivation, inventory links,
   custom-item permission, order-line price snapshots. Needs new Wix
   collections/fields (Gus runs it on demo data only; live writes answer
   501) and changes Manors permissions and order re-pricing, so it waits for
   a schema and business decision.
2. Gus's Redis demo store: not needed — the shared sandbox keeps its own
   persistence (browser store + server mock).
3. Gus onboarding plan / deployment readiness tooling and the separate staff
   login gate (lib/auth/deploymentLoginAccess.ts) — the login gate changes
   who can sign in to Manors and needs review first.
