/**
 * TEST-ONLY (consistent service changes / Wix adapter verification,
 * 2026-10). An in-memory stand-in for lib/wixDataApi.ts, so Wix-mode code
 * paths run for real against fictional rows with no network at all:
 *
 *   const wix = await vi.hoisted(async () =>
 *     (await import('@/lib/testing/inMemoryWixData')).createInMemoryWixData());
 *   vi.mock('@/lib/wixDataApi', () => wix.api);
 *
 * It mirrors the REAL contract of each function, not a convenient one:
 *  - query filters support the operators this codebase uses ($eq — with
 *    `$eq: null` matching an unset field, as live-verified — $ne, $in,
 *    $hasSome, $exists, $gt/$gte/$lt/$lte, $and/$or); an unsupported
 *    operator throws so a test can't silently pass on a filter Wix would
 *    treat differently. `queryWixDataItems` caps an unpaged query at 50,
 *    like Wix;
 *  - insert with an existing id is HTTP 409; update/delete/patch of a
 *    missing id is 404; `updateWixDataItem` is a FULL replace;
 *  - conditional patches apply all fields or none, and a condition that
 *    isn't met is HTTP 428 (`conditionalPatchWixDataItem` reports only
 *    `{applied: false}`, exactly like the real one).
 *
 * Case concurrency (2026-10) — aligned with the official PatchDataItem /
 * UpdateDataItem REST reference (dev.wix.com/docs/api-reference/
 * business-solutions/cms/data-items/patch-data-item and .../update-data-item)
 * and what was live-verified; see docs/CASE_CONCURRENCY.md:
 *  - PatchDataItem changes ONLY the listed fields ("Data that isn't
 *    explicitly modified remains unchanged"); 1–100 modifications per
 *    call (the documented minItems/maxItems — outside that is HTTP 400);
 *  - a condition containing `$isEmpty` is HTTP 400 (live-verified
 *    `WDE0076`), never "condition not met";
 *  - the condition is evaluated and the write applied as ONE step per
 *    item — what the 8-round live race of conditionalPatchWixDataItem
 *    showed (exactly one winner, loser never applied). The docs do not
 *    state this atomicity in words, nor that several fieldModifications
 *    apply all-or-nothing; both are modelled here as the live-verified /
 *    expected behaviour and are the subject of
 *    docs/WIX_LIVE_VERIFICATION_PLAN.md;
 *  - with `systemFields: true`, rows carry `_createdDate`/`_updatedDate`
 *    and every write refreshes `_updatedDate`, as documented ("its
 *    `data._updatedDate` property is updated to the current date and
 *    time"). Off by default so older tests comparing whole rows are
 *    unaffected.
 * Failures (`failNext`) and interleaved writes from "another request"
 * (`onBeforeOp`) can be injected per operation and collection. Every
 * write is logged in `ops`. Never import this from application code.
 */

type Row = Record<string, unknown>;
type Item = { id: string; dataCollectionId: string; data: Row };

export type WixOpKind = 'query' | 'count' | 'insert' | 'update' | 'delete' | 'patch' | 'increment';
export type WixOp = { op: WixOpKind; collection: string; id?: string; fields?: string[] };

type Failure = { op: WixOpKind; collection: string; status: number; remaining: number; when?: (op: WixOp) => boolean; afterWrite?: boolean };

export class InMemoryWixDataApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'WixDataApiError';
    this.status = status;
  }
}

const clone = <T>(value: T): T => (value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T));

function matchesCondition(value: unknown, condition: unknown): boolean {
  if (condition !== null && typeof condition === 'object' && !Array.isArray(condition)) {
    return Object.entries(condition as Record<string, unknown>).every(([op, operand]) => {
      switch (op) {
        case '$eq':
          return operand === null ? value === null || value === undefined : JSON.stringify(value) === JSON.stringify(operand);
        case '$ne':
          return value !== operand;
        case '$in':
          return (operand as unknown[]).includes(value);
        case '$hasSome':
          return Array.isArray(value) && value.some((v) => (operand as unknown[]).includes(v));
        case '$exists':
          return (value !== undefined) === operand;
        case '$gt':
          return value !== undefined && value !== null && (value as number) > (operand as number);
        case '$gte':
          return value !== undefined && value !== null && (value as number) >= (operand as number);
        case '$lt':
          return value !== undefined && value !== null && (value as number) < (operand as number);
        case '$lte':
          return value !== undefined && value !== null && (value as number) <= (operand as number);
        default:
          throw new Error(`in-memory wixDataApi: unsupported filter operator ${op}`);
      }
    });
  }
  return value === condition;
}

export function matchesWixFilter(data: Row, filter: Record<string, unknown> | undefined): boolean {
  if (!filter) return true;
  return Object.entries(filter).every(([key, condition]) => {
    if (key === '$and') return (condition as Record<string, unknown>[]).every((f) => matchesWixFilter(data, f));
    if (key === '$or') return (condition as Record<string, unknown>[]).some((f) => matchesWixFilter(data, f));
    return matchesCondition(data[key], condition);
  });
}

