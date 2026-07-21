/**
 * Phase 11 (Workflow Template Architecture). A checklist item can be
 * fulfilled by an external form (JotForm today) instead of a plain
 * checkbox/field — this models that as an integration *provider*, not as
 * a hardcoded "Jotform" concept baked into domain logic. `provider` is a
 * plain string, not a fixed enum, precisely so a different organization can
 * reference a different provider (Typeform, Google Forms, ...) without any
 * domain-model or component change — only a new fixture record.
 *
 * A ChecklistItemTemplate that references one of these (via
 * externalFormIntegrationId) still resolves done/locked through the exact
 * same generic logic as any other checklist item (domain/workflow/
 * resolveChecklist.ts) — this record is display/link metadata only, never
 * a special-cased business rule.
 */
export type ExternalFormIntegration = {
  id: string;
  organizationId: string;
  provider: string; // e.g. 'jotform'
  label: string; // e.g. "JotForm intake application"
  externalFormId?: string; // provider-specific form identifier, opaque to our domain
};
