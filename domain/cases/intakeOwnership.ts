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
