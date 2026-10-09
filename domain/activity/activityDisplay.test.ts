import { describe, expect, it } from 'vitest';
import { activityActorLabel, resolveActivityDisplayDescription, resolveCaseCreatedDisplay, staffNameForCreation } from './activityDisplay';

describe('activityActorLabel (item #16 — Case Activity actor attribution)', () => {
  it('1. displays "System" for an explicitly system-generated event', () => {
    expect(activityActorLabel({ isSystemGenerated: true, actorRoleKey: null })).toBe('System');
  });

  it('2. never displays "Office" for a system-generated event, even if actorRoleKey is (incorrectly) populated', () => {
    const label = activityActorLabel({ isSystemGenerated: true, actorRoleKey: 'officeStaff' });
    expect(label).toBe('System');
    expect(label).not.toMatch(/office/i);
  });

  it('3. a real Office Staff human action is not relabeled System', () => {
    expect(activityActorLabel({ isSystemGenerated: false, actorRoleKey: 'officeStaff' })).toBe('Office Staff');
  });

  it('5. other human roles remain correctly attributed via the existing friendly role catalog', () => {
    expect(activityActorLabel({ isSystemGenerated: false, actorRoleKey: 'administrator' })).toBe('Administrator');
    expect(activityActorLabel({ isSystemGenerated: false, actorRoleKey: 'funeralDirector' })).toBe('Funeral Director');
    expect(activityActorLabel({ isSystemGenerated: false, actorRoleKey: 'dispatch' })).toBe('Dispatch');
  });

  it('resolves a pre-Phase-22 legacy role string through the existing alias table, not a second system', () => {
    expect(activityActorLabel({ isSystemGenerated: false, actorRoleKey: 'staff' })).toBe('Office Staff');
    expect(activityActorLabel({ isSystemGenerated: false, actorRoleKey: 'caseManager' })).toBe('Funeral Director');
    expect(activityActorLabel({ isSystemGenerated: false, actorRoleKey: 'owner' })).toBe('Administrator');
  });

  it('6. missing actor information is not automatically assumed to be System', () => {
    expect(activityActorLabel({ isSystemGenerated: false, actorRoleKey: null })).toBe('Unknown');
  });

  it('12. an unrecognized/custom role key falls back to the raw key rather than a raw-lookup crash or a fabricated label', () => {
    expect(activityActorLabel({ isSystemGenerated: false, actorRoleKey: 'custom-vendor-role' })).toBe('custom-vendor-role');
  });
});

/**
 * Recent Activity actor-attribution fix (2026-09). A human event now
 * prefers the employee's real `actorDisplayName` over a role label — the
 * role answers "what permissions did they have," never "who did this."
 * The role-label behavior above is preserved as the fallback tier for
 * when no name can be resolved (a genuinely legacy/unresolvable identity),
 * never as the default when a name is available.
 */
describe('activityActorLabel — actual employee name preferred over role (Recent Activity, 2026-09)', () => {
  it('1. a human event with a resolved actorDisplayName shows the actual employee name', () => {
    expect(activityActorLabel({ isSystemGenerated: false, actorRoleKey: 'administrator', actorDisplayName: 'Angelica Camacho' })).toBe(
      'Angelica Camacho',
    );
  });

  it('2/3. never falls back to the role label ("Admin"/"Administrator") when a name is available', () => {
    const label = activityActorLabel({ isSystemGenerated: false, actorRoleKey: 'administrator', actorDisplayName: 'Jane Smith' });
    expect(label).toBe('Jane Smith');
    expect(label).not.toBe('Admin');
    expect(label).not.toBe('Administrator');
  });

  it('4. different employees resolve to their own respective names', () => {
    expect(activityActorLabel({ isSystemGenerated: false, actorRoleKey: 'officeStaff', actorDisplayName: 'Jane Smith' })).toBe('Jane Smith');
    expect(activityActorLabel({ isSystemGenerated: false, actorRoleKey: 'officeStaff', actorDisplayName: 'John Doe' })).toBe('John Doe');
  });

  it('5. System is still System even when a stray actorDisplayName is present — isSystemGenerated always wins', () => {
    expect(activityActorLabel({ isSystemGenerated: true, actorRoleKey: null, actorDisplayName: 'Should Never Show' })).toBe('System');
  });

  it('a missing/failed name lookup (actorDisplayName: null) falls back to the existing role label, never "Unknown" when a role is known', () => {
    expect(activityActorLabel({ isSystemGenerated: false, actorRoleKey: 'officeStaff', actorDisplayName: null })).toBe('Office Staff');
  });

  it('9. neither a name nor a role is available — falls back to "Unknown", never invented, never System', () => {
    const label = activityActorLabel({ isSystemGenerated: false, actorRoleKey: null, actorDisplayName: null });
    expect(label).toBe('Unknown');
    expect(label).not.toBe('System');
  });

  it('an empty-string actorDisplayName is treated as "no name resolved", not rendered literally', () => {
    expect(activityActorLabel({ isSystemGenerated: false, actorRoleKey: 'administrator', actorDisplayName: '' })).toBe('Administrator');
  });
});

