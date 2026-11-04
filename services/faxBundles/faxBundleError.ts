/** A fax-bundle refusal with the HTTP status a route returns and, where it
    concerns specific cases, each case's reason (shown next to that case). */
export class FaxBundleError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly caseProblems: ReadonlyArray<{ caseId: string; reason: string }> = [],
  ) {
    super(message);
    this.name = 'FaxBundleError';
  }
}
