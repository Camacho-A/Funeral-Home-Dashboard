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

/**
 * Phase 16B (Case Number Generation): a thrown Error subclass carrying the
 * real HTTP status, additive to every function below's pre-existing
 * "Wix Data X failed for collection... (HTTP NNN)" message (so old
 * `.rejects.toThrow(/regex/)` test assertions against that message keep
 * working unchanged). lib/wixCaseNumberSequence.ts's reserveNextCaseNumber
 * needs to reliably tell "the sequence row doesn't exist yet" (404) apart
 * from "another request just created it first" (409) apart from a genuine
 * failure — checking `error.status` is more robust than string-matching
 * the message.
 */
export class WixDataApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'WixDataApiError';
    this.status = status;
  }
}

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
    throw new WixDataApiError(
      `Wix Data query failed for collection "${dataCollectionId}" (HTTP ${response.status}).`,
      response.status,
    );
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
    throw new WixDataApiError(
      `Wix Data insert failed for collection "${dataCollectionId}" (HTTP ${response.status}).`,
      response.status,
    );
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
    throw new WixDataApiError(
      `Wix Data update failed for collection "${dataCollectionId}" (HTTP ${response.status}).`,
      response.status,
    );
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
    throw new WixDataApiError(
      `Wix Data delete failed for collection "${dataCollectionId}" (HTTP ${response.status}).`,
      response.status,
    );
  }
}

/**
 * Phase 16B (Case Number Generation). Atomically increments a numeric
 * field on an existing item via Wix's `patchDataItem` INCREMENT_FIELD
 * action — the "concurrency-safe mechanism" this feature's uniqueness
 * requirement calls for, confirmed empirically (not assumed) against the
 * live Wix project: two concurrent increments on the same item never lose
 * an update, and a patch against a nonexistent item fails with HTTP 404
 * (`WDE0073`), which lib/wixCaseNumberSequence.ts relies on to detect
 * "this is the first claim of the year" and fall back to an insert. Only
 * ever call this on a row a caller intends to use as an atomic counter
 * (see docs/adr/ADR-018-case-number-generation.md) — it is not a general
 * partial-update mechanism the way updateWixDataItem's full-replace is.
 */
export async function incrementWixDataField<Item = Record<string, unknown>>(
  dataCollectionId: string,
  wixItemId: string,
  fieldPath: string,
  incrementBy: number,
): Promise<WixDataItem<Item>> {
  const { apiKey, siteId } = getWixServerConfig();

  const response = await fetch(
    `https://www.wixapis.com/wix-data/v2/items/${encodeURIComponent(wixItemId)}`,
    {
      method: 'PATCH',
      headers: wixDataHeaders(apiKey, siteId),
      body: JSON.stringify({
        dataCollectionId,
        patch: {
          dataItemId: wixItemId,
          fieldModifications: [
            { fieldPath, action: 'INCREMENT_FIELD', incrementFieldOptions: { value: incrementBy } },
          ],
        },
      }),
    },
  );

  if (!response.ok) {
    throw new WixDataApiError(
      `Wix Data increment failed for collection "${dataCollectionId}" (HTTP ${response.status}).`,
      response.status,
    );
  }

  const body = await response.json();
  return body.dataItem;
}
