/**
 * In-memory stand-in for the Wix Data REST API (performance phase 1,
 * 2026-10), installed as `globalThis.fetch`. Lets auth/permission tests run
 * the real DATA_ADAPTER=wix code paths end to end and measure exactly how
 * many Wix round-trips a request makes, and how many of them have to wait
 * for an earlier one ("waves"): a call that starts while no other call is
 * in flight begins a new wave, so `waves` is the number of sequential
 * round-trips a request pays for, and `calls` is the total load on Wix.
 *
 * Supports exactly the request shapes lib/wixDataApi.ts sends: query (with
 * equality filters and cursor paging), insert, update (PUT) and delete.
 */
type Row = { id: string; data: Record<string, unknown> };

export type WixCall = {
  method: string;
  collection: string;
  filter?: Record<string, unknown>;
  wave: number;
};

export class FakeWix {
  readonly collections = new Map<string, Row[]>();
  calls: WixCall[] = [];
  private inFlight = 0;
  private wave = 0;

  constructor(private readonly latencyMs = 5) {}

  rows(collection: string): Row[] {
    let rows = this.collections.get(collection);
    if (!rows) {
      rows = [];
      this.collections.set(collection, rows);
    }
    return rows;
  }

  insert(collection: string, id: string, data: Record<string, unknown>): void {
    this.rows(collection).push({ id, data: { ...data } });
  }

  find(collection: string, predicate: (data: Record<string, unknown>) => boolean): Row | undefined {
    return this.rows(collection).find((row) => predicate(row.data));
  }

  resetCounts(): void {
    this.calls = [];
    this.wave = 0;
  }

  get callCount(): number {
    return this.calls.length;
  }

  get waves(): number {
    return this.wave;
  }

  readonly fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    );
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = init?.body ? JSON.parse(String(init.body)) : {};

    if (this.inFlight === 0) this.wave += 1;
    this.inFlight += 1;
    try {
      await new Promise((resolve) => setTimeout(resolve, this.latencyMs));
      return this.handle(url, method, body);
    } finally {
      this.inFlight -= 1;
    }
  };

  private handle(url: URL, method: string, body: Record<string, unknown>): Response {
    const path = url.pathname;
    const record = (collection: string, filter?: Record<string, unknown>) =>
      this.calls.push({
        method: `${method} ${path.replace(/items\/[^/]+$/, 'items/:id')}`,
        collection,
        filter,
        wave: this.wave,
      });

    if (path === '/wix-data/v2/items/query') {
      const collection = String(body.dataCollectionId);
      const query = (body.query ?? {}) as {
        filter?: Record<string, unknown>;
        paging?: { limit?: number };
      };
      record(collection, query.filter);
      const matches = this.rows(collection).filter((row) =>
        Object.entries(query.filter ?? {}).every(([key, value]) => row.data[key] === value),
      );
      const limit = query.paging?.limit ?? 50;
      return json({
        dataItems: matches.slice(0, limit).map((row) => ({ id: row.id, data: { ...row.data } })),
        pagingMetadata: { hasNext: false, cursors: { next: null } },
      });
    }

    if (path === '/wix-data/v2/items' && method === 'POST') {
      const collection = String(body.dataCollectionId);
      record(collection);
      const item = body.dataItem as { id?: string; data: Record<string, unknown> };
      const id = item.id ?? `wix-${this.rows(collection).length + 1}`;
      this.insert(collection, id, item.data);
      return json({ dataItem: { id, data: item.data } });
    }

    const itemMatch = path.match(/^\/wix-data\/v2\/items\/([^/]+)$/);
    if (itemMatch) {
      const id = decodeURIComponent(itemMatch[1]);
      const collection = url.searchParams.get('dataCollectionId') ?? String(body.dataCollectionId);
      record(collection);
      const rows = this.rows(collection);
      const index = rows.findIndex((row) => row.id === id);
      if (method === 'DELETE') {
        if (index !== -1) rows.splice(index, 1);
        return json({});
      }
      if (method === 'PUT') {
        const item = body.dataItem as { data: Record<string, unknown> };
        if (index === -1) return json({ message: 'not found' }, 404);
        rows[index] = { id, data: { ...item.data } };
        return json({ dataItem: rows[index] });
      }
    }

    return json({ message: `FakeWix: unsupported ${method} ${path}` }, 400);
  }
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
