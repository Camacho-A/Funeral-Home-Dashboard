/**
 * intakeOwnerId (the staff member who took the intake call) is set exactly
 * once, automatically, from the trusted session at case creation — see
 * casesService.create and types/case.ts's field comment. It's never
 * reassignable afterward, unlike assignedStaffId (the current case handler,
 * which CaseInformationCard's owner select changes freely).
 *
 * types/case.ts's CaseUpdate type already omits intakeOwnerId, which stops
 * any code written against our own types from including it in a patch. This
 * function is the runtime backstop for what the type system can't catch:
 * an `as any`/`as unknown` escape hatch, or a future caller that isn't
 * TypeScript at all (e.g. a real backend's own request validation, once
 * this stops being a mock). services/casesService.ts's update() calls this
 * on every patch before applying it.
 */
export function assertIntakeOwnerUnchanged(patch: unknown): void {
  if (patch !== null && typeof patch === 'object' && 'intakeOwnerId' in patch) {
    throw new Error('intakeOwnerId cannot be changed after a case is created');
  }
}

/**
 * Phase 30 (Identity Model Hardening & Staff Assignment Unification).
 * `createdBy` (the `StaffProfile.id` of whoever opened the case) has always
 * been immutable in practice — `CaseUpdate`'s own type already omits it,
 * so no code written against our own types can include it in a patch — but
 * unlike `intakeOwnerId`, it never had a runtime backstop for the same
 * `as any`/non-TypeScript-caller escape hatch `assertIntakeOwnerUnchanged`
 * exists for above. This closes that gap using the identical pattern.
 * `services/casesService.ts`'s `update()` calls this on every patch
 * alongside `assertIntakeOwnerUnchanged`/`assertCaseNumberUnchanged`.
 */
export function assertCreatedByUnchanged(patch: unknown): void {
  if (patch !== null && typeof patch === 'object' && 'createdBy' in patch) {
    throw new Error('createdBy cannot be changed after a case is created');
  }
}
