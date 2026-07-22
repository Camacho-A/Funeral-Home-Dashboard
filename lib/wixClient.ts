/**
 * Phase 12 (Wix Project Foundation). The one server-side Wix SDK client
 * factory for the whole app, per docs/ARCHITECTURE.md's `lib/` role
 * ("low-level client setup... services/ is built on top of lib/, not the
 * other way around").
 *
 * SECURITY BOUNDARY: this module reads WIX_API_KEY (a secret) via
 * lib/env.ts's getWixServerConfig(). It must only ever be imported from
 * server-side code — today, exclusively app/api/wix-health/route.ts.
 * Next.js Route Handlers never ship to the browser bundle regardless of
 * what they import, which is the structural guarantee this relies on; do
 * not import this file from any Client Component, any hook a Client
 * Component uses, or any module reachable from either. See
 * docs/WIX_INTEGRATION.md's "Security boundary" section for the full
 * reasoning, including why the `server-only` npm package wasn't added
 * (a documented, deliberate scope decision carried forward from Phase 12).
 *
 * Only the `siteProperties` module is wired in. Phase 15A (Wix
 * Organization Read Integration) needed to read the `organizations` Data
 * collection too, but installing `@wix/data` and adding its `items` module
 * here reproducibly crashes at createClient() construction time —
 * `@wix/sdk@1.21.13`'s internal `isAmbassadorModule()` check throws inside
 * `@wix/sdk-runtime`'s `wql-builder-utils.js` when probing that module,
 * independent of dependency deduping (confirmed with a single, deduped
 * `@wix/sdk-runtime` version — still crashes). This is a genuine upstream
 * compatibility bug between these package versions, not a query-shape
 * issue. Phase 15A's organization read therefore calls the Wix Data REST
 * API directly (authenticated fetch, see
 * app/api/organizations/[organizationId]/route.ts) instead of going
 * through this SDK client — the same REST endpoints already proven
 * reliable via curl in Phases 14A/14B. Revisit adding `items` here once a
 * compatible `@wix/sdk`/`@wix/data` version pairing exists.
 */
import { createClient, ApiKeyStrategy } from '@wix/sdk';
import { siteProperties } from '@wix/business-tools';
import { getWixServerConfig } from './env';

export function createWixServerClient() {
  const { apiKey, siteId } = getWixServerConfig();

  return createClient({
    modules: { siteProperties },
    auth: ApiKeyStrategy({ apiKey, siteId }),
  });
}
