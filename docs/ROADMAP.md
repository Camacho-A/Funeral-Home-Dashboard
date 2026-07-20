# Roadmap

## Version 1 — Case Operations (current)

Scope: the four screens visualized in `design/Beacon.dc.html` — Dashboard, Case Detail, Tasks, Reports — backed by Wix Managed Headless for operational data and a small Postgres/object-storage service for compliance documents and the audit trail. Single tenant (Managed Cremations), architected for multi-tenancy from day one. See [PRODUCT_VISION.md](./PRODUCT_VISION.md) for full scope and [ARCHITECTURE.md](./ARCHITECTURE.md) for the technical shape.

Notably, the Reports screen's org switcher in the current design already lists a second, disabled entry — "Gus Camacho Funeral Home — coming soon" — meaning the visual design itself was built anticipating that Beacon would serve more than one funeral home. That expectation is honored structurally (via `organizationId` on every record) well before it's honored functionally.

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
