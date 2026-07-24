# ADR-021: Secure Payment Architecture

**Status:** Accepted
**Date:** 2026-07-23

## Context

ADR-020 (Configurable Intake Form Builder) explicitly flagged, but deliberately did not fix, a real data-handling gap: the Payment section's five card sub-fields (`cardName`/`cardNumber`/`cardExp`/`cardCvv`/`cardZip`) all shared `checklistItemIndex: 8` with no `mapsToCaseField`. `domain/workflow/resolveIntake.ts`'s `buildIntakeFieldValues` — generic, correct, and untouched by that phase — joined every field sharing an index with `" — "`, so a filled-out Payment section produced one plaintext string (cardholder name — PAN — expiration — CVV — zip) stored verbatim at `Case.fieldValues[8]`, written to and read from the real Wix `cases` collection by the existing, also-untouched mapper functions. `masked`/`fieldType: 'creditCard'` only ever controlled whether the browser rendered an `<input type="password">` with a Show/Hide toggle — a UI affordance, never encryption, tokenization, or a storage boundary.

A second, independent leak existed entirely outside the New Case form: `domain/cases/checklist.ts`'s raw-stage-0 checklist item 8 (`"Cardholder name, card number, exp, CVV & billing zip code"`) had `hasField: true` (every First Call & Payment item does) and `isPasswordField: true` (matched by `PASSWORD_FIELD_PATTERN = /card|cvv/i` against the label). `components/case/ChecklistCard.tsx` rendered this as an editable, password-masked text field on Case Detail regardless of whether any intake had ever populated it — typing into it wrote raw payment data directly to `Case.fieldValues[8]` via `mutations.setFieldValue`, a real Wix `PATCH`, completely bypassing the New Case form and its (already inadequate) masking.

This phase is scoped to eliminating storage of sensitive payment data and establishing the permanent architecture for provider-based collection later — not to integrating an actual payment provider (Stripe, Square, or otherwise).

## Why Beacon never stores card data

Storing a PAN, expiration date, or CVV — even briefly, even "just for this case" — puts the application handling that data in PCI DSS scope, with real, ongoing obligations: network segmentation, encryption at rest and in transit, key management, access logging, and regular compliance audits, none of which this codebase (or the underlying Wix Data collection, a general-purpose JSON store with no PCI attestation) is built or intended to satisfy. The only sustainable way to keep Beacon out of that scope is structural: **card data must never reach Beacon's server or its persistence layer at all.** A masking toggle in the browser cannot substitute for this — it changes what the *user* sees, not what gets sent over the wire or written to Wix.

## Decision

### Two categories of intake field

`types/workflowTemplate.ts`'s `IntakeFieldType` now has `'payment'` as a first-class value, and no longer has `'creditCard'`, `'expiration'`, or `'cvv'` — those three are removed outright, not merely deprecated. `IntakeValidationType` likewise drops `'creditCard'`/`'expiration'`. This closes what would otherwise be a back door: without also removing these from the validation-type enum, an admin (or a forged workflow-edit request) could reconstruct card-number validation by configuring `fieldType: 'text', validationType: 'creditCard'` on an ordinary field — the type-level removal makes that combination impossible to express, not just discouraged.

A `'payment'` field represents an entire secure section, not one data-entry control. Administrators configure `label`, `required`, `paymentPurpose`, `paymentAmount` (optional), and `paymentDescription` (optional) — new, narrowly-scoped `IntakeFieldTemplate` properties. They do not, and structurally cannot, configure a card number, expiration, or CVV value through the workflow template — those never exist as template data at all.

### The hard guarantee: payment fields never reach `Case.fieldValues`

`domain/workflow/resolveIntake.ts`'s `buildIntakeFieldValues` and `buildStructuredCaseFields` both begin their per-field loop with an unconditional `if (field.fieldType === 'payment') continue;`. This is deliberately a second, independent layer, not the only one: `components/modals/NewCaseModal.tsx` never writes a payment sub-field's typed value into `draft` in the first place (see below), so under normal operation there is nothing for this skip to even need to catch. But the skip exists anyway, checked directly against `fieldType` rather than trusted to `draft`'s contents — so even a caller passing a forged `draft` object with a payment field's key populated, or a forged template that (incorrectly) gives a `'payment'` field a `checklistItemIndex`/`mapsToCaseField`, can never have that value surface in either function's output. `domain/workflow/resolveIntake.test.ts` proves this directly, including the adversarial case of a colliding `checklistItemIndex`.

### Client-side isolation (`NewCaseModal.tsx`)

A payment field's five sub-values (cardholder name, card number, expiration, CVV, billing zip) live in their own `useState` (`paymentDraft`/`paymentRevealed`), entirely separate from the ordinary intake `draft` state every other field reads and writes. `renderPaymentField` is a dedicated renderer — not a branch inside the generic per-field switch — and never touches `draft`/`setDraftValue`. This is what makes the `fieldValues`/`structuredFields` skip above more than defense-in-depth theater: there is no code path connecting the two states at all.

`resetForm()` clears `paymentDraft`/`paymentRevealed` unconditionally on every submit, cancel, and close. Because this state is plain `useState` with no `localStorage`/`sessionStorage` write, a page refresh loses it for free — this is intentional, not a gap: the interim experience (until a real payment provider exists) is "type it in, process the payment by phone or terminal, and it's gone the moment you leave this form."

