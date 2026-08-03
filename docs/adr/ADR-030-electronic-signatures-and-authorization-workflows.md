# ADR-030: Electronic Signatures & Authorization Workflows

**Status:** Accepted
**Date:** 2026-08-14

## Context

Phase 25 built the document generation/template system but deliberately reserved exactly one forward-looking accommodation for this phase: `CaseDocument.signatureStatus: CaseDocumentSignatureStatus | null` (`'unsigned' | 'pending_signature' | 'signed'`), always `null`, and a reserved `ACTIVITY_EVENT_TYPES.DOCUMENT_SIGNED: 'document.signed'` event type no code path fired. ADR-029's own words: "the `signatureStatus` reservation is the only forward-looking accommodation, and it is inert." This phase makes it live.

The genuinely new problem this phase solves: every signer is an external party (family member, next of kin) who must review and sign a legally significant document **without ever holding a Beacon session** — architecturally new territory, since every existing public/token-gated route in this codebase (`verify-email`, `reset-password`, `accept-invitation`) still resolves to a Beacon `Identity`/session at the end of the flow. A signer never does.

**Explicitly out of scope this phase:** SMS verification, identity-verification providers, notarization, DocuSign/Adobe Sign integration, workflow automation, OCR, AI document processing, family portal, an advanced notification platform. Sequential/parallel signing, witness signatures, notarization, and third-party e-signature adapters are reserved as named extension points (see "Extension points" below) but not implemented.

## Architecture: Request and Record are two separate entities

The single most consequential decision this phase makes: **`SignatureRequest` and `SignatureRecord` are two independent Wix collections, not one row with optional fields.**

- **`SignatureRequest`** is the mutable workflow row — "someone has been asked to sign a specific, already-generated document," nothing more. Its `status` (`draft → pending → viewed → signed|declined|expired|cancelled`) is the only field that changes after creation.
- **`SignatureRecord`** is a separate, insert-only, never-updated-or-deleted row, created exactly once when a request completes successfully. It holds the actual legally relevant facts of the completed signature (signer identity, typed attestation, IP/user-agent, checksum verification) — structurally distinct from the `ActivityEvent` audit narrative (which also records this moment, for a different reader: the Signature History timeline vs. "who signed this document" on the Documents tab).

This split is what makes "support multiple signatures in the future without redesigning the data model" literally true: a witness co-signing, or a future sequential-signing chain, is just additional `SignatureRequest`/`SignatureRecord` row pairs against the same `documentId` — the shape of either table never changes. `SignatureRequest.sequenceOrder` is reserved for exactly this (always `1` this phase); the schema itself places no limit on concurrent requests per document — the "at most one active request per document" rule is a `services/signatureService.ts` business rule, not a schema constraint.

**Document locking, precisely defined:** `documentService.ts`'s `generate()` already has one code path that ever supersedes an existing `CaseDocument` (its `existingDocumentId` regeneration branch). This phase adds one guard immediately after template-version resolution: if the named `existingDocumentId` row has `signatureStatus === 'signed'`, `generate()` throws `DocumentServiceError` before any rendering/storage work begins. **A signed document becomes permanently immutable.** A correction is always a brand-new, unrelated `generate()` call (no `existingDocumentId`) plus a new `SignatureRequest` — the original signed document's row and its `SignatureRecord` are never modified, invalidated, or unlinked.

## Signature event taxonomy