function containsOperator(filter: unknown, operator: string): boolean {
  if (filter === null || typeof filter !== 'object') return false;
  if (Array.isArray(filter)) return filter.some((entry) => containsOperator(entry, operator));
  return Object.entries(filter as Record<string, unknown>).some(([key, value]) => key === operator || containsOperator(value, operator));
}

export function createInMemoryWixData(options: { systemFields?: boolean; now?: () => string } = {}) {
  const now = options.now ?? (() => new Date().toISOString());
  const stamp = (data: Row, created: boolean): Row =>
    options.systemFields ? { ...data, ...(created ? { _createdDate: now() } : {}), _updatedDate: now() } : data;
  const store = new Map<string, Map<string, Row>>();
  const ops: WixOp[] = [];
  /** Every conditional patch's condition, in call order — so a test can
      assert what a write was conditioned on (organization, revision). */
  const conditions: Array<{ collection: string; id: string; filter: Record<string, unknown> }> = [];
  let failures: Failure[] = [];
  let beforeOp: Array<(op: WixOp) => void> = [];
  let autoId = 0;

  const collection = (name: string) => {
    let c = store.get(name);
    if (!c) {
      c = new Map();
      store.set(name, c);
    }
    return c;
  };

  /** Runs interleaving hooks, logs the op, and returns an injected failure
      status for it, if any — `afterWrite` failures are returned by
      `lostResponse` instead (the write applies, its response is lost). */
  function begin(op: WixOp): number | null {
    for (const hook of beforeOp) hook(op);
    if (op.op !== 'query' && op.op !== 'count') ops.push(op);
    const failure = failures.find((f) => !f.afterWrite && f.op === op.op && f.collection === op.collection && f.remaining > 0 && (!f.when || f.when(op)));
    if (!failure) return null;
    failure.remaining -= 1;
    return failure.status;
  }

  function lostResponse(op: WixOp): number | null {
    const failure = failures.find((f) => f.afterWrite && f.op === op.op && f.collection === op.collection && f.remaining > 0 && (!f.when || f.when(op)));
    if (!failure) return null;
    failure.remaining -= 1;
    return failure.status;
  }

  function fail(kind: string, collectionName: string, status: number): never {
    throw new InMemoryWixDataApiError(`Wix Data ${kind} failed for collection "${collectionName}" (HTTP ${status}).`, status);
  }

  function select(name: string, filter: Record<string, unknown> | undefined, sort?: Array<{ fieldName: string; order: 'ASC' | 'DESC' }>): Item[] {
    const rows = [...collection(name).entries()]
      .filter(([, data]) => matchesWixFilter(data, filter))
      .map(([id, data]) => ({ id, dataCollectionId: name, data: clone(data) }));
    for (const s of [...(sort ?? [])].reverse()) {
      rows.sort((a, b) => {
        const x = a.data[s.fieldName] as string | number;
        const y = b.data[s.fieldName] as string | number;
        const cmp = x < y ? -1 : x > y ? 1 : 0;
        return s.order === 'DESC' ? -cmp : cmp;
      });
    }
    return rows;
  }

  function setFields(name: string, id: string, fields: Record<string, unknown>): Item {
    const existing = collection(name).get(id)!;
    const next = stamp({ ...existing, ...clone(fields) }, false);
    collection(name).set(id, next);
    return { id, dataCollectionId: name, data: clone(next) };
  }

  const api = {
    WixDataApiError: InMemoryWixDataApiError,

    async queryWixDataItems<T = Row>(
      name: string,
      query: { filter?: Record<string, unknown>; paging?: { limit?: number; cursor?: string; offset?: number }; sort?: Array<{ fieldName: string; order: 'ASC' | 'DESC' }> } = {},
    ) {
      const status = begin({ op: 'query', collection: name });
      if (status) fail('query', name, status);
      const all = select(name, query.filter, query.sort);
      const offset = query.paging?.offset ?? 0;
      const limit = query.paging?.limit ?? 50;
      const page = all.slice(offset, offset + limit);
      return {
        dataItems: page as unknown as Array<{ id: string; dataCollectionId: string; data: T }>,
        pagingMetadata: { hasNext: offset + limit < all.length, cursors: { next: null } },
      };
    },

    async queryAllWixDataItems<T = Row>(name: string, filter?: Record<string, unknown>, options?: { sort?: Array<{ fieldName: string; order: 'ASC' | 'DESC' }> }) {
      const status = begin({ op: 'query', collection: name });
      if (status) fail('query', name, status);
      return select(name, filter, options?.sort) as unknown as Array<{ id: string; dataCollectionId: string; data: T }>;
    },

    async countWixDataItems(name: string, filter?: Record<string, unknown>) {
      const status = begin({ op: 'count', collection: name });
      if (status) fail('count', name, status);
      return select(name, filter).length;
    },

    async insertWixDataItem<T = Row>(name: string, data: T, itemId?: string) {
      const id = itemId ?? `auto-${++autoId}`;
      const status = begin({ op: 'insert', collection: name, id });
      if (status) fail('insert', name, status);
      if (collection(name).has(id)) fail('insert', name, 409);
      collection(name).set(id, stamp(clone(data) as Row, true));
      const lost = lostResponse({ op: 'insert', collection: name, id });
      if (lost) fail('insert', name, lost);
      return { id, dataCollectionId: name, data: clone(data) };
    },

    async updateWixDataItem<T = Row>(name: string, id: string, data: T) {
      const status = begin({ op: 'update', collection: name, id, fields: Object.keys(data as Row) });
      if (status) fail('update', name, status);
      if (!collection(name).has(id)) fail('update', name, 404);
      const previous = collection(name).get(id)!;
      collection(name).set(
        id,
        options.systemFields ? stamp({ ...(clone(data) as Row), _createdDate: previous._createdDate }, false) : (clone(data) as Row),
      );
      return { id, dataCollectionId: name, data: clone(data) };
    },

    async deleteWixDataItem(name: string, id: string) {
      const status = begin({ op: 'delete', collection: name, id });
      if (status) fail('delete', name, status);
      if (!collection(name).delete(id)) fail('delete', name, 404);
    },

    async conditionalPatchWixDataItem<T = Row>(name: string, id: string, fieldPath: string, value: unknown, condition: { filter: Record<string, unknown> }) {
      const result = await api.conditionalPatchWixDataItemFields<T>(name, id, { [fieldPath]: value }, condition);
      return result.applied ? result : { applied: false as const };
    },

    async conditionalPatchWixDataItemFields<T = Row>(name: string, id: string, fields: Record<string, unknown>, condition: { filter: Record<string, unknown> }) {
      const op: WixOp = { op: 'patch', collection: name, id, fields: Object.keys(fields) };
      conditions.push({ collection: name, id, filter: clone(condition?.filter ?? {}) });
      const status = begin(op);
      if (status) return { applied: false as const, status };
      const count = Object.keys(fields).length;
      if (count < 1 || count > 100) return { applied: false as const, status: 400 };
      if (containsOperator(condition?.filter, '$isEmpty')) return { applied: false as const, status: 400 };
      const existing = collection(name).get(id);
      if (!existing) return { applied: false as const, status: 404 };
      if (!matchesWixFilter(existing, condition.filter)) return { applied: false as const, status: 428 };
      const dataItem = setFields(name, id, fields) as unknown as { id: string; dataCollectionId: string; data: T };
      const lost = lostResponse(op);
      if (lost) return { applied: false as const, status: lost };
      return { applied: true as const, dataItem };
    },

    async incrementWixDataField<T = Row>(name: string, id: string, fieldPath: string, incrementBy: number) {
      const status = begin({ op: 'increment', collection: name, id, fields: [fieldPath] });
      if (status) fail('increment', name, status);
      const existing = collection(name).get(id);
      if (!existing) fail('increment', name, 404);
      return setFields(name, id, { [fieldPath]: ((existing[fieldPath] as number) ?? 0) + incrementBy }) as unknown as { id: string; dataCollectionId: string; data: T };
    },
  };

  return {
    api,
    store,
    ops,
    conditions,
    /** Puts a row in place without logging an op. */
    seed(name: string, id: string, data: Row) {
      collection(name).set(id, clone(data));
    },
    /** A copy of one row's data, or undefined. */
    get(name: string, id: string): Row | undefined {
      return clone(collection(name).get(id));
    },
    /** Copies of every row of a collection (optionally filtered). */
    rows(name: string, filter?: Record<string, unknown>): Item[] {
      return select(name, filter);
    },
    /** A deep copy of the entire store, for "nothing changed" assertions. */
    snapshot(): Record<string, Record<string, Row>> {
      return Object.fromEntries([...store.entries()].map(([name, rows]) => [name, Object.fromEntries([...rows.entries()].map(([id, data]) => [id, clone(data)]))]));
    },
    /** The next `times` matching operations fail with HTTP `status`
        (conditional patches answer `{applied: false, status}`). With
        `afterWrite` (insert/conditional patch only) the write still
        applies and only its response is lost. */
    failNext(op: WixOpKind, collectionName: string, status: number, options: { times?: number; when?: (op: WixOp) => boolean; afterWrite?: boolean } = {}) {
      failures.push({ op, collection: collectionName, status, remaining: options.times ?? 1, when: options.when, afterWrite: options.afterWrite });
    },
    /** Runs before every operation — e.g. to simulate another request
        writing between this request's read and its write. */
    onBeforeOp(hook: (op: WixOp) => void) {
      beforeOp.push(hook);
    },
    writes(): WixOp[] {
      return ops.filter((op) => op.op !== 'query' && op.op !== 'count');
    },
    reset() {
      store.clear();
      ops.length = 0;
      conditions.length = 0;
      failures = [];
      beforeOp = [];
      autoId = 0;
    },
  };
}

export type InMemoryWixData = ReturnType<typeof createInMemoryWixData>;
