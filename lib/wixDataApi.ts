import { getWixServerConfig } from './env';

/**
 * Phase 15A (Wix Organization Read Integration). Direct Wix Data REST API
 * access — used instead of `@wix/data`'s SDK module because that module
 * reproducibly crashes at Wix client construction time when combined with
 * the installed `@wix/sdk` version (see lib/wixClient.ts's comment for the
 * full explanation). These are the same REST endpoints already proven
 * reliable via curl in Phases 14A/14B, called here with `fetch` instead.
 *
 * SECURITY BOUNDARY: reads WIX_API_KEY (a secret) via
 * lib/env.ts's getWixServerConfig(). Same rule as lib/wixClient.ts — only
 * ever import this from server-side code (Route Handlers today), never
 * from a Client Component or anything it imports.
 */

type WixDataQueryRequest = {
  filter?: Record<string, unknown>;
  paging?: { limit?: number; offset?: number };
};

type WixDataQueryResponse<Item> = {
  dataItems: Array<{ id: string; dataCollectionId: string; data: Item }>;
};

export async function queryWixDataItems<Item = Record<string, unknown>>(
  dataCollectionId: string,
  query: WixDataQueryRequest,
): Promise<WixDataQueryResponse<Item>> {
  const { apiKey, siteId } = getWixServerConfig();

  const response = await fetch('https://www.wixapis.com/wix-data/v2/items/query', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: apiKey,
      'wix-site-id': siteId,
    },
    body: JSON.stringify({ dataCollectionId, query }),
  });

  if (!response.ok) {
    throw new Error(`Wix Data query failed for collection "${dataCollectionId}" (HTTP ${response.status}).`);
  }

  return response.json();
}
