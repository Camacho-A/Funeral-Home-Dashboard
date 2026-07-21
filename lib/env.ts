/**
 * Phase 12 (Wix Project Foundation). Validated access to environment
 * variables that control the data adapter and Wix connectivity — see
 * docs/WIX_INTEGRATION.md for the full environment reference and
 * docs/adr/ADR-007-wix-integration-foundation.md for why this shape.
 *
 * Every function here reads `process.env` lazily, at call time, never at
 * module load — this is what lets `next build` succeed with zero Wix
 * environment variables set as long as DATA_ADAPTER stays at its "mock"
 * default. Nothing in this file is imported by any Client Component; it's
 * meant to be read only from server-side code (Route Handlers today,
 * Server Components/Actions in future phases).
 */

export type DataAdapterMode = 'mock' | 'wix';

/**
 * Which backend the app is configured to use. Defaults to "mock" — the
 * only mode that exists as a real, working implementation today (Phases
 * 0-11's fixture-backed services). "wix" is the foundation this phase
 * establishes for later phases to build on; no service actually branches
 * on this value yet (see docs/adr/ADR-007's "Consequences").
 */
export function getDataAdapterMode(): DataAdapterMode {
  const raw = (process.env.DATA_ADAPTER ?? 'mock').trim().toLowerCase();
  if (raw !== 'mock' && raw !== 'wix') {
    throw new Error(
      `Invalid DATA_ADAPTER value "${process.env.DATA_ADAPTER}" — must be "mock" or "wix". See docs/WIX_INTEGRATION.md.`,
    );
  }
  return raw;
}

export type WixServerConfig = {
  apiKey: string;
  siteId: string;
};

/**
 * Site-level credentials for a self-managed Wix Headless API Key client
 * (see lib/wixClient.ts). Deliberately only validated when actually
 * needed — called from inside a Wix-mode code path, never at module load
 * — so mock mode (the default) never requires these to be set, and
 * `next build` succeeds with no Wix credentials present at all.
 *
 * Throws a single, clear error naming every missing variable, rather than
 * letting the Wix SDK fail later with a less legible auth error — this is
 * the "Wix mode fails cleanly and clearly when required configuration is
 * missing" requirement.
 */
export function getWixServerConfig(): WixServerConfig {
  const apiKey = process.env.WIX_API_KEY;
  const siteId = process.env.WIX_SITE_ID;

  const missing: string[] = [];
  if (!apiKey) missing.push('WIX_API_KEY');
  if (!siteId) missing.push('WIX_SITE_ID');

  if (missing.length > 0) {
    throw new Error(
      `DATA_ADAPTER=wix requires the following environment variable(s), which are not set: ${missing.join(', ')}. ` +
        'Set them in .env.local (see .env.example and docs/WIX_INTEGRATION.md), or set DATA_ADAPTER back to "mock".',
    );
  }

  return { apiKey: apiKey!, siteId: siteId! };
}