/**
 * Task #4 follow-up (2026-09) — Dashboard → Recent Activity was exposing a
 * document's internal UUID via document.regenerated's persisted
 * description ("Document regenerated (supersedes <uuid>)"). This function
 * is the presentation-layer safety net for already-persisted (legacy)
 * rows — services/activityService.ts#recordDocumentRegenerated no longer
 * writes the UUID into new events at all (see its own test coverage), but
 * historical Production rows cannot be rewritten, so any row of this
 * event type must render safely regardless of what its own description
 * happens to contain.
 */
describe('resolveActivityDisplayDescription (Task #4 follow-up, 2026-09)', () => {
  it('1/2/3. a document.regenerated event always displays "Document regenerated", with no UUID present, regardless of its persisted description', () => {
    const clean = resolveActivityDisplayDescription({ eventType: 'document.regenerated', description: 'Document regenerated' });
    expect(clean).toBe('Document regenerated');

    // 3. a legacy row exactly matching what staff saw in Production.
    const legacy = resolveActivityDisplayDescription({
      eventType: 'document.regenerated',
      description: 'Document regenerated (supersedes 1d13e80e-4e3b-4c1e-8052-2503785baec5)',
    });
    expect(legacy).toBe('Document regenerated');
    expect(legacy).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    expect(legacy).not.toContain('supersedes');
  });

  it('9. an ordinary event type is never rewritten — its own persisted description passes through unchanged', () => {
    expect(resolveActivityDisplayDescription({ eventType: 'case.created', description: 'Case B2026-050 created for Jane Doe' })).toBe(
      'Case B2026-050 created for Jane Doe',
    );
    expect(resolveActivityDisplayDescription({ eventType: 'payment.recorded', description: 'Payment recorded for $150.00' })).toBe(
      'Payment recorded for $150.00',
    );
  });

  it('does not use a generic UUID-stripping rule — an unrelated event type whose description happens to contain a UUID-shaped string is left untouched', () => {
    const description = 'Signature requested from Jane Doe (jane@example.com)';
    expect(resolveActivityDisplayDescription({ eventType: 'signature.requested', description })).toBe(description);
  });

  it('an unrecognized/future event type falls back to its own persisted description rather than throwing', () => {
    expect(resolveActivityDisplayDescription({ eventType: 'some.future.event.type', description: 'Something happened' })).toBe(
      'Something happened',
    );
  });
});

/**
 * Raw-field-name leak fix (2026-10). `recordCaseUpdated` persists
 * "Case updated (<field>[, <field>...])" for any field
 * `validateAndPickCaseUpdate` accepts — the original fix here only ever
 * relabeled the one exact string "Case updated (checklistState)", so
 * every OTHER field (certifierPhone included — the production example
 * that surfaced this bug) still rendered its raw camelCase key on
 * Dashboard → Recent Activity. `resolveActivityDisplayDescription` now
 * parses the "Case updated (...)" shape generically: a single curated
 * field gets its own sentence, and anything uncurated (or more than one
 * changed field at once) falls back to the safe generic "Case updated" —
 * never the raw key, never a decoded guess at an unknown field's name.
 *
 * NOTE: the two cases below ("not checklist-only" and "an unrelated
 * field") previously asserted the raw string stayed on screen unchanged —
 * that was the bug, not a guaranteed contract. Old → new:
 *   - "Case updated (decedentName, dateOfBirth)" → was left raw, now "Case updated"
 *   - "Case updated (weight)" → was left raw, now "Weight updated" (weight is curated)
 */
