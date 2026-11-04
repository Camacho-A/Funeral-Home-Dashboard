# JotForm credential isolation & safe workflow cloning (2026-11)

Branch `feat/p5-clone-jotform` (from `feat/price-catalog` 4537a06). No live
change: no Wix writes, no env/Vercel change, no Gus integration enabled.

## JotForm reads

The three read-backs that used the default key — SSN capture
(`services/caseSsnService.ts`), the Manatee application
(`services/manateeApplicationService.ts`) and the Crematory Package name
(`services/crematory/crematoryPackageService.ts`) — now resolve their key
with `services/externalForms/jotformReadCredentials.ts`:

| Situation | Result |
|---|---|
| Submission belongs to another organization | nothing read |
| The organization's one enabled row for the form names `JOTFORM_API_KEY_<SUFFIX>` | that key |
| Manors (`features.jotformLegacyDefaultApiKey: true`), row without a reference, no row, or several rows | `JOTFORM_API_KEY` — exactly as before |
| Any other home: no row, several rows, no reference, a non-JotForm name, or `JOTFORM_API_KEY` itself | nothing read (fails closed) |

Only env var NAMES are handled; the key value stays inside
`lib/jotform/jotformClient.ts` and is never logged or returned. Provider
errors are swallowed without their text, as before.

Not changed here: the webhook, case-import and historical-import paths
still use a row's `apiKeyReference` or the default key. They resolve the
row by form id first (ambiguous → refused), so a Gus form only reaches the
default key if its own row omits a reference — covered by the checklist
below; tightening them is a follow-up.

### Before enabling Gus JotForm (live, needs approval)

1. Every enabled Gus `externalFormConfigs` row names `JOTFORM_API_KEY_GUS`
   (or another suffixed name) in `apiKeyReference` — none blank.
2. `JOTFORM_API_KEY_GUS` is set in the Gus project's environment only
   (never in the Manors project).
3. No Gus form id is also enabled for Manors (the webhook refuses
   ambiguous form ids).
4. Manors rows: leave as they are; confirm none names a Gus key.

## Workflow cloning (`clone_existing`)

Sources are only:

- **Platform templates** registered in code
  (`domain/onboarding/workflowCloneSources.ts`: `platform-standard-cremation`,
  `platform-minimal`) — approved by shipping with SOLIS, owned by no home;
- a template the organization being set up **already owns**.

Another home's template is refused with the same 404 and message as a
missing one. The copy is rebuilt from a field allowlist (stage, checklist
item and intake field structure); never copied: integration bindings
(`externalFormIntegrationId`), default values, payment amounts and
descriptions, or any field not yet listed. An audit entry
`workflow_provisioned` records the actor, mode and source. The onboarding
screen now offers a choice of platform templates instead of a free-text id.

Cloning across homes on purpose (a home publishing its template to others)
would need an explicit "shared" flag on the template — a Wix schema change,
not made here.
