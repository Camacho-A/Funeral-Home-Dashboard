# Architecture Decision Records

Lightweight ADR log. Each entry: the decision, why it was made, and what it rules out. New entries are appended, never rewritten — if a decision is reversed, a new entry supersedes the old one and says so explicitly.

---

## ADR-001: Wix Managed Headless for operational data; a separate Postgres/object-storage service for compliance documents and the audit trail

**Decision**: Case, contact, task, and staff-profile data lives in Wix Data Collections, accessed via the Wix Headless SDK. Wix Members provides staff login/session. Compliance-sensitive documents (death certificates, cremation permits, signed authorizations/contracts) and the audit log live in a small dedicated Postgres database plus S3-compatible object storage, not in Wix.

**Why**: The client explicitly wants a Wix-managed backend to minimize custom infrastructure. Wix Data is a reasonable fit for case/contact/task data. It is not, however, built for the retention guarantees, access auditing, and querying that regulated documents eventually need. Splitting the two keeps the simple majority of the app on Wix's managed infrastructure while giving the compliance-sensitive minority a purpose-built, auditable home.

**Rules out**: Storing regulated documents as Wix Data attachments/media; building a fully custom backend for everything (rejected as unnecessary given the client's stated preference for Wix).

See [ARCHITECTURE.md](./ARCHITECTURE.md), [CMS_SCHEMA.md](./CMS_SCHEMA.md).

---

## ADR-002: Tenant isolation via `organizationId` on every record, from Version 1, even though V1 has exactly one tenant

**Decision**: Every Wix Data collection item and every Postgres row carries an `organizationId` field. Every service function requires it as an argument, sourced only from the authenticated session. Version 1 hardcodes a single organization id and builds no multi-tenant management UI.

**Why**: The client wants Beacon to become a multi-tenant SaaS product, but wants V1 kept as simple as a single-tenant app. Baking the field in now, and scoping every query by it structurally rather than by convention, means the second funeral home can be onboarded later without a schema migration or a retrofit of query logic — the risk of "we'll add tenant scoping later" silently leaking data across tenants is eliminated by never allowing the code to be written without it in the first place.

**Rules out**: Adding `organizationId` later as a migration; per-tenant Wix site provisioning (deferred — a real decision for the multi-tenant roadmap item, not V1).

See [ARCHITECTURE.md](./ARCHITECTURE.md), [ROADMAP.md](./ROADMAP.md).

---

## ADR-003: Wix Members for identity; app-owned `StaffProfiles.role` for authorization

**Decision**: Staff log in through Wix Members. Wix's own member roles are not used for authorization. A `StaffProfiles` Wix Data collection, keyed 1:1 to a Wix Member, carries the app-specific role (`admin` / `funeral_director` / `staff`) and `organizationId`. All RBAC decisions read from `StaffProfiles`, not from Wix.

**Why**: A second, parallel identity system (e.g. NextAuth with its own user table) would create two sources of truth for "who is this person," adding exactly the kind of complexity the client asked to avoid for V1. Wix's built-in roles are too coarse for the director/staff/admin distinction Beacon needs, so identity and authorization are deliberately separated: Wix owns "who," Beacon owns "what they can do."

**Rules out**: A parallel auth stack independent of Wix; relying on Wix's native member roles for page/action gating.

See [ARCHITECTURE.md](./ARCHITECTURE.md), [USER_ROLES.md](./USER_ROLES.md).

---

## ADR-004: The exported design (`design/Beacon.dc.html` + `design/support.js`) is treated as an immutable visual and business-logic specification, not application code

**Decision**: The design files are copied into `design/` and never edited or imported into the running Next.js application. `support.js` (dc-runtime, the prototyping tool's template engine) is not ported — only its output (the visual design and the embedded business logic in the `Component` script) is used as a specification, re-implemented as plain React/TypeScript.

**Why**: The design file is the client's visual source of truth and, incidentally, also encodes real domain rules (stages, checklists, SLA targets, veteran/VA workflow) that would otherwise have to be re-derived from scratch. Treating it as an immutable reference — rather than editing it in place or trying to run it inside the app — keeps a stable ground truth to check the real implementation against, and avoids taking a dependency on a prototyping tool that was never meant for production use.

**Rules out**: Modifying the design files directly; rendering the app via `dc-runtime` in production.

See [BUSINESS_RULES.md](./BUSINESS_RULES.md), [UI_COMPONENTS.md](./UI_COMPONENTS.md).