describe('resolveActivityDisplayDescription — "Case updated (<field>)" presentation labels', () => {
  it('renders "Case updated (checklistState)" as "Checklist updated"', () => {
    expect(resolveActivityDisplayDescription({ eventType: 'case.updated', description: 'Case updated (checklistState)' })).toBe(
      'Checklist updated',
    );
  });

  it('renders "Case updated (certifierPhone)" as "Certifier phone updated" — the production regression this fix closes', () => {
    expect(resolveActivityDisplayDescription({ eventType: 'case.updated', description: 'Case updated (certifierPhone)' })).toBe(
      'Certifier phone updated',
    );
    expect(
      resolveActivityDisplayDescription({ eventType: 'case.updated', description: 'Case updated (certifierPhone)' }),
    ).not.toContain('certifierPhone');
  });

  it('a second, independently curated field also renders its own sentence, never the raw key', () => {
    expect(resolveActivityDisplayDescription({ eventType: 'case.updated', description: 'Case updated (nextOfKinPhone)' })).toBe(
      'Next of kin phone updated',
    );
    expect(resolveActivityDisplayDescription({ eventType: 'case.updated', description: 'Case updated (weight)' })).toBe(
      'Weight updated',
    );
  });

  it('an uncurated/unknown internal field name falls back to generic "Case updated" — never the raw key', () => {
    const result = resolveActivityDisplayDescription({
      eventType: 'case.updated',
      description: 'Case updated (someUnknownInternalField)',
    });
    expect(result).toBe('Case updated');
    expect(result).not.toContain('someUnknownInternalField');
  });

  it('a multi-field update falls back to generic "Case updated" — never any raw key from the list', () => {
    const result = resolveActivityDisplayDescription({
      eventType: 'case.updated',
      description: 'Case updated (decedentName, dateOfBirth)',
    });
    expect(result).toBe('Case updated');
    expect(result).not.toContain('decedentName');
    expect(result).not.toContain('dateOfBirth');
  });

  it('an unrelated case.updated-shaped description that never matches the pattern passes through unchanged', () => {
    expect(resolveActivityDisplayDescription({ eventType: 'case.updated', description: 'Case updated' })).toBe('Case updated');
  });
});

/**
 * Creation-source attribution (2026-10). How a case entered SOLIS comes
 * from explicit structured metadata on the event, never from the actor
 * name and never by pattern-matching the description.
 */
