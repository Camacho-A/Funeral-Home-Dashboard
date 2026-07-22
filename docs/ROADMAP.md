# Roadmap

## Version 1 — Case Operations (current)

Scope: the four screens visualized in `design/Beacon.dc.html` — Dashboard, Case Detail, Tasks, Reports — backed by Wix Managed Headless for operational data and a small Postgres/object-storage service for compliance documents and the audit trail. Single tenant (Managed Cremations), architected for multi-tenancy from day one. See [PRODUCT_VISION.md](./PRODUCT_VISION.md) for full scope and [ARCHITECTURE.md](./ARCHITECTURE.md) for the technical shape.

Notably, the Reports screen's org switcher in the current design already lists a second, disabled entry — "Gus Camacho Funeral Home — coming soon" — meaning the visual design itself was built anticipating that Beacon would serve more than one funeral home. That expectation is honored structurally (via `organizationId` on every record) well before it's honored functionally.

## Planned: Multi-Tenant Authorization Hardening (dedicated phase, before/alongside Phase 16)

**Status: identified, not yet scheduled or started.** Recorded during Phase 15B's final review — see [ADR-012](./adr/ADR-012-wix-workflow-template-read-integration.md)'s review findings and `docs/AUTHENTICATION.md`'s "Known limitations."

**The gap:** none of the Route Handlers introduced by the Wix read integrations verify that the `organizationId` in the request actually belongs to the caller's authenticated session. Today this affects:
- `app/api/organizations/[organizationId]/route.ts` (Phase 15A)
- `app/api/workflow-templates/route.ts` and `app/api/workflow-templates/[templateId]/route.ts` (Phase 15B)

Each route reads `organizationId` from the URL and uses it directly to scope its Wix/mock query. Inside the app this is safe today — the value always originates from `useOrganization()`, which is itself session-derived (`resolveAuthorizationContext()`, Phase 13) — but as public HTTP endpoints, any authenticated session (for any organization) could call these routes directly with a different `organizationId` and receive that other organization's data. This is a direct gap against the project's own foundational rule from Phase 13: "never trust organizationId supplied by the browser as proof of authorization." It was not introduced by Phase 15B — Phase 15A's route had the identical shape first — but Phase 15B extended the same unverified pattern to a second endpoint rather than closing it, and every future read/write route (cases, tasks, staff, and any Phase 16 write endpoints) would otherwise inherit it again by default.

**Why it's deferred rather than fixed inline:** closing it properly means adding a session/membership check inside every affected route — real, if small, changes to authentication-adjacent code, spanning multiple already-committed phases (15A and 15B together), which is why it wasn't folded into either phase's own review.

**Recommended scope for the dedicated phase:**
- A single, reusable server-side helper (e.g. `requireAuthorizedOrganization(request, organizationId)`) that re-derives the caller's authorized organization(s) from their session (`getSession()` + `resolveAuthorizationContext()`, both already used in `app/(portal)/layout.tsx`) and rejects the request (403 or equivalent) if the requested `organizationId` isn't one the session is actually authorized for.
- Applied to `app/api/organizations/[organizationId]/route.ts` and both `app/api/workflow-templates` routes retroactively.
- Adopted as the required pattern for every future API route this project adds (cases, tasks, staff, and Phase 16's write endpoints) — ideally documented as a checklist item in `docs/API_SPEC.md` or `docs/ARCHITECTURE.md` so it's not rediscovered per-route.
- Test coverage proving a session for organization A cannot read organization B's data through any of these routes by supplying B's `organizationId` directly (distinct from the existing tests, which only prove the *query itself* is org-scoped, not that the *caller* is entitled to ask for that org at all).

**Sequencing note:** recommended before or alongside Phase 16 (write integration) rather than after — writes reachable through the same unverified pattern would make cross-tenant exposure worse (mutation, not just configuration disclosure), not better.

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
