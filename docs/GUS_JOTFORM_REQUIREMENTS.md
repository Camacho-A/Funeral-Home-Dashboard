# Gus JotForm — what is needed before it can be connected (2026-11)

Nothing for Gus is connected. No Gus form id, mapping or key exists in SOLIS
or in Vercel. Nothing below is guessed; each item is something Gus (or its
JotForm account) must supply, then each connection step is its own approval.

## How SOLIS uses a home's forms (from the Manors setup)

Manors has three registered layouts (`domain/externalForms/formRegistry.ts`):

| Manors layout | Purpose | Creates a case? |
|---|---|---|
| First Call Sheet | intake from the first call | yes (`case_create`) |
| Arrangement Forms | arrangement details, NOK/informant, certifier; its PDF page 3 is Manors' cremation authorization | yes / attaches |
| Vital Statistics | death-certificate details | attaches to a case |

Gus's workflow already names a "JotForm Application" stage
(`cremationStageLabels`), but Gus's own forms have not been provided.

## Needed from Gus

1. **The list of Gus JotForm forms** in use (name, purpose, and whether each should open a case or attach to one). JotForm form ids for each.
2. **A JotForm API key for Gus's own account** — to be stored only in the `gus-solis` project as `JOTFORM_API_KEY_GUS_CAMACHO_JR` (never in Manors). Every Gus form row must name it; SOLIS now refuses to read a non-Manors form with no key of its own (`jotformOptionsForConfig`).
3. **For each form, the field list** (or the form definition export) so each SOLIS case field is mapped to the right question id. Fields SOLIS can fill today: decedent name (first/middle/last), date of birth, date/time and place of death, weight, veteran, next of kin (name, relationship, phone, email), informant/legal NOK, certifier (name, phone, license, fax — Gus requires name and fax), pickup released-to.
4. **Which form, if any, is Gus's cremation authorization document** — or that it comes from elsewhere (uploaded, signed in person). Send to Crematory cannot build a Gus package until this is set (`authorizationDocumentSource: 'not_configured'`).
5. **Whether a link token (hidden field) is used** so a submission matches an existing case, and whether webhook authentication fields exist.
6. **The PDF behavior**: should the populated PDF be stored on the case, and under which document type?
7. **SSN**: Gus has case SSN off. If any form collects an SSN, confirm it must NOT be stored (today it would not be read).
8. **A test submission plan**: a Gus-owned test form or sandbox submissions with fictional data only.

## SOLIS work once supplied (each step approved)

1. Add Gus layouts to the registry (mapping keys, field maps) — code, tested with fictional submissions.
2. Create Gus `externalFormConfigs` rows (organization `gus-camacho-jr`, `apiKeyReference: JOTFORM_API_KEY_GUS_CAMACHO_JR`, `mappingKey`) — **live Wix write** [approval].
3. Set the key in `gus-solis` only [approval]; point the JotForm webhooks at the Gus deployment [approval].
4. Confirm no Gus form id is also enabled for Manors (the webhook refuses ambiguous form ids).
