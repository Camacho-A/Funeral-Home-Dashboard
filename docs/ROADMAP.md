# Roadmap

## Version 1 — Case Operations (current)

Scope: the four screens visualized in `design/Beacon.dc.html` — Dashboard, Case Detail, Tasks, Reports — backed by Wix Managed Headless for operational data and a small Postgres/object-storage service for compliance documents and the audit trail. Single tenant (Managed Cremations), architected for multi-tenancy from day one. See [PRODUCT_VISION.md](./PRODUCT_VISION.md) for full scope and [ARCHITECTURE.md](./ARCHITECTURE.md) for the technical shape.

Notably, the Reports screen's org switcher in the current design already lists a second, disabled entry — "Gus Camacho Funeral Home — coming soon" — meaning the visual design itself was built anticipating that Beacon would serve more than one funeral home. That expectation is honored structurally (via `organizationId` on every record) well before it's honored functionally.

## Completed: Multi-Tenant Authorization Hardening (Phase 15X)

**Status: closed 2026-07-23.** Originally recorded during Phase 15B's final review — see [ADR-012](./adr/ADR-012-wix-workflow-template-read-integration.md)'s review findings and the former "Known limitations" entry this superseded in `docs/AUTHENTICATION.md`. Full writeup: [ADR-015](./adr/ADR-015-multi-tenant-authorization-hardening.md).

**The gap (now closed):** none of the Route Handlers introduced by the Wix read integrations verified that the `organizationId` in the request actually belonged to the caller's authenticated session — `organizations`, `workflow-templates` (both routes), `cases` (both routes), and `tasks` all trusted a path/query parameter directly. As public HTTP endpoints with no middleware coverage (`middleware.ts`'s matcher deliberately excludes `/api/*`), any HTTP client — authenticated or not — could call any of these six routes with a forged `organizationId` and receive that organization's data.

**Resolution:** a single reusable helper, `lib/auth/requireAuthorizedOrganization.ts`'s `requireAuthorizedOrganization(requestedOrganizationId)`, composes the already-existing, already-tested `resolveAuthorizationContext` (Phase 13) with session resolution and a standardized `401`/`403` `NextResponse`. All six Route Handlers now call it before using `organizationId` for anything, and use only the returned, trusted `context.organizationId` downstream. See ADR-015 for the full design, the architecture-review findings that preceded implementation, and what remains explicitly deferred (real Wix-backed membership data, still mock-fixture-only; Phase 16 write endpoints must reuse this same helper rather than re-deriving authorization inline).

## Completed: Wix Write Integration (Phase 16)

**Status: closed 2026-07-23.** Full writeup: [ADR-016](./adr/ADR-016-wix-write-integration.md).

**The gap (now closed):** `casesService.create/update` and `tasksService.create/update/remove` were mock-only — a case or task created/edited while `DATA_ADAPTER=wix` never persisted to Wix, so it never appeared in a subsequent Wix-sourced read (documented in ADR-013/014). Real Wix writes now exist for case create/update and task create/update/delete, all reusing Phase 15X's `requireAuthorizedOrganization` — no new authorization logic was written. `lib/wixDataApi.ts` gained `insertWixDataItem`/`updateWixDataItem`/`deleteWixDataItem`; `lib/wixCaseMapper.ts`/`lib/wixTaskMapper.ts` gained matching write-side build/validate/merge functions; four Route Handlers were added or extended (`POST /api/cases`, `PATCH /api/cases/[caseId]`, `POST /api/tasks`, and a new `app/api/tasks/[taskId]/route.ts` for `PATCH`/`DELETE`).

**Remaining, explicitly deferred (unchanged by this phase):** `createdBy`/`intakeOwnerId` still derive from `hooks/useSession.ts`'s hardcoded stub, not a real server-resolved identity — Identity Model Hardening remains open. Real Wix-backed `organizationMemberships` reads (Phase 15X's own deferred item) are also still outstanding — both are prerequisites for a genuine second organization to operate through this app, not just exist in fixtures.

## Version 2 Candidates (not committed, not scheduled)

These are logical next steps once V1 is in production use at Managed Cremations, in roughly the order they'd likely be needed:

- **Real multi-tenant onboarding.** Turning the "architected for it" schema into an actual self-serve or admin-assisted flow for provisioning a second, third, etc. funeral home — organization creation, staff invitation, per-organization SLA/settings configuration (the org switcher becomes real).
- **Service scheduling.** Booking chapels, hearses, crematory slots, and staff time for visitations, funerals, and cremations — likely modeled as its own Wix Data collection(s) alongside `Cases`, with calendar/resource-conflict logic that doesn't exist in V1 at all.
- **Public memorial pages & obituaries.** A public-facing surface (likely a separate, SEO-oriented Next.js route group or site) for publishing service details, guest books, and tribute uploads — this is the point at which the "prioritize authenticated experience over public SEO" decision from V1 gets revisited.
- **Merchandise & payments.** Caskets, urns, flowers, and pre-need/at-need contract payment collection — likely via Wix Stores/Payments given the existing Wix relationship, wired into the `paymentStatus` field that V1 only tracks as a status, not a transaction.
- **Mobile.** The V1 UI is deliberately fixed-width/desktop-only (see [UI_COMPONENTS.md](./UI_COMPONENTS.md)); a responsive or native mobile pass is a distinct, later effort.
- **E-signature integration** for the compliance documents already being tracked (permits, authorizations, contracts) — the document service in V1 stores and audits files but does not collect signatures itself.

## Explicitly Not Planned

Nothing in this document should be read as a commitment to build any V2 item on any particular timeline. This list exists so that V1 decisions (schema shape, folder structure, what's deferred vs. rejected) can be evaluated against where the product is headed, not just where it is today.
