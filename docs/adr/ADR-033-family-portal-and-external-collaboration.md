# ADR-033: Family Portal & External Collaboration

**Status:** Accepted
**Date:** 2026-08-05

## Context

Every phase since Phase 25 explicitly named and explicitly deferred this exact feature. Unlike Scheduling (Phase 27) or Notifications (Phase 28), "Family Portal" had no reserved ADR number and no partial implementation anywhere — genuinely greenfield at the top level, even though nearly every subsystem it integrates with (documents, signatures, payments, scheduling reads, notifications, activity logging) already existed.

**Fifteen architectural refinements were requested before implementation began**, the most consequential of which reversed the first draft's own proposal: a Family Portal user is **not** an `Identity` row. The first draft proposed reusing `Identity`/`Membership` machinery directly; the approved direction instead requires **total physical separation** between the staff identity population and the family identity population — a new `PortalUser` type, a new `portalUsers` collection, never the `identities` collection, so that a family member can never structurally appear in staff role assignment, RBAC resolution, or the staff organization-switching flow, regardless of any future code change elsewhere. Every other refinement follows the same instinct: **capability-based, case-scoped, fail-closed authorization, with an explicit resolution chain from session to resource, and explicit allowlisted DTOs at every boundary — never raw internal types, never trust-by-convention.**

The naming collision the first draft flagged still held: the existing staff app already occupies `app/(portal)/`. The Family Portal lives at the plain top-level path `/family` (`app/family/...`), never colliding with the existing staff route group.

This phase is large — a genuinely new application surface with its own identity population, session system, and authorization model — but the *business logic* underneath (documents, signatures, payments, scheduling reads) reuses existing services almost entirely unmodified; only two small, additive, backward-compatible changes touch already-shipped code (see "Two additive changes to shipped code" below).

## Architecture: PortalUser is a physically separate identity population

A Family Portal user is a `PortalUser` — a new, physically separate identity concept, structurally incapable of ever holding staff RBAC permissions, appearing in staff role assignment, or authorizing a staff route, because it lives in a different collection entirely (`portalUsers`) and is never accepted by any staff-authorization code path. Access to a specific case is a separate, explicit **`PortalAccess`** grant (case-scoped, capability-driven via `relationshipType`), created at invitation time and activated — never expanded — on acceptance.

**The required resolution chain, concretely** (`lib/auth/requireFamilyAccess.ts`):

```
beacon_family_session cookie
  → verified against the family-only signing context/token audience (never beacon_session's context)
  → PortalSession row (portalUserId, live revocation/expiry check)
  → PortalAccess row, looked up by (portalUserId, requested caseId) — never by a client-supplied organizationId
  → PortalAccess.status === 'active' (fail closed otherwise — pending/disabled/revoked/expired all deny)
  → organizationId is READ FROM the PortalAccess row itself, never accepted as request input
  → hasPortalCapability(access, requiredCapabilityKey) — fail closed if absent
  → only then: call the underlying service, and shape its return value through an allowlisting DTO
    before it ever reaches the response body
```

Every family route calls this chain exactly once, mirroring how every staff route calls `requireAuthorizedOrganization` exactly once. No family route ever reads `organizationId` from a query string or body and uses it for anything beyond an optional, independently-reconciled sanity check.

**The seven concepts, mapped:**