describe('resolveCaseCreatedDisplay', () => {
  const SNAPSHOT = JSON.stringify({ caseNumber: 'B2026-037', decedentName: 'ANGELICA CAMACHO' });

  function event(overrides: Record<string, unknown> = {}) {
    return {
      eventType: 'case.created',
      description: 'Case B2026-037 created for ANGELICA CAMACHO',
      newValue: SNAPSHOT,
      metadata: null,
      ...overrides,
    } as never;
  }

  it('1. automatic JotForm creation reads "created via JotForm", with decedent and form name beneath', () => {
    const d = resolveCaseCreatedDisplay(
      event({ metadata: JSON.stringify({ source: 'external_form_webhook', formLabel: 'Manors First Call Sheet' }) }),
      null,
    );
    expect(d).toEqual({
      primary: 'Case B2026-037 created via JotForm',
      secondary: 'ANGELICA CAMACHO · Manors First Call Sheet',
    });
  });

  it('2. manual creation names the staff member who created it', () => {
    const d = resolveCaseCreatedDisplay(
      event({ metadata: JSON.stringify({ source: 'staff' }) }),
      'Dana Whitfield',
    );
    expect(d).toEqual({ primary: 'Case B2026-037 created by Dana Whitfield', secondary: 'ANGELICA CAMACHO' });
  });

  it('3. a manual import reads "imported from JotForm" — never "created via"', () => {
    const d = resolveCaseCreatedDisplay(
      event({ metadata: JSON.stringify({ source: 'external_form_import', formLabel: 'Manors Cremation Arrangement Forms' }) }),
      'Dana Whitfield',
    );
    expect(d!.primary).toBe('Case B2026-037 imported from JotForm');
    expect(d!.primary).not.toContain('created via');
    expect(d!.secondary).toBe('ANGELICA CAMACHO · Manors Cremation Arrangement Forms');
  });

  it('a webhook creation is never described as an import', () => {
    const d = resolveCaseCreatedDisplay(
      event({ metadata: JSON.stringify({ source: 'external_form_webhook', formLabel: 'Manors First Call Sheet' }) }),
      null,
    );
    expect(d!.primary).not.toContain('imported');
  });

  it('4. a missing actor degrades to "created" — no identity is ever invented, and never "Unknown"', () => {
    const d = resolveCaseCreatedDisplay(event({ metadata: JSON.stringify({ source: 'staff' }) }), null);
    expect(d!.primary).toBe('Case B2026-037 created');
    expect(d!.primary).not.toContain('Unknown');
  });

  it('5. the form name comes from the event itself, so a later rename cannot rewrite history', () => {
    const d = resolveCaseCreatedDisplay(
      event({ metadata: JSON.stringify({ source: 'external_form_webhook', formLabel: 'First Call Sheet' }) }),
      null,
    );
    expect(d!.secondary).toContain('First Call Sheet');
  });

  it('omits the form name cleanly when the event did not capture one', () => {
    const d = resolveCaseCreatedDisplay(event({ metadata: JSON.stringify({ source: 'external_form_webhook' }) }), null);
    expect(d!.secondary).toBe('ANGELICA CAMACHO');
  });

  it('6. a historical event with no source metadata returns null so the caller falls back unchanged', () => {
    expect(resolveCaseCreatedDisplay(event(), 'Dana Whitfield')).toBeNull();
  });

  it('malformed or unrecognized metadata falls back rather than guessing', () => {
    for (const metadata of ['not json', '{}', '[]', 'null', JSON.stringify({ source: 'telepathy' })]) {
      expect(resolveCaseCreatedDisplay(event({ metadata }), 'Dana'), metadata).toBeNull();
    }
  });

  it('a missing or malformed identifying snapshot falls back rather than rendering a partial line', () => {
    const meta = JSON.stringify({ source: 'staff' });
    for (const newValue of [null, 'not json', '{}', JSON.stringify({ caseNumber: 'B2026-037' })]) {
      expect(resolveCaseCreatedDisplay(event({ metadata: meta, newValue }), 'Dana')).toBeNull();
    }
  });

  it('never applies to a different event type', () => {
    expect(
      resolveCaseCreatedDisplay(
        event({ eventType: 'case.updated', metadata: JSON.stringify({ source: 'staff' }) }),
        'Dana',
      ),
    ).toBeNull();
  });

  it('7. a deleted case still renders from the event\'s own snapshot — no case lookup involved', () => {
    // The identifying snapshot is captured on the event at creation time,
    // so a historical event survives its case being deleted and is never
    // re-associated by case number with a later case that reuses it.
    const d = resolveCaseCreatedDisplay(
      event({ metadata: JSON.stringify({ source: 'external_form_webhook', formLabel: 'Manors First Call Sheet' }) }),
      null,
    );
    expect(d!.primary).toContain('B2026-037');
    expect(d!.secondary).toContain('ANGELICA CAMACHO');
  });
});

describe('staffNameForCreation', () => {
  it('returns null for a system-generated event, so no actor is shown', () => {
    expect(staffNameForCreation({ isSystemGenerated: true, actorRoleKey: null, actorDisplayName: null })).toBeNull();
  });

  it('returns null rather than "Unknown" when the actor cannot be resolved', () => {
    expect(staffNameForCreation({ isSystemGenerated: false, actorRoleKey: null, actorDisplayName: null })).toBeNull();
  });

  it('returns the resolved display name for a real staff actor', () => {
    expect(
      staffNameForCreation({ isSystemGenerated: false, actorRoleKey: 'admin', actorDisplayName: 'Dana Whitfield' }),
    ).toBe('Dana Whitfield');
  });
});
