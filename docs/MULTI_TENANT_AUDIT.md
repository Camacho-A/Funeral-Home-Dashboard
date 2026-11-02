# Multi-tenant hardcoding & configuration audit (2026-11-01)

Branch `feat/price-catalog` (contains the shared-platform, Gus parity and
price-catalog work; 1753668 = master is an ancestor). Read-only audit of the
whole application plus the fixes listed in §6. Nothing live was changed: no
Wix writes, no Vercel setting changes, no deploy, no merge.

## 1. Priority summary

### Launch blockers (before one shared Production release)

| # | Blocker | Why | Approval |
|---|---|---|---|
| B1 | **Vercel projects are not independent.** `manors-cremation-dashboard` (Manors Production), `manors-solis-sandbox` and `gus-solis-sandbox` are all git-connected to `Camacho-A/Funeral-Home-Dashboard` with production branch `master` and no ignored-build step. | One merge to master redeploys Manors Production **and** both sandboxes; every pushed branch builds a preview in all three. Manors' previews carry live Wix, Resend, Twilio and Clover-sandbox credentials. There is no Gus Production project yet. | Vercel settings — needs approval |
| B2 | **Order versioning reaches Manors with the release.** The Gus parity work (on this branch line) changes Manors order writes: `expectedOrderId` is required (428/409), an interrupted order change locks the order and stops "paid in full" until an administrator repair — and the repair is **API-only, no screen**. | Fixes two real Production risks (double active orders; no active order after a crash) but changes Manors behaviour and needs an operator path. | Manors regression walkthrough + repair UI or runbook |
| B3 | **Gus cannot run live yet.** No live Gus Organization record / roles / catalog (onboarding not run), price-catalog schema not created (live catalog item writes answer 501), no Gus Production project, integrations deliberately off. | Gus's code configuration is complete; its live data and deployment are not. | Schema approval (docs/PRICE_CATALOG.md §4) + Gus onboarding approval + B1 |
| B4 | **JotForm reads for SSN, Manatee and the crematory package use the default (Manors) API key** (`services/caseSsnService.ts:156`, `services/manateeApplicationService.ts:127`, `services/crematory/crematoryPackageService.ts:127-131`). | The moment Gus connects its own JotForm account those reads silently return nothing (or read the wrong account). Blocker only for **enabling Gus JotForm**; harmless while it is off. | Verify live config rows' `apiKeyReference` first |
| B5 | **MFA enrollment gap (medium security).** `app/login/actions.ts:197-205` issues the full session before the "enroll MFA" redirect; org-scoped APIs don't check `identityMustEnrollMfa`. | For an organization that requires MFA, a stolen password of a not-yet-enrolled member gets API access. Blocker if any live organization requires MFA. | Auth change — needs approval |

### Financial-integrity decision before release (not introduced by sharing)

Manors' existing pricing (docs/PRICE_CATALOG.md §5.2): any order edit
re-prices **every** line at current prices with no itemized audit; deactivating
a service drops it on the next edit; a total reduced below the amount paid
shows $0 with no credit/refund prompt (shared engine — applies to Gus too).
The two High risks (double active orders, no active order after a crash) are
**fixed by this branch** — shipping it reduces Manors' risk. Recommendation:
release with Manors' re-pricing unchanged (as decided) but decide the
overpayment handling before Gus takes payments.

### Can safely wait (improvements)

See §3 "Hardcoded — correct later" and §5. None blocks Manors + Gus on one
codebase.

## 2. Already tenant-configurable

