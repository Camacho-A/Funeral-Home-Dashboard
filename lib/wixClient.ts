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
 * (a documented, deliberate scope decision for this phase).
 *
 * Only the `siteProperties` module is wired in — enough for the
 * connectivity health check this phase adds, and nothing else. No
 * Data/CMS module is included; "do not create the full production data
 * schema yet" applies to what this client can even call, not just to
 * what collections exist.
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