- **Portal User** (`PortalUser`, `portalUsers` collection) — reuses only the pure password-hashing utility functions (`lib/identity/passwordHashing.ts`), never `services/identityService.ts`, never the `identities` collection. A person cannot exist simultaneously as an `Identity` and a `PortalUser` from the same account — disjoint populations by construction, not convention.
- **Portal Invitation** (`PortalInvitation`) — the *offer*: `draft → pending → accepted`, or `→ expired`/`→ revoked`, its own `tokenHash` mirroring `SignatureRequest`'s convention.
- **Portal Access** (`PortalAccess`) — the *grant*, created **at invitation time**, not only on acceptance, with `status: 'pending'` — the invitation and the access it will confer are fixed together from the start (there is nothing left to *decide* at acceptance time, only to *activate*). Transitions independently to `active` (acceptance), `disabled`/`revoked` (staff action, any time), or `expired` (linked invitation's token expiring before acceptance). Every state but `active` fails closed.
- **Portal Relationship** (`domain/portal/portalRelationshipRegistry.ts`) — `primary_next_of_kin | secondary_family_member | authorized_representative | executor` implemented; `attorney | insurance_adjuster | veteran_representative | church_representative | funeral_home_partner` reserved.
- **Portal Session** (`PortalSession`) — its own cookie (`beacon_family_session`), its own signing context, its own resolver (`requireFamilySession.ts`) — never composed with or falling back to any staff session code.
- **Portal Permissions** (`domain/portal/portalCapabilityPolicy.ts`) — a capability registry structurally mirroring `PermissionKey`'s shape but a fully separate type/value space, resolved by `relationshipType`, checked only via `hasPortalCapability(access, key)`.
- **Portal Activity** — `ActivityService`, unmodified mechanism, new `family_portal` category + `recordPortalX` helpers, attributed via the anonymous-actor pattern below.

**One orchestration layer per integration, structurally enforced:** `services/portal/portalUserService.ts` is the only writer of `portalUsers`; `portalInvitationService.ts` the only writer of `portalInvitations` (and the only caller of `portalAccessService.ts`'s `createPendingPortalAccess`); `portalAccessService.ts` the only writer of `portalAccess` after creation; `portalSessionService.ts` the only writer of `portalSessions`; `portalMessagingService.ts` the only writer of `portalMessages` (insert-only — no update/delete function exists anywhere, mirroring `SignatureRecord`'s precedent). `portalDocumentService.ts`/`portalPaymentService.ts`/`portalSchedulingView.ts`/`portalActivityView.ts` are thin wrappers delegating 100% of business logic to `documentService.ts`/`paymentsService.ts`/`appointmentReads.ts`/`activityService.ts`, returning only allowlisted DTOs.

## Anonymous-actor attribution, mirroring the signer pattern

Every family-initiated action is recorded via `services/portal/portalActivityContext.ts`'s `portalActivityContext(organizationId, correlationId)` — `actorIdentityId: null, isSystemGenerated: true`, exactly mirroring `signatureService.ts`'s pre-existing `signerActivityContext()`. Real, queryable attribution (`portalUserId`, `relationshipType`) is carried in `ActivityEvent.metadata`, never conflating `PortalUser`'s id-space with `Identity`'s. Staff-initiated portal actions (inviting, revoking, staff-sent messages) use the caller's own real `ActivityContext` instead.

## Two additive changes to shipped code

1. **`services/signatureService.ts`**: `completeSignatureRequest`/`declineSignatureRequest` each gained one optional trailing parameter, `ctx: ActivityContext = signerActivityContext(...)` — the existing default preserves the already-shipped `/sign` flow's behavior byte-for-byte; family-portal call sites pass `portalActivityContext(...)` instead. Regression-tested alongside the new Phase 29 tests.
2. **`services/notificationService.ts`**: a new `RecipientScope: 'portal_user'` (resolved in `recipientResolver.ts` identically to `'individual'` — zero extra validation, the same permissive precedent that scope already has), and `dispatchChannel`'s email-resolution step tries `getIdentityById` first (unchanged for every existing staff notification) and falls back to the new `getPortalUserById` only when that returns `null` — the one path where notification delivery needs to resolve an email address for a population that isn't `Identity`-shaped. A genuinely new notification type was also added, `portal.staff_message_received` (category `family_portal`) — no existing staff-facing type fit "a family member sent you a message" well enough to reuse.

The staff Clover checkout route was **not** touched or refactored: rather than duplicate its inline orchestration logic (a structural-discipline violation) or have `portalPaymentService.ts` import `cloverProvider` directly (an equally worse violation), a new, purely additive `paymentsService.initiateCheckout()` function was extracted — the shipped staff route remains byte-for-byte unchanged, zero regression risk in a financial flow nobody asked to touch.

## Security model

- **Isolated portal sessions.** Distinct cookie name (`beacon_family_session`), distinct signing-key derivation (an HKDF-style "expand" step over the same root `SESSION_JWT_SECRET`, so the family key is never byte-identical to the staff key without requiring a second secret), distinct token audience claim (`aud: 'family'`), distinct resolver. `middleware.ts`'s staff branch never parses the family cookie; a structurally separate branch gates `/family/*` against the family cookie only, redirecting to `/family/login` (never `/login`) on a missing/invalid session, with `/family/login`, `/family/accept-invitation`, `/family/forgot-password`, `/family/reset-password` carved out as the surface's own public sub-paths. `lib/auth/sessionIsolation.test.ts` proves this two ways: cryptographically (a token minted for one audience is rejected by the other verifier) and structurally (a source-tree walk confirming no family route imports `requireIdentitySession`/`requireAuthorizedOrganization`, and no staff route imports `requireFamilySession`/`requireFamilyAccess`).
- **Capability-based, case-scoped, fail-closed authorization.** See the resolution chain above. `organizationId` is never accepted as a trusted request input on any family route.
- **Tokenized invitations, existence-hiding.** `generateToken()`/`hashToken()` reused from Phase 21; a lookup failure, an expired token, and a wrong token are never distinguished in any response.
- **Document authorization.** `caseDocuments.familyVisible` defaults to `false` unconditionally on every new row (generated or uploaded) — no document type, generation path, or signature completion ever sets it `true` automatically. The sole mutator is `documentService.setFamilyVisible`, reachable only via the staff `portal.manage`-gated `PATCH .../family-visibility` route. Family reads additionally require `hasPortalCapability(access, 'document.read')`.
- **Abuse protections.** `lib/rateLimiter.ts` — an in-memory, fixed-window, per-key bounded counter (`checkRateLimit(key, limit, windowMs)`), explicitly named as process-local (no shared-state store exists in this codebase, the same class of gap `docs/AUTHENTICATION.md` already discloses for staff login) — applied to family login, invitation acceptance, message-send, and payment-checkout-initiation. `requireSameOrigin` (reused verbatim from `lib/auth/csrf.ts`) gates every mutating family route.
- **Named, accepted limitation.** One real person holding both a staff `Membership` and a `PortalAccess` is not designed for this phase, mirroring a limitation already accepted elsewhere in the codebase for a similar dual-role scenario.

## Messaging model

`PortalMessage` is immutable, insert-only — no update or delete function exists in `portalMessagingService.ts` at all; a correction is always a new message. Every row records exactly one of `senderStaffIdentityId`/`senderPortalUserId`, plus, for family-sent messages, the specific `senderPortalAccessId` and a denormalized `senderRelationshipTypeAtSend` snapshot taken at send time (never re-derived later). Sending always additionally calls `notificationService.createNotification` — family→staff via `recipientScope: 'role'` (`funeralDirector`, consistent with Phase 28's own `case_participants` deferral, not reopened here); staff→family via the new `recipientScope: 'portal_user'`.

## Live Wix verification

Five new collections (Collections 47–51: `portalUsers`, `portalInvitations`, `portalAccess`, `portalSessions`, `portalMessages`) were created live via the proven `POST /wix-data/v2/collections` shape (`{"collection": {"id", "displayName", "fields", "permissions"}}`), and all twelve planned indexes created via `POST /wix-data/v2/indexes` and confirmed `ACTIVE`. `caseDocuments` was extended with `familyVisible` (BOOLEAN) via the established "resend the full field list" `PUT /wix-data/v2/collections` mechanism (revision 1→2).

**A new requirement was discovered while extending `caseDocuments`'s live schema: the `PUT` payload must include the collection's current `revision` explicitly** (`"revision must not be empty"` otherwise) — every prior phase's documented use of this mechanism (`organizations`, `organizationMemberships`, `paymentRecords`) had omitted this detail. Documented here and in `docs/WIX_DATA_SCHEMA.md` so the next phase to extend an existing collection's schema doesn't rediscover it.

**A second, previously-undocumented detail was confirmed empirically: `PUT /wix-data/v2/items/{wixItemId}?dataCollectionId=...` (id in the path and as a query parameter) is the correct update endpoint shape** — `lib/wixDataApi.ts`'s own `updateWixDataItem` already used this shape correctly; a first-draft verification script that instead PUT `/wix-data/v2/items` with `dataCollectionId` in the body returned an uninformative empty-bodied 404, corrected once cross-checked against the codebase's own implementation.

Exercised via direct Wix Data operations against `DATA_ADAPTER=wix`, anchored to Manor's Cremation's real, already-live `organizationId` (`managed-cremations`) and a real existing case (`caseNumber: B2026-016`) — every `PortalUser`/`PortalInvitation`/`PortalAccess`/`PortalSession`/`PortalMessage` row this verification created was its own new, disposable data:

- A full invitation→pending-access→acceptance→active-access→session lifecycle was exercised end to end, confirming the critical `requireFamilyAccess` lookup — `portalAccess` queried by `(portalUserId, caseId)`, never `organizationId` — resolves to exactly one `active` row with `organizationId` correctly readable off that row itself.
- The existence-hiding `portalInvitations` lookup by `tokenHash` resolved to exactly one row, correctly reflecting `status: 'accepted'` post-acceptance.
- **Cross-case isolation confirmed live:** the same `portalUserId` queried against an unrelated `caseId` resolved to zero rows — the fail-closed behavior the resolution chain depends on is not just unit-tested, it is live-verified against the real platform's query semantics.
- Bidirectional messaging (family→staff, staff→family) confirmed both insert successfully and both resolve via a single `(organizationId, caseId)` query, in insertion order.
- **Revocation confirmed to fail closed live:** flipping `PortalAccess.status` to `revoked` left the row queryable (never deleted) with its `status` immediately reflecting `revoked` on the very next read.
- `caseDocuments.familyVisible`'s field-level behavior (type, presence, boolean round-tripping) was confirmed via the schema-extension response itself; inserting a disposable row into the live, already-populated `caseDocuments` collection was deliberately not performed this pass, at the user's explicit direction, given that collection (unlike the five brand-new empty ones) holds real production rows.
- Every disposable row created across all five new collections was deleted afterward; a final query confirmed **zero residual rows** in all five.
- The index-build step took noticeably longer than prior phases' single-collection probes (indexes across all five collections stayed `BUILDING` past an initial ~30-second poll window before completing) — consistent with the platform queuing concurrently-requested index builds across several collections created back-to-back, not a new limitation; all reached `ACTIVE` on a subsequent check.
- Two of this session's write-shaped actions against real production state (reading Manor's Cremation's live `organizations`/`cases` rows; extending `caseDocuments`'s live schema) required explicit, separately-obtained user sign-off beyond the phase's own standing approval, reflecting this session's own heightened caution around actions with a real external system beyond the local repo.

## Permissions

Two new staff-side keys: `portal.manage` (administrator/manager tier — invite, revoke, disable access, toggle `familyVisible`), `portal.message` (every role except accounting/readOnly — send/read messages to family). Total staff permission count moves from 42 to **44**. The family-side capability policy (`domain/portal/portalCapabilityPolicy.ts`) is a fully separate registry, never RBAC, never checked via a raw string comparison — only through `hasPortalCapability(access, key)`.

## Deferred

- No family self-registration — every `PortalUser` arrives only via a staff-issued invitation.
- No document uploads, case-data edits, or appointment rescheduling by family.
- No live chat, typing indicators, message editing, or message deletion.
- No SMS or push notification channel for the family surface (mirrors Phase 28's own reserved, unimplemented channels).
- No native mobile apps — the API is already REST/JSON, a reserved extension point.
- No external identity-verification providers; no AI.
- `attachmentDocumentId` on `PortalMessage` is reserved and unused this phase.
- The Clover webhook (`app/api/webhooks/clover/route.ts`) does not yet distinguish a family-initiated payment from a staff-initiated one, so it cannot itself emit a `portal.payment.completed` activity event today — named, not silently worked around.
- One person holding both a staff `Membership` and a `PortalAccess` simultaneously — unsupported this phase.