- **Session-derived organization**: `requireAuthorizedOrganization` re-validates the session and grants only when the caller's server-side membership row matches the requested organization; the returned `organizationId` comes from the membership. No platform-admin bypass. `DEPLOYMENT_ORGANIZATION_IDS` enforced and fail-closed in production.
- **All 344 API handlers in 273 route files are gated** (now enforced by `app/api/routeAuthGates.test.ts`); none uses the client organizationId after auth; no route defaults to a funeral home.
- **Storage isolation**: every Wix read is a filtered query (no raw get-by-_id); blob keys `${org}/${case}/…`; case sequences `${org}-${year}`.
- **Webhooks**: Clover resolves the organization from the stored payment and checks that organization's own secret + merchant; JotForm resolves from the registered form config (ambiguous → 409) and re-fetches the submission with that config's key.
- **Identity & branding**: sign-in branding by host map / login org (now deployment-checked); sidebar name/logo from the Organization and Branding records; record name/legal name/prefix override the profile.
- **Case numbering**: prefix record → profile (B Manors, M Gus); independent sequence per organization and year; org-timezone year.
- **Workflows**: per-template selection, approval, stage names, completion policies; Gus's three services on the shared foundation.
- **Pricing**: per-organization catalog rows, permission model, line-price lock, catalog management; starter catalog without prices.
- **Integrations**: JotForm bindings per (org, form); Clover per-org integration rows; crematory recipients, mailbox and email name per organization; Gus sending off.
- **Feature gates**: DYMO label, Manatee application, page extracts, SSN, SLA, family portal, signatures, hidden modules (server-enforced for Gus).

## 3. Hardcoded — corrected now / correct later

### Corrected on this branch (§6)

| Item | Was | Now |
|---|---|---|
| Stage lists for any home without service workflows | Manors' fixed 7 stages on Dashboard, Cases filter, counts, Reports, activity, portal, bulk advance | `features.stagesFromWorkflowTemplates` (default on; **Manors off** = unchanged); the home's own template stages |
| `useOrganization` default | Manors' id (imported from mocks) | empty — fails closed |
| Login branding | host map could show a home the deployment doesn't serve | deployment allowlist checked |
| Demo / sandbox sign-in hints | a third home's sandbox listed Manors accounts | none for an unknown home |
| New case number for a home with no prefix | silently `B…` (Manors) | refused 409 `case_number_prefix_not_configured`; Manors keeps B |
| Official documents (Envelope, Certificate) | org-id map in shared code | `features.officialDocuments` (Manors only) |
| Clover credential references | any env var name (could exfiltrate e.g. `WIX_API_KEY` to Clover) | only `CLOVER_…` names, at onboarding and at read time |
| `.env.example` `NEXT_PUBLIC_DEFAULT_ORGANIZATION_ID` | "the single value used" | marked retired (no code reads it) |

### Correct later (safe, not blocking)

| File | Hardcoded | Impact | Correction |
|---|---|---|---|
| `domain/onboarding/starterServiceCatalog.ts:37-50` | generic starter = Manors' service set (no prices); Gus catalog chosen by org id | new homes start with Direct Cremation + weight tiers | starter choice in profile/onboarding input; empty generic starter (decision) |
| `domain/pricing/serviceCodes.ts`, `calculateOrder.ts:349-384` | Manors service codes drive base/weight/add-on charges | other homes depend on code collisions | pricing role from catalog data, Manors codes as aliases (**approval**: touches Manors recalculation) |
| `services/cremationLabelService.ts:87`, `domain/labels/manorsLabel.ts` | one DYMO template (Manors address) | enabling labels elsewhere prints Manors | `labelTemplateKey` per profile |
| `services/officialDocumentTemplates.ts:73` | `manors-envelope.pdf` | Manors-only feature | per-org template key |
| Certificate / Manatee template env keys | single global templates (Manors signature/seal) | must never be enabled for another home | per-org template keys before any second home |
| `services/caseSsnService.ts:56-59`, `manateeApplicationService.ts:77-81` | Manors form ids → qids | features unusable elsewhere | qids on the form layout |
| `domain/documents/arrangementPageExtracts.ts:26-34` | Manors page order | Manors-only feature | page map on the layout |
| `lib/email/resendClient.ts:97-105` | sender always "SOLIS"; profile `notifications.senderDisplayName` / branding `emailFromName` unused | all homes' families see "SOLIS" | read per-org sender (**approval** for Manors: deliverability) |
| `types/organizationBranding.ts:25-27` | colours stored, never applied | cosmetic | CSS variables when set |
| `billingDocumentService.ts:79-83` | record-driven statements have no logo/fax/email | Gus statements plainer | Branding logo fallback |
| `domain/cases/checklist.ts:29-42` | foundation step wording is Manors' | Gus sees Manors wording | per-org step labels by step id |
| `organizationProfiles.ts:609` + `crematoryPackageService.ts:280` | crematory authorization stage by **position** (2) | a stage-inserting extension would read the wrong stage | `authorizationStageKey` with number fallback |
| `services/pricingService.ts:851-853` | tax and discount always 0 | homes that tax merchandise can't | per-org tax (**approval**, financial) |
| `lib/icsService.ts:80` | `@beacon.app` UIDs | cosmetic | `APP_BASE_URL` (**approval**: re-identifies sent invites) |
| Duplicated `'managed-cremations'` literals (`hooks/useCaseNumbering.ts:14`, `formRegistry.ts:102`, cutover/seed routes, `lib/manorsRbacMigrationClient.ts:15`) | Manors-only gates | none | import the one profile constant |

