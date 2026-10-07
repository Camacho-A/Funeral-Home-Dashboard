/**
 * Manors Jotform integration (case-first architecture, 2026-09). One row
 * per organization + external form the organization has configured Solis
 * to know about. Deliberately provider-neutral — `provider` is a plain
 * string (e.g. 'jotform'), not a fixed enum, so a future provider (or a
 * future organization's different form) never requires an application-
 * code change, only a new row. Distinct from the older, dormant
 * `types/externalFormIntegration.ts` (Phase 11's checklist-item display
 * metadata, never wired to any real submission pipeline) — this is the
 * real, functional configuration behind the Jotform ↔ Solis integration.
 *
 * No Manors-specific form IDs appear anywhere else in application code —
 * every place that needs to know "which forms does this organization
 * have" reads this collection.
 */
export type ExternalFormAudience = 'family' | 'staff';

/**
 * Automated intake (2026-10). What Solis does with a submission from this
 * form — the one piece of configuration that decides whether a webhook
 * delivery may CREATE a case or may only UPDATE an existing one.
 *
 * - `'case_update'`: the historical behavior and the safe default. The
 *   submission is attached to the case its hidden link token identifies;
 *   if no link resolves, it is stored `unmatched` for staff to attach by
 *   hand. A form with this purpose can never allocate a case number.
 * - `'case_create'`: a first-call/intake form. A submission with no
 *   resolvable link token creates one new case through the normal
 *   `POST /api/cases` path.
 *
 * Deliberately a separate axis from `audience` (who fills the form in),
 * and deliberately NOT inferred from the form's label or id: giving a
 * form the power to allocate case numbers is an explicit, per-form
 * configuration decision. A config row that omits it reads as
 * `'case_update'`, so every form configured before this field existed
 * keeps behaving exactly as it did — the capable value is opt-in only.
 */
export type ExternalFormPurpose = 'case_update' | 'case_create';

export type ExternalFormConfig = {
  id: string;
  organizationId: string;
  provider: string; // 'jotform'
  externalFormId: string; // provider's own form identifier
  label: string; // e.g. "Vital Statistics"
  audience: ExternalFormAudience;
  /** See `ExternalFormPurpose`. Defaults to `'case_update'` for any row
      that predates this field — creating cases is opt-in, never implied. */
  purpose: ExternalFormPurpose;
  /** JSON-stringified Record<string, string> — provider field key (e.g.
      Jotform's `{qid}_{name}` convention) -> Solis field name. Never
      parsed/trusted as executable logic, only as a lookup table. */
  fieldMap: string;
  /**
   * Jotform hidden-field identifier correction (2026-09): a live audit of
   * both real Manors Jotforms found that Jotform's internal `name`
   * property for a hidden field is NOT reliably derived from the
   * requested display name — it can be lowercased (`solislinktoken`) or
   * an unrelated auto-generated placeholder (`input274`). `qid` (Jotform's
   * own stable numeric question identifier) is the only identifier
   * confirmed stable, matching this integration's own
   * domain/externalForms/fieldMapping.ts precedent (`FieldMapEntry.qid`).
   * Three distinct, non-interchangeable roles now exist on this type:
   *
   * - `linkTokenFieldName` (below): the LOGICAL/OUTBOUND field name used
   *   only to build the Jotform URL-prefill link
   *   (domain/externalForms/prefillUrl.ts appends it as a bare,
   *   non-qid-prefixed query parameter). Retained because prefill
   *   generation still genuinely needs it — NOT authoritative for
   *   anything inbound.
   * - `linkTokenFieldQid`: the AUTHORITATIVE inbound identifier the
   *   webhook parser uses to locate the `solisLinkToken` hidden field in
   *   a delivered submission.
   * - `webhookAuthFieldQid`: the AUTHORITATIVE inbound identifier the
   *   webhook parser uses to locate the `solisWebhookAuth` hidden field.
   *
   * Inbound parsing (domain/externalForms/parseWebhookPayload.ts) trusts
   * ONLY `linkTokenFieldQid`/`webhookAuthFieldQid`, resolved server-side
   * from this stored config — never any name found in the request itself.
   */
  linkTokenFieldName: string;
  /** Authoritative qid for the `solisLinkToken` hidden field, as a string
      (matching FieldMapEntry.qid's existing string convention) — see the
      comment above `fieldMap` for the full three-way distinction. */
  linkTokenFieldQid: string;
  /** Authoritative qid for the `solisWebhookAuth` hidden field — see the
      comment above `fieldMap` for the full three-way distinction. Never
      sourced from the request; always read from this trusted config row. */
  webhookAuthFieldQid: string;
  isEnabled: boolean;
  createdAt: string;
  updatedAt: string;
};
