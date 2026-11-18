# Gus Camacho Jr. — Wix-connected deployment environment (Phase 5I, 2026-11-18)

**Plan only. No deployment, project or variable was created or changed.**
Inspection was read-only (Vercel variable NAMES and targets; no values).

## Where things stand

| Vercel project | Purpose | Data | Live credentials |
|---|---|---|---|
| `manors-cremation-dashboard` | Manors Production | live Wix | yes — does **not** set `SOLIS_FD_CREDENTIALS_STORAGE`, so live credential storage is off there |
| `manors-solis-sandbox` | Manors fictional sandbox | mock | none (9 variables, no `WIX_*`) |
| `gus-solis-sandbox` | Gus fictional sandbox | mock | none (9 variables, no `WIX_*`) |
| `gus-solis-preview` | legacy Gus repo demo | demo KV store | none — left untouched |

No Gus Production project exists. Both fictional sandboxes refuse to start
if `DATA_ADAPTER` is not `mock` or any `WIX_*` (or other live credential)
variable is set (`lib/sandbox.ts`, checked at startup by `instrumentation.ts`).

The intended shape (docs/VERCEL_DEPLOYMENT_ISOLATION.md): a NEW project
`gus-solis`, Production branch `release/gus`, Ignored Build Step
(`SOLIS_BUILD_BRANCHES=release/gus`), no Previews, Vercel Authentication on
non-custom domains.

## Variables for `gus-solis` (Production target only)

Gus's own values unless stated — never copied from Manors, so a Manors
session or cron secret can never work on Gus and vice versa.

### Required

| Variable | Value | Why |
|---|---|---|
| `DATA_ADAPTER` | `wix` | real data |
| `AUTH_ADAPTER` | `identity` | SOLIS accounts |
| `WIX_SITE_ID`, `WIX_API_KEY` | the shared Beacon site's (same site as Manors) | the shared backend |
| `DEPLOYMENT_ORGANIZATION_IDS` | `gus-camacho-jr` | this deployment serves ONLY Gus; production on Wix fails closed without it (`lib/env.ts`) |
| `LOGIN_ORGANIZATION_ID` | `gus-camacho-jr` | sign-in organization |
| `LOGIN_ORGANIZATION_HOSTS` | Gus's custom domain | host → organization |
| `APP_BASE_URL` (and `NEXT_PUBLIC_APP_URL`) | Gus's URL | links |
| `SESSION_JWT_SECRET` | new, Gus-only | sessions |
| `MFA_ENCRYPTION_KEY` | new, Gus-only | MFA secrets |
| `CRON_SECRET` | new, Gus-only | scheduled jobs (they process only `DEPLOYMENT_ORGANIZATION_IDS`) |
| `BLOB_READ_WRITE_TOKEN`, `BLOB_STORE_ID` (and branding pair) | a Gus-only Blob store | documents and logos |

### Funeral director credentials — only when approved

| Variable | Value | Effect |
|---|---|---|
| `SOLIS_FD_CREDENTIALS_STORAGE` | `wix` | turns on live reads/writes of the `funeralDirectorCredentials` collection (`services/funeralDirectorCredentialSwitch.ts`). Also requires `DATA_ADAPTER=wix` and the organization profile's `funeralDirectorCredentials` (Gus only). Unset = off |

### Leave unset at first (features off for Gus today)

`RESEND_*` (email), `TWILIO_*` (SMS), `MICROSOFT_*` (Outlook — crematory
sending is off), `GOOGLE_*` (calendar), `JOTFORM_API_KEY_GUS_CAMACHO_JR`
(until Gus's JotForm is connected), `SSN_ENCRYPTION_KEY` (case SSN is off for
Gus), Manors' certificate/Manatee template keys, `CLOVER_*`,
`NEXT_PUBLIC_SOLIS_SANDBOX` (must NOT be set on a live deployment).

## Switches that are code constants (each a separate approved change)

| Switch | File | Today |
|---|---|---|
| Service preparation saves on live Wix | `services/servicePreparationStorage.ts` (`SERVICE_PREPARATION_WIX_FIELD_ADDED`) | `false` |
| ME cremation approval saves on live Wix | `services/medicalExaminerApprovalService.ts` (`MEDICAL_EXAMINER_APPROVAL_LIVE_SAVING`) | `false` |
| Release for cremation | `domain/servicePreparation/releaseForCremation.ts` (`RELEASE_FOR_CREMATION_AVAILABLE`) | `false` |
| Crematory email sending (Gus) | organization profile `sendToCrematory.sendingEnabled` | `false` |