## 4. Shared platform logic that stays shared

Product brand (SOLIS mark, favicon, "Powered by SOLIS"); session cookies;
middleware; the authorization path; the case-number sequence mechanics and
format; the cremation foundation, composition, step ids, checklist
automation; the pricing engine core and unpriced refusal; the price-history
journal; merchandise categories; RBAC role structure; one Resend domain, one
Twilio account, one Microsoft app registration (per-org mailboxes/tokens);
Blob storage; PDF route lists; FTC disclosures from each home's own catalog.

## 5. Legacy Manors behaviour under compatibility protection

Fixed stage list + intake combination (`stagesFromWorkflowTemplates: false`);
position/label fallbacks for pre-step-id Manors cases; ME verified item;
letterhead, legal name, receipt footer, phone/fax/email and logo in code;
legacy JotForm bindings and `{formId}.pdf` names; absent
`authorizationDocumentSource` = arrangement form page; absent `sendingEnabled`
= sending allowed; global Certificate/Manatee templates; `legacy` pricing, no
line lock, no catalog management; DYMO label; cremains pickup; VA key
`'manors'`; Manors-only cutover and case-numbering migration routes (gated by
org id and deployment); the reserved onboarding id `managed-cremations`.

## 6. High-risk changes requiring separate approval

- **Vercel**: separate production branches / ignored-build steps per project; strip live credentials from Manors Preview or restrict previews; create a Gus Production project with its own env (B1).
- **Onboarding `clone_existing`** can copy another tenant's workflow if its template id is known (`services/organizationProvisioningService.ts:939-972`). Restricting it to own/platform templates disables the mode for new homes — left unchanged, needs a decision.
- **Shared default-role policy**: `defaultRoles.ts` encodes Manors' tuning as the platform default; org-scoped top-up only adds grants. A home with a different role model needs per-org role data.
- **Manors case-numbering migration** writes the shared default-role rows (`roleService.ts:586-610`); already ran live (Administrator holds `caseNumber.manage`).
- **MFA enrollment gate** (B5); **calendar OAuth callbacks** don't re-check membership; **by-id lookups without an org filter** (callers re-check today); `permissionService` role lookup by key only (fails closed).
- Moving Manors' letterhead into records; per-org sender; Manors re-pricing behaviour; tax; JotForm `apiKeyReference` / `mappingKey` backfill on live rows; any Gus integration activation; price-catalog schema (docs/PRICE_CATALOG.md).

## 7. Verification

- `services/threeTenantConfiguration.test.ts` — Manors, Gus and a fictional third home (`evergreen-memorial-group`, own name/legal name/prefix `EVG`, own catalog, own burial workflow): identity, Statement/Receipt identity, independent prefixes and sequences, catalog isolation, pricing defaults, stage lists, official documents, labels/Manatee/extracts off, crematory sending, role overrides — no home sees another's identity or configuration.
- `app/api/routeAuthGates.test.ts` — every route has an approved gate or a listed public reason; no route references a default funeral home.
- Cross-organization route tests: price-history list/report/repair refused for another organization (new); existing suites cover cases, orders, payments, documents, workflow templates, catalog, role overrides, case numbering.
- Full suite 9,841 passed (2 skipped); typecheck, lint (changed files) and `next build` clean.
