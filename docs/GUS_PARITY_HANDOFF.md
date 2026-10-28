# Gus Camacho SOLIS — feature-parity handoff

Fixes and features built for Manors SOLIS that Gus SOLIS should adopt,
adapted to Gus's own intake forms and data model. Nothing here changes Gus
SOLIS; each entry says what to carry over and what must be Gus-specific.

## Next of Kin relationship from intake forms (2026-10)

**Problem it solved (Manors).** The Next of Kin relationship came into SOLIS
blank even though the Arrangement Form collects it. Manors cases are created
from the First Call Sheet, which has no relationship question; the
Arrangement Form that arrives later carried the relationship, but it only
reached the case if staff opened the form review and pressed Apply. Every
live Manors relationship had been chosen by hand. A newer form option
("Legal Representative" on qid 225) was also silently dropped.

**How it works now (Manors).**
- `domain/externalForms/arrangementNokDerivation.ts` derives the Next of Kin
  from the form (qid 276 Yes → Informant qids 122/224/225; No → qids
  277/278/279), maps the relationship through an exact option table
  (`ARRANGEMENT_NOK_RELATIONSHIP_VALUE_MAP`), and keeps the submitted text as
  `nextOfKinRelationshipSource`.
- `domain/externalForms/nokRelationshipAutofill.ts` decides: fill only a
  blank relationship, only with an exact option, only when the form's Next of
  Kin is the same person as the case's (name compared ignoring capitals,
  spacing and punctuation). Otherwise keep (never overwrite) or flag for
  review (unknown value / different person / no contact) — never guess.
- `services/externalForms/nokRelationshipAutofillService.ts` writes only
  `nextOfKinRelationship`, revision-safe, re-checking the row it writes; runs
  after every path that attaches an Arrangement Form (webhook, Unmatched
  Forms link/create, historical import). Audit: `external_form.fields_applied`
  or `external_form.nok_relationship_review`.

**For Gus.**
- Reuse the decision function and the service unchanged.
- Gus needs its OWN mapping: its forms' qids, its own option lists (audit the
  live forms' dropdown options — they drift), and its own map onto
  `NextOfKinRelationship`. Never share Manors' qids (see the warning in
  `fieldMapping.ts` about colliding qid numbers across forms).
- Call the service from whichever Gus intake path carries the relationship
  (form role in `formRegistry.ts`).
