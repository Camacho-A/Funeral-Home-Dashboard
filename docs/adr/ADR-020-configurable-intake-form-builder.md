# ADR-020: Configurable Intake Form Builder

**Status:** Accepted
**Date:** 2026-07-23

## Context

Phase 18 (ADR-019) gave admins a real editor for a workflow's *stages*, but the New Case intake form itself was still effectively hardcoded: `components/modals/NewCaseModal.tsx` rendered `IntakeFieldTemplate`s generically in structure, but every per-field *behavior* — which fields uppercase, which mask, which get a date/expiration mask, which get validated and how — was a set of hardcoded literal-key lookups (`UPPERCASE_FIELD_KEYS`, `DATE_FIELD_KEYS`, `EXPIRY_FIELD_KEYS`) that only ever matched Managed Cremations' own field names. This phase moves all of that into the `IntakeFieldTemplate` data model itself, so any organization's own intake fields behave correctly with zero component changes.

## Architecture reviewed

- **New Case implementation** (`components/modals/NewCaseModal.tsx`): confirmed the exact hardcoded-by-key-name pattern above, and that `domain/workflow/resolveIntake.ts`'s `buildIntakeFieldValues`/`buildStructuredCaseFields` already generalize correctly — they only ever read `key`/`checklistItemIndex`/`mapsToCaseField`, untouched by anything this phase needed to add.
- **`WorkflowTemplate`/`WorkflowTemplateVersion`/`StageTemplate`/`ChecklistItemTemplate`** (`types/workflowTemplate.ts`): unchanged by this phase except `IntakeFieldTemplate` itself (see Decision below) — versioning, stage structure, and checklist structure are exactly as ADR-019 left them.
- **How templates load/version**: `lib/wixWorkflowTemplateMapper.ts` treats `intake` as opaque JSON already (`mapWixWorkflowTemplateVersionItem`'s own comment: "does NOT deep-validate field-by-field... passed through as-is") — meaning **no Wix collection or schema change was needed**; every new `IntakeFieldTemplate` property just rides along inside the existing `workflowTemplateVersions.intake` JSON column.
- **ADR-019 / current Workflow Editor** (`components/settings/WorkflowEditor.tsx`): edits `stages` only, always carrying `intake` over unchanged from the latest version, and has no add/delete capability at all (edit-existing-only). This phase extends both: intake becomes editable (including add/delete/reorder, genuinely new CRUD), and both `stages` and `intake` are now submitted together as one version.

## Decision

### Model (`types/workflowTemplate.ts`)

Every new `IntakeFieldTemplate` property is **optional**: `fieldType`, `required`, `defaultValue`, `displayOrder`, `uppercase`, `masked`, `multiline`, `validationType`, `options`. This is the load-bearing backward-compatibility mechanism — every field that predates this phase (the mock fixture, and the real, already-created Wix `workflowTemplateVersions` row) remains a fully valid value of the type with zero migration. `domain/workflow/resolveIntakeField.ts`'s `resolveIntakeField` is the **single** place defaults get filled in (`fieldType ?? 'text'`, `masked ?? password ?? false`, `displayOrder ?? arrayIndex`, etc.) — both `NewCaseModal` and the Workflow Editor's intake sub-editor call it, so neither re-derives its own fallback logic.

Two deliberate naming decisions, both to avoid unnecessary churn on already-established names:
- **`key` satisfies "id"** — it was already the field's stable identifier (draft-state key, `mapsToCaseField`/`checklistItemIndex` join key); no second id field was added.
- **`password` (legacy) and `masked` (new) coexist** — `resolveIntakeField` reads `masked ?? password`, so the two existing password-flagged fields (`cardNumber`, `cardCvv`) keep masking correctly without their stored data ever being touched, while new/edited fields use the preferred `masked` name going forward.

`multiline` mirrors `fieldType === 'textarea'` exactly — kept as its own named property (Phase 19's own schema names it) but not independently settable in the Workflow Editor, since `fieldType: 'text', multiline: true` would be a contradictory state with no defined rendering.

### Validation (`utils/inputMask.ts`)

Added `isValidEmail`, `isValidPhoneNumber`, `isValidZip`, `isValidNumeric`, `isValidCurrencyAmount`, `isValidCreditCardNumber` (a real Luhn checksum, not just a length check) — all generic, domain-independent, following the exact "empty string is valid" convention `isValidCalendarDate`/`isValidExpiryMonth` already established. A new dispatcher, `getValidationError(validationType, value)`, replaces `NewCaseModal`'s old hardcoded `fieldValidationError` — it's the one place an `IntakeValidationType` maps to a validator and a message.

### New Case (`NewCaseModal.tsx`)

`renderIntakeField` switches purely on a field's *resolved* properties — `fieldType` selects the control (text/textarea/date/time/phone/email/number/currency/checkbox/select/creditCard/expiration/cvv all render correctly; select uses `options`, checkbox stores `'true'`/`''` in the same `Record<string,string>` draft state every other field already uses), `uppercase`/`masked`/`validationType` drive behavior — never `field.key`. `required` is now a generic gate over every resolved field, not a `decedentName`-only special case — though **`decedentName` is the only field the mock fixture actually marks `required: true`**, preserving the exact pre-Phase-19 `canSubmit` behavior rather than opportunistically tightening validation on `nextOfKinName`/`nextOfKinPhone` (which were never actually enforced despite `NewCaseInput`'s type marking them non-optional).

### Workflow Editor (`components/settings/WorkflowEditor.tsx`)

A new "Intake form fields" panel per section: edit label/fieldType/placeholder/validationType/required/uppercase/masked, an options editor (comma-separated, shown only for `fieldType: 'select'`), move up/down (`domain/workflow/editing.ts`'s new `moveIntakeField`, the same swap-and-renumber pattern as `moveStage`, scoped to `displayOrder` within one section), add (`generateUniqueFieldKey` guarantees no collision with any existing key across the whole intake), and delete. Both `stages` and `intake` drafts are held locally and submitted **together** in one `Save as new version` — one `WorkflowTemplateVersion` is one cohesive snapshot, matching how `buildCaseWorkflowSnapshot` has always cloned both at once.

### Endpoint (`POST /api/workflow-templates/[templateId]/versions`)

Extended (not replaced) from ADR-019: the body now requires both `stages` and `intake`. `lib/wixWorkflowTemplateMapper.ts`'s new `validateIntakeTemplatePayload` is the DTO/shape layer (deep-validates the untrusted JSON body — every Phase 19 property checked for the right type *if present*, matching `IntakeFieldTemplate`'s all-optional shape). `domain/workflow/editing.ts`'s new `validateIntakeFields` is the business-rule layer, run after shape validation passes: every field `key` must be globally unique across the whole intake (the New Case form's draft state is keyed by it — a collision would silently merge two fields' values), every label non-empty, `fieldType`/`validationType` (when present) must be a recognized value, and a `select` field must have at least one option. **Deliberately not enforced**: sequential `displayOrder` — unlike `rawStage`'s no-gaps invariant (which other stage-resolution code structurally depends on), `displayOrder` is only ever a sort hint with a per-field array-index fallback, so a non-sequential value is never an error.

### Case Mapping

**No changes to `Case`, `NewCaseInput`, `casesService.create`, or the Wix `cases` mapper.** A configurable field either sets `mapsToCaseField` (populates a real structured `Case` property directly, exactly as before) or doesn't (its value lands in `Case.fieldValues[checklistItemIndex]`, the pre-existing general-purpose bucket) — both mechanisms already existed and needed nothing new. This satisfies "do not expand the Case schema unnecessarily" by construction, not by restraint.

### Backward compatibility

Three layers, all verified:
1. **Field-level**: every pre-Phase-19 `IntakeFieldTemplate` (no `fieldType`/`uppercase`/etc. at all) resolves to identical rendering/masking/validation behavior via `resolveIntakeField`'s defaults — proven by running the **entire pre-existing `NewCaseModal.test.tsx` suite unmodified** against the now-Phase-19-annotated Managed Cremations fixture; all 24 prior tests pass with zero changes.
2. **Template-level**: if the enabled template's latest version has an empty/missing `intake.sections`, `FALLBACK_INTAKE` (a minimal 3-field form: decedent name, next of kin name/phone) renders instead of a blank screen — but **only once the real fetch has genuinely resolved and come back empty**, never during the loading state (a real bug caught and fixed during this phase — see "Errors and fixes" in the working notes — an early version applied the fallback while `templates` was still `undefined`, which raced the real data and broke several existing tests).
3. **Version-level**: exactly ADR-019's existing guarantee — `Case.workflowSnapshot` is a `structuredClone` taken at creation time, so a new version (whatever intake changes it contains) never retroactively affects an existing case.

## Consequences

- Any organization can now define its own intake form entirely through the Workflow Editor UI — no Beacon code change required for a new field, field type, validation rule, or field order.
- The Wix `workflowTemplateVersions` collection needed zero schema changes — `intake` was already an opaque JSON blob.
- One risk introduced: `generateUniqueFieldKey`'s counter-based key generation (`custom-field-N`) could theoretically collide with an admin's own hand-picked key of the same shape; `validateIntakeFields`' global-uniqueness check would catch this and reject the save with a clear error rather than silently corrupting draft state.

## Alternatives considered

- **Rename `password` → `masked`, migrating existing data**: rejected — no Wix write path exists for renaming a JSON key inside an existing `workflowTemplateVersions` row (it's append-only; a "rename" would mean writing a whole new version just to rename a field), and the dual-read bridge achieves the same behavior with zero migration risk.
- **A separate `POST .../intake` endpoint, independent from stages**: rejected — a `WorkflowTemplateVersion` is one cohesive unit everywhere else in the codebase; two endpoints creating two separate versions for what's conceptually one edit session would fragment version history for no benefit.
- **Live currency/phone input masking** (auto-inserting `$`/commas, formatting digits as the user types): rejected as out of scope — this phase asked for `validationType` support, not a full masking library per field type; `nextOfKinPhone` has never been auto-formatted either, and adding it now would be scope creep beyond what was requested.

## Payment field persistence — confirmed unchanged by this phase

Explicitly verified, not assumed: **this phase does not change how `cardName`/`cardNumber`/`cardExp`/`cardCvv`/`cardZip` are stored.** All five share `checklistItemIndex: 8` and have no `mapsToCaseField`, so `domain/workflow/resolveIntake.ts`'s `buildIntakeFieldValues` — untouched by this phase — joins their raw typed values with `" — "` into a single string at `Case.fieldValues[8]`, which `lib/wixCaseMapper.ts`'s `buildWixCaseData`/`mapWixCaseItem` (also untouched) write to and read from the real Wix `cases` collection **as plaintext**, exactly as it has since Phase 11 (structure) and Phase 16 (real Wix persistence). `fieldType: 'creditCard'/'cvv'` and `masked: true` (this phase's own additions) only affect `NewCaseModal.tsx`'s browser-side rendering — which control renders, whether it shows masked with a Show/Hide toggle — never what gets sent to or stored in Wix.

**This was true before this phase and remains true after it; this phase neither introduces nor fixes it.** Flagging it here because Phase 19 is what made `masked`/`fieldType: 'creditCard'` real, named concepts for the first time, which could easily be mistaken for a security control. It is not one.

### Security follow-up (explicitly out of this phase's scope — not implemented)

- **UI masking is not encryption or PCI protection.** `masked`/`password` only control whether an `<input>` renders as `type="password"` with a Show/Hide toggle in the browser. The underlying value is still a plain JavaScript string, sent over the wire and stored in Wix Data exactly like any other field — there is no encryption, tokenization, or field-level access control anywhere in this path.
- **CVV must not be retained.** Right now it is — `cardCvv` combines into the same `fieldValues[8]` string as every other payment field and persists indefinitely with the case record. This is a genuine compliance gap, not a hypothetical one.
- **Full card data should ultimately be handled through a PCI-compliant payment provider** (e.g. Stripe, Wix Payments) and Beacon should store only a non-sensitive token or reference id returned by that provider — never the PAN, expiration, or CVV itself.
- **Configurable sensitive fields must never be logged, included in analytics, error payloads, or test snapshots.** No code path in this phase (or any prior phase) `console.log`s, error-reports, or snapshot-tests a field's raw value — confirmed by inspection of every file this phase touched — but this is a standing constraint for all future work, not a one-time check: any new logging, analytics, or error-reporting integration must explicitly exclude fields where `masked`/`password` is set (or, better, exclude the entire Payment section by convention) before it ships. Test fixtures using well-known, publicly-documented fake card numbers (e.g. `4111111111111111`) are fine and remain in this codebase's test suite; the constraint is about real user-entered data, not synthetic test values.

None of the above is implemented in this phase — this section exists to make the gap explicit and trackable, per instruction, without expanding Phase 19's scope.