Seven new `ACTIVITY_EVENT_TYPES` entries, all `category: 'documents'`, all `resourceType: 'caseDocument'`/`resourceId: documentId` (matching Phase 25's own `document.*` convention — `signatureRequestId` travels in `metadata`, never as `resourceId`):

```
document.signature.requested
document.signature.email.sent   (fires only once notification dispatch succeeds — distinct from request creation)
document.signature.viewed       (recorded on every access, not just the first)
document.signature.completed
document.signature.declined
document.signature.cancelled
document.signature.expired
```

Phase 25's reserved `DOCUMENT_SIGNED: 'document.signed'` constant is **superseded, not reused** — kept in `types/activityEvent.ts`, marked deprecated, never wired — in favor of `SIGNATURE_COMPLETED: 'document.signature.completed'`, for a consistent `document.signature.*` namespace. Human-readable narrative text (`description`) is always kept separate from the machine-readable `eventType` identifier.

Every event across one request's entire lifecycle shares that request's own `correlationId` (never a new one minted per action) — live-verified.

## Token security: modeled directly on password-reset tokens, with one deliberate departure

`lib/identity/tokens.ts`'s `generateToken()`/`hashToken()`/`verifyTokenHash()` are reused completely unmodified — 32-byte random hex, SHA-256 hash-only persistence, constant-time verify. No public response body ever includes `SignatureRequest.id` or any other internal identifier; the token in the URL is the only thing the browser ever holds.

**One departure from every other token flow in this codebase: the signing token is not burned on first use.** A signer must be able to reload the review page multiple times before committing. Replay protection is instead enforced entirely by the request's own state machine: `completeSignatureRequest`/`declineSignatureRequest` reject an already-terminal request regardless of whether the token still hashes correctly. `resolveSigningToken` also lazily treats an overdue `expiresAt` as expired immediately for a `pending`/`viewed` row, regardless of whether `expireOverdueSignatureRequests` (a plain, independently invokable reconciliation function — no scheduler exists in this codebase) has run yet.

`resendSignatureRequest` rotates the token (new hash generated; the old one is simply no longer present on the row), immediately invalidating any previously sent link.

## Tamper detection

`completeSignatureRequest` re-downloads the actual stored document bytes via `documentService.downloadFile()` and recomputes their SHA-256, refusing to complete (`SignatureServiceError`) if it doesn't match the `CaseDocument.checksumSha256` recorded at generation time. Logged via `console.error`, not a dedicated eighth `ActivityEvent` type — kept out of the seven-event taxonomy per the approved plan.

## Signer role is a label, not an RBAC principal

`SignerRole` (`primary_contact` / `secondary_contact` / `next_of_kin` / `authorized_representative` / `funeral_director` / `internal_staff`) describes the signer's relationship to the case for display purposes only. Every signer, regardless of role, uses the identical token-link public signing flow — one signing pathway, not a role-gated set of them — keeping the audit trail and security model uniform.

## Sessionless public signing surface

`/sign` and `/api/signing/*` never mint a Beacon session, for anyone, ever — the first genuinely new category of public route in this codebase (every prior one — `verify-email`, `reset-password`, `accept-invitation` — eventually resolves to a session). Authorization reduces entirely to "do you possess a valid, hashed, not-yet-terminal, not-yet-expired token," the same trust model a password-reset link already relies on, with the signer's identity verified out-of-band (the staff member emailed *this specific* signer at *this specific* address) rather than by a Beacon account. `middleware.ts`'s matcher allowlists `/sign` alongside the four existing public identity pages; `/api/*` was already excluded wholesale.

Every signer-driven action (view/complete/decline) has no Beacon identity to attribute — `ActivityEvent.actorIdentityId: null` is only valid when `isSystemGenerated: true` (per that type's own documented constraint), so these events set `isSystemGenerated: true` even though a real external human, not automation, triggered them. Each event's own `description` carries the true narrative ("Signed by Jane Doe"), so this is never confused with genuine background automation by anyone reading the audit trail.

## Notification: behind an interface, no new provider

`lib/signatureNotifier.ts`'s `SignatureNotifier` interface (`notifyRequested`/`notifyCompleted`/`notifyDeclined`/`notifyCancelled`) sits in front of the one real implementation, `lib/identityMessageSignatureNotifier.ts`, which wraps the existing `IdentityMessageSender` (four new `IdentityMessage` kinds). `signatureService.ts` holds `const signatureNotifier: SignatureNotifier = identityMessageSignatureNotifier;` — a plain const assignment, no factory function, matching every other provider in this codebase (`documentRenderer`, `documentStorageProvider`, `paymentProvider`). No new email provider, no new notification platform — inherits the same "logs to console in dev, throws a clear named error in production" posture every other message kind already has.

`createSignatureRequest`/`resendSignatureRequest` share a `dispatchAndAdvance` helper mirroring `documentService.generate()`'s own two-phase `pending → active/failed` pattern: a request is inserted `draft`, and only advances to `pending` once notification dispatch actually succeeds — a delivery failure never throws back to the caller, it just leaves the request retryable via `resend`.

## Structural enforcement

`services/signatureService.test.ts`'s "SignatureService orchestration boundary" describe block, mirroring `documentService.test.ts`'s own source-tree-walk pattern, asserts:
- Only `signatureService.ts` imports `lib/identityMessageSignatureNotifier.ts`.
- Only `signatureService.ts` imports any of the seven `recordSignature*` helpers from `activityService.ts`.
- No file under `app/api/signing/**` imports `lib/identity/tokens.ts` directly.
- No file other than `documentService.ts` calls `applyCaseDocumentSignatureStatusToWixData` (the real, single mutation entry point for `CaseDocument.signatureStatus`).

**Correction made during implementation:** the fourth check's first draft searched for the literal string `signatureStatus: 'signed'`, which falsely flagged `activityService.ts`'s own `recordSignatureCompleted` helper — it legitimately constructs `JSON.stringify({ signatureStatus: 'signed' })` as an `ActivityEvent.newValue` narrative payload, not an actual collection write. Re-scoped to search for the mutator function's own name instead, which correctly excludes that file.

No Route Handler — staff-facing or public — ever validates a token, flips `signatureStatus`, calls a `recordSignature*` helper, or imports the notifier directly; every one delegates entirely to `signatureService.ts`/`documentService.ts`.

## Extension points reserved, not implemented

- **Sequential signing** — `SignatureRequest.sequenceOrder` already exists; a future phase relaxes "one active request per document" to "one active request per `sequenceOrder` slot."
- **Parallel signing** — same relaxation, without the ordering constraint; no schema change either way.
- **Witness signatures** — just another `SignatureRequest`/`SignatureRecord` pair against the same `documentId`, with `SignerRole` widened.
- **Notarization** — a future `notarized`/`notaryCommissionId` field on `SignatureRecord`, deliberately not added now.
- **DocuSign/Adobe Sign adapters** — `SignatureNotifier` already proves the provider-swap seam works for notification; a future external-signing integration would sit at an analogous, not-yet-named interface in front of `signatureService.ts`'s own token/state-machine logic.

## Permissions

Four new keys: `signature.request`, `signature.read`, `signature.cancel`, `signature.manage` (reserved for a future org-wide signature settings surface — no dedicated UI ships this phase). Tiered the same way Phase 25's `document.*` split was: `signature.request`/`.read`/`.cancel` mirror `document.generate`/`.view`/`.archive`'s tiers; `signature.manage` mirrors `document.template.manage` (administrator/manager only). Total permission count moves from 28 to **32**. `seedPlatformDefaultRoles` was re-run against live Wix so organizations already provisioned before this phase pick up the four new keys (same live-data corollary Phase 25 documented).

## Wix Data index-creation gap — resolved

ADR-029 documented an open gap: "the REST endpoint for adding a secondary index to an already-created collection could not be determined this session," having tried `POST .../collections/{id}/indexes`, `POST .../collections/{id}:createIndex`, and `PATCH .../collections/{id}` with an `indexes` field — each returning a 404 or a generic error.

**This phase found the correct, working shape.** Indexes are managed via a top-level resource, not nested under a collection:

- **Create:** `POST https://www.wixapis.com/wix-data/v2/indexes`, body `{ dataCollectionId, index: { name, fields: [{ path, order }], unique } }`. The field is `unique` (a first attempt using `isUnique` was silently accepted but produced a *non-unique* regular index — confirmed by inspecting the response body's own `unique: false`, since the create call itself doesn't validate unrecognized body keys).
- **List:** `GET .../v2/indexes?dataCollectionId={id}` → `{ indexes: [...], pagingMetadata }`. (`GET .../v2/collections/{id}` does **not** return an `indexes` field at all — this is why treating that response's absence of an `indexes` key as "no indexes were created" would have been a wrong inference; the two are genuinely separate resources.)
- **Delete:** `DELETE .../v2/indexes?dataCollectionId={id}&indexName={name}` (already known from Phase 19B's correction pass) — asynchronous; the dropped index reports `status: "DROPPING"` for roughly a minute before the name is free to reuse.

Passing `indexes` inside the `POST /v2/collections` collection-creation body (the shape this phase originally assumed, matching the plan's "declare every index at creation time" strategy) is silently accepted and silently ignored — the created collection's own indexes list comes back empty. **Every index, for every collection in this project to date, must be created via a separate `POST /v2/indexes` call per index, after the collection itself exists.**

**Retroactive fix applied this phase:** using this now-confirmed shape, the seven secondary indexes Phase 25 had documented as design intent but never actually provisioned (`documentTemplates`' two regular + one unique, `documentTemplateVersions`' one regular, `caseDocuments`' three regular) were created live against the real Wix site and confirmed `ACTIVE`. Phase 25's three collections are no longer under-indexed.

## Live Wix verification

Both new collections (`signatureRequests`, Collection 35; `signatureRecords`, Collection 36) were created live, each immediately followed by its full set of indexes via the corrected `POST /v2/indexes` calls above — index cap re-confirmed empirically at `{"regular":3,"unique":1,"total":4}` on both, exactly matching every prior collection's own cap, and all 8 indexes (4 per collection) reached `ACTIVE`.

Using two throwaway organizations and a case sharing an identical `caseId` string across both (matching Phase 25's own precedent), exercised through the real `signatureService.ts`/`documentService.ts` functions with `DATA_ADAPTER=wix`:

- `createSignatureRequest` → confirmed `draft → pending` on successful dispatch; confirmed the raw Wix item has a `tokenHash` field only — no plaintext token field of any name.
- `resolveSigningToken` + `markSignatureViewed` → confirmed `pending → viewed` on first access; confirmed a second access records a second `document.signature.viewed` event without re-transitioning the row.
- Signature completion → confirmed a new `SignatureRecord` row is created and round-trips correctly through the real mapper; confirmed `CaseDocument.signatureStatus` flips to `'signed'` via the real `markDocumentSigned()`; confirmed `listRecords` returns exactly the one row.
- Regeneration of the now-signed document (`generate()` with `existingDocumentId` pointed at it) → confirmed rejected with the exact "permanently locked" `DocumentServiceError`, live, before any render/storage work began.
- Decline, cancel, and expire flows (three separate documents/requests) → confirmed each reaches its correct terminal status; confirmed replaying `decline` against an already-declined request is rejected.
- All 7 event types confirmed recorded live, each request's events sharing exactly one `correlationId`.
- Cross-tenant isolation confirmed: a request created in the second organization is invisible to a query scoped to the first (identical `caseId` string notwithstanding), and its own token never resolves to anything outside its own organization.
- Every row created was deleted afterward; a final query confirmed zero rows remained in `signatureRequests`, `signatureRecords`, `caseDocuments`, `documentTemplates`, or `activityEvents` for either throwaway organization.

**One inherited gap, scoped around rather than silently ignored:** `services/documentService.ts` hardcodes `documentStorageProvider = vercelBlobStorageProvider` with no local/mock fallback, and this environment has no `BLOB_READ_WRITE_TOKEN` provisioned — the same gap ADR-029 already documented ("only the storage step failed, exactly as designed" — Phase 25's own live verification hit this too). This blocks exactly two things: real `generate()`-driven PDF creation, and `completeSignatureRequest`'s internal checksum re-download/re-verify step. Every test `CaseDocument` used in this phase's live verification was inserted directly into the live `caseDocuments` collection (bypassing only the render/upload step, using the real mapper and a real SHA-256 over a placeholder buffer) rather than via `generate()`; the signature-completion step replicated everything `completeSignatureRequest` does *except* the checksum re-download (which requires the missing storage token) — the real `SignatureRecord` insert, the real request-status patch, and the real `markDocumentSigned()` all ran unmodified. A real `BLOB_READ_WRITE_TOKEN` is required before this specific re-verification step can be exercised live in any environment; it is fully covered by the unit test suite (`signatureService.test.ts`'s checksum-mismatch-rejection test) in the meantime.

## Deferred

- SMS verification, identity-verification providers, notarization, DocuSign/Adobe Sign integration, workflow automation, OCR, AI document processing, family portal, an advanced notification platform — explicitly out of scope (see Context).
- Sequential signing, parallel signing, witness signatures, notarization, third-party e-signature adapters — named extension points, not implemented (see above).
- A scheduled job to actually invoke `expireOverdueSignatureRequests` automatically — no scheduler/cron exists anywhere in this codebase; the function is plain and independently invokable whenever one is introduced.
- Reminder emails beyond an explicit staff-triggered "resend" — `reminderCount`/`lastRemindedAt` are modeled but nothing sends them automatically.
- `BLOB_READ_WRITE_TOKEN` provisioning — inherited from Phase 25, still not provisioned in this environment; see "Live Wix verification" above for exactly what this blocks and how it was scoped around.
