import { createHash, timingSafeEqual } from 'crypto';
import { NextResponse } from 'next/server';
import { getDeploymentOrganizationIds } from '@/lib/env';

/**
 * Scheduled-job isolation (2026-10). The one shared gate in front of every
 * `app/api/cron/*` Route Handler — see docs/SCHEDULED_JOBS.md.
 *
 * - Vercel Cron issues a GET with `Authorization: Bearer $CRON_SECRET`
 *   (vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs), so
 *   every cron route exports GET; POST stays for manual triggering. Both go
 *   through this exact check.
 * - `CRON_SECRET` unset → 503, never an unauthenticated sweep.
 * - The bearer comparison is constant-time: both sides are SHA-256 hashed
 *   first so `timingSafeEqual` always compares equal-length buffers and the
 *   secret's length is never leaked through an early length mismatch.
 * - The deployment organization scope is resolved before any sweep runs: in
 *   production on Wix data `getDeploymentOrganizationIds()` throws when
 *   `DEPLOYMENT_ORGANIZATION_IDS` is unset, and a sweep must never fall back
 *   to processing every tenant — that becomes a 503 here.
 *
 * `_lib` is a Next.js private folder — never routable.
 */

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

export function isAuthorizedCronRequest(request: Request, secret: string): boolean {
  const header = request.headers.get('authorization');
  if (!header) return false;
  return timingSafeEqual(digest(header), digest(`Bearer ${secret}`));
}

/** Returns an error response when the request must not run the sweep, else null. */
export function rejectUnauthorizedCronRequest(request: Request): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'CRON_SECRET is not configured.' }, { status: 503 });
  }
  if (!isAuthorizedCronRequest(request, secret)) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }
  try {
    getDeploymentOrganizationIds();
  } catch (error) {
    console.error('Scheduled job refused — deployment organization scope is not configured:', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: 'Deployment organization scope is not configured.' }, { status: 503 });
  }
  return null;
}

/** Wraps a sweep into one route handler (Manors: exported as POST only — see docs/SCHEDULED_JOBS.md). */
export function cronHandler(runSweep: () => Promise<unknown>): (request: Request) => Promise<NextResponse> {
  return async (request: Request) => {
    const rejection = rejectUnauthorizedCronRequest(request);
    if (rejection) return rejection;
    const result = await runSweep();
    return NextResponse.json({ result });
  };
}