A `required: true` payment field gates submission on `paymentDraft` being fully filled locally (`isPaymentSectionFilled`) — never on what was typed being valid or sent anywhere. The default fixture leaves it optional, matching that none of the five sub-fields it replaces were ever required either.

### Server-side enforcement (`lib/paymentFieldGuard.ts`)

Client-side isolation is necessary but, per this phase's own instruction, not sufficient — "do not rely on client validation." `lib/paymentFieldGuard.ts` exports one canonical list, `FORBIDDEN_PAYMENT_FIELD_KEYS` (`cardNumber`, `cardExp`, `cardExpiration`, `cardCvv`, `cvv`, `cardholderName`, `billingZip`), and `findForbiddenPaymentFields(body)`, a shallow check for these as direct properties of a plain object. Any request whose body contains one of these keys is rejected outright with 400, before any other processing:

- `POST /api/cases` — checked on the whole body.
- `PATCH /api/cases/[caseId]` — checked on both the top-level body and the nested `patch` object, since a forged update could try either shape.
- `lib/wixWorkflowTemplateMapper.ts`'s `validateIntakeFieldPayload` — checked first, before any other field-shape validation, so a forged or mistaken workflow-edit request can never attach a literal card-data property directly to a field definition.

This is deliberately a flat literal-key check, not a content scan of every string value for something that "looks like" a card number — that would risk false positives against legitimate data (long reference numbers, phone numbers) and false confidence (trivially defeated by reformatting). The real protection is architectural (the sections above); this guard is the mandatory backstop against a forged or buggy caller that tries to name these fields directly.

### Case Detail's independent leak, closed

`domain/cases/checklist.ts`'s raw-stage-0 item 8 is relabeled `"Payment collected"` (exported as `PAYMENT_CONFIRMATION_LABEL`) and no longer matches `PASSWORD_FIELD_PATTERN`. `services/__mocks__/workflowTemplates.ts`'s `buildChecklistItems` gives this specific item `hasField: false` as a permanent, named exception to "every First Call & Payment item is a data-entry field" — so there is no free-text (or password-masked) box on Case Detail for a payment value to ever be typed into, independent of whatever the New Case form does.

### Future provider model (`types/payment.ts`)

`PaymentRecord` — `provider`, `providerPaymentId`, `providerPaymentMethodId`, `status`, `amount`, `currency`, `cardBrand`, `cardLast4`, `receiptReference`, `collectedAt`, `authorizationCode?` — documents the shape a real integration (Stripe, Square, Wix Payments) will eventually populate. No PAN, no CVV, no expiration date anywhere in it — only a provider's own opaque reference IDs and non-sensitive display metadata (a card brand, a last-4, a receipt reference). This type is intentionally not wired into `Case`, any route, or any storage in this phase — it exists to make the target shape explicit for whoever builds the real integration next, not to half-build it now.

### PCI scope considerations

With this architecture, Beacon's server and Wix Data collections never receive or store a PAN, CVV, or expiration date — the only payment-adjacent data anywhere in the system is the `paymentPurpose`/`paymentAmount`/`paymentDescription` template metadata (never sensitive) and, once a provider is integrated, the non-sensitive `PaymentRecord` fields above. This keeps Beacon itself out of PCI DSS scope for cardholder data storage; a future payment-provider integration would still need its own SAQ-A-eligible flow (e.g. Stripe Elements/Payment Element, Square Web Payments SDK) where card data goes directly from the browser to the provider and never through Beacon's own server at all — consistent with, not incidental to, the isolation this phase already builds client-side.

## Consequences

- No sensitive payment data (PAN, CVV, expiration) can reach `Case.fieldValues`, the Wix `cases` collection, Notes, logs, or any DTO — proven by `domain/workflow/resolveIntake.test.ts`, `lib/paymentFieldGuard.test.ts`, and dedicated `NewCaseModal.test.tsx`/route-handler tests (see the phase report's "Tests added" section).
- Payment collection during the interim (before a real provider exists) is browser-only and lossy by design — a refresh or navigation away loses whatever was typed. This is a deliberate UX tradeoff in exchange for never having anywhere for that data to leak from.
- A future payment-provider integration has a clear, pre-agreed target shape (`PaymentRecord`) and a clear boundary (never touch `Case.fieldValues`, never add new forbidden keys without updating `lib/paymentFieldGuard.ts`'s single canonical list).
- The live Wix `workflowTemplateVersions` collection's Standard Cremation Workflow template was migrated (as a new, additive version) to replace its five card sub-fields with one `fieldType: 'payment'` field — necessary for the architecture above to actually take effect for real case creation, not just for the mock fixture. Existing cases' `workflowSnapshot`s (a `structuredClone` taken at creation time) are unaffected.

## Alternatives Considered

- **Encrypt card values before storing them in Wix**: rejected — this would keep Beacon squarely in PCI scope (key management, encrypted-at-rest obligations, access controls) for no real benefit, since Beacon has no legitimate use for the raw card data after a phone/terminal payment is processed. Not storing it at all is strictly simpler and strictly safer.
- **A content-scanning guard that rejects any string that "looks like" a card number**: rejected — false positives against legitimate long numeric strings (reference numbers, phone numbers) and false confidence (trivially defeated by reformatting); the literal-key guard plus the architectural skip in `resolveIntake.ts` is both simpler and more reliable.
- **Integrate a real payment provider now (Stripe/Square)**: explicitly out of scope for this phase per its own instructions — this phase is about eliminating current storage and building the abstraction a provider will later plug into, not the provider integration itself.
