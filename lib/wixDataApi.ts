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

type WixDataItem<Item> = { id: string; dataCollectionId: string; data: Item };

function wixDataHeaders(apiKey: string, siteId: string) {
  return {
    'Content-Type': 'application/json',
    Authorization: apiKey,
    'wix-site-id': siteId,
  };
}

/**
 * Phase 16 (Wix Write Integration). Inserts a new item. `itemId`, if
 * given, becomes the Wix item's own system `_id` — see
 * docs/WIX_DATA_SCHEMA.md's "Known limitations": `cases` (and, for the
 * same reason, `tasks`) deliberately set `_id` to their own
 * `beaconCaseId`/`beaconTaskId` at insert time, so a later single-record
 * lookup can use Wix's own system index on `_id` (via queryWixDataItems's
 * filter, or a direct id-scoped call) rather than needing a 4th collection
 * index Wix Data doesn't allow. Callers still always re-verify tenant
 * ownership via a `{beaconXId, organizationId}` query before update/delete
 * rather than assuming this convention holds for every record.
 */
export async function insertWixDataItem<Item = Record<string, unknown>>(
  dataCollectionId: string,
  data: Item,
  itemId?: string,
): Promise<WixDataItem<Item>> {
  const { apiKey, siteId } = getWixServerConfig();

  const response = await fetch('https://www.wixapis.com/wix-data/v2/items', {
    method: 'POST',
    headers: wixDataHeaders(apiKey, siteId),
    body: JSON.stringify({
      dataCollectionId,
      dataItem: itemId ? { id: itemId, data } : { data },
    }),
  });

  if (!response.ok) {
    throw new Error(`Wix Data insert failed for collection "${dataCollectionId}" (HTTP ${response.status}).`);
  }

  const body = await response.json();
  return body.dataItem;
}

/**
 * Full-replace update (Wix's `updateDataItem`, PUT) — per Wix's own docs,
 * "after an item is updated, it only contains the fields included in the
 * payload... fields not included, their values are lost." Every caller of
 * this function must therefore pass the item's *complete* merged data
 * (existing fields + the allowlisted patch applied), never a bare partial
 * patch — see lib/wixCaseMapper.ts's/lib/wixTaskMapper.ts's
 * applyCaseUpdateToWixData/applyTaskUpdateToWixData, which build that
 * merged object. `wixItemId` is the Wix system `_id` (resolved via a prior
 * queryWixDataItems call, which also serves as the tenant-ownership
 * check), never a raw client-supplied value.
 */
export async function updateWixDataItem<Item = Record<string, unknown>>(
  dataCollectionId: string,
  wixItemId: string,
  data: Item,
): Promise<WixDataItem<Item>> {
  const { apiKey, siteId } = getWixServerConfig();

  const response = await fetch(
    `https://www.wixapis.com/wix-data/v2/items/${encodeURIComponent(wixItemId)}?dataCollectionId=${encodeURIComponent(dataCollectionId)}`,
    {
      method: 'PUT',
      headers: wixDataHeaders(apiKey, siteId),
      body: JSON.stringify({ dataItem: { id: wixItemId, data } }),
    },
  );

  if (!response.ok) {
    throw new Error(`Wix Data update failed for collection "${dataCollectionId}" (HTTP ${response.status}).`);
  }

  const body = await response.json();
  return body.dataItem;
}

export async function deleteWixDataItem(dataCollectionId: string, wixItemId: string): Promise<void> {
  const { apiKey, siteId } = getWixServerConfig();

  const response = await fetch(
    `https://www.wixapis.com/wix-data/v2/items/${encodeURIComponent(wixItemId)}?dataCollectionId=${encodeURIComponent(dataCollectionId)}`,
    {
      method: 'DELETE',
      headers: wixDataHeaders(apiKey, siteId),
    },
  );

  if (!response.ok) {
    throw new Error(`Wix Data delete failed for collection "${dataCollectionId}" (HTTP ${response.status}).`);
  }
}
