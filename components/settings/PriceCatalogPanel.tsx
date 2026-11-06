'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useOrganization } from '@/hooks/useOrganization';
import { isPriceCatalogManaged, pricingPermissionFor } from '@/domain/pricing/pricingPermissions';
import { useMyPermissions } from '@/hooks/useRbac';
import { useCreateCatalogCategory, usePriceCatalog, useUpdateCatalogCategory, useUpdateCatalogItem } from '@/hooks/useServiceCatalog';
import { formatCatalogPrice } from '@/utils/format';
import { TextField } from '@/components/ui/TextField';
import { SelectField } from '@/components/ui/SelectField';
import { CatalogItemEditorModal } from './CatalogItemEditorModal';
import { ConfirmActionDialog } from './ConfirmActionDialog';
import { ftcClassLabel, ftcClassValue } from './priceCatalogFtc';
import { fetchInventoryBalances, fetchMerchandiseProducts } from '@/lib/merchandiseClient';
import { availableFromBalance } from '@/domain/merchandise/inventoryMath';
import { formatCentsAsCurrency } from '@/utils/format';
import type { MerchandiseProduct } from '@/types/merchandiseProduct';
import type { InventoryBalance } from '@/types/inventoryBalance';
import { CATALOG_ITEM_CATEGORY, SERVICE_TYPE_CATEGORY } from '@/domain/pricing/serviceCodes';
import type { ServiceCatalogCategory, ServiceCatalogItem } from '@/types/serviceCatalog';

/**
 * Gus Phase 5C-3 (administrator-managed price catalog). Settings › Price
 * Catalog: every item the organization can put on a case order — its
 * primary services plus the services, merchandise, permits and other
 * charges an administrator adds — with item codes, prices, categories and
 * active flags, searchable and filterable.
 *
 * Staff holding `serviceCatalog.read` see it read-only. Changing it takes
 * `serviceCatalog.edit` AND `organization.manage` (an administrator), and
 * the server enforces that on every write — hiding the controls here is a
 * convenience, never the boundary. A change never touches an existing case
 * order, statement or receipt.
 *
 * Phase 5C-3 finalization: each item's FTC classification (or "Pending
 * review"); deactivating a primary service behind an explicit confirmation;
 * and, for merchandise, a link to an inventory record whose stock is shown
 * read-only (inventory.read) — stock only ever changes through the
 * inventory system.
 */

type StatusFilter = 'active' | 'inactive' | 'all';
const NO_CATEGORY = '__none__';
/** Long machine codes wrap instead of pushing the row's buttons off-screen. */
const CODE_STYLE = { fontSize: '0.8em', overflowWrap: 'anywhere' } as const;

function pricingLabel(item: ServiceCatalogItem): string {
  if (item.category === SERVICE_TYPE_CATEGORY) return 'Primary service';
  return item.pricingType === 'per_unit' ? 'Per unit' : 'Flat';
}

export function PriceCatalogPanel() {
  const { organizationId } = useOrganization();
  const permissionsQuery = useMyPermissions(organizationId);
  const permissions = permissionsQuery.data?.permissions ?? [];
  const canView = permissions.includes('serviceCatalog.read');
  // The organization's pricing permission model decides (pricingPermissions);
  // the server enforces price and deactivation changes separately.
  const editKey = pricingPermissionFor(organizationId, 'catalog.edit');
  const canConfigure = isPriceCatalogManaged(organizationId) && editKey !== null && permissions.includes(editKey);
  const catalogQuery = usePriceCatalog();
  const canReadMerchandise = permissions.includes('merchandise.read');
  const canReadInventory = permissions.includes('inventory.read');
  const productsQuery = useQuery({
    queryKey: ['merchandiseProducts', organizationId, true],
    queryFn: () => fetchMerchandiseProducts(organizationId, true),
    enabled: Boolean(organizationId) && canReadMerchandise,
  });
  const balancesQuery = useQuery({
    queryKey: ['inventoryBalances', organizationId],
    queryFn: () => fetchInventoryBalances(organizationId),
    enabled: Boolean(organizationId) && canReadInventory && (catalogQuery.data?.catalog ?? []).some((item) => item.merchandiseProductId),
  });

  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active');
  const [editor, setEditor] = useState<{ item: ServiceCatalogItem | null } | null>(null);

  const catalog = useMemo(() => catalogQuery.data?.catalog ?? [], [catalogQuery.data]);
  const categories = useMemo(() => catalogQuery.data?.categories ?? [], [catalogQuery.data]);

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return catalog.filter((item) => {
      if (statusFilter === 'active' && !item.isActive) return false;
      if (statusFilter === 'inactive' && item.isActive) return false;
      if (categoryFilter === NO_CATEGORY && item.categoryId) return false;
      if (categoryFilter && categoryFilter !== NO_CATEGORY && item.categoryId !== categoryFilter) return false;
      if (!needle) return true;
      return [item.displayName, item.serviceCode, item.description ?? ''].some((text) => text.toLowerCase().includes(needle));
    });
  }, [catalog, search, categoryFilter, statusFilter]);

  if (permissionsQuery.isPending || catalogQuery.isPending) {
    return <p className="sx-help">Loading the price catalog…</p>;
  }
  if (!canView) {
    return (
      <div className="sx-empty">
        <div className="sx-empty-title">You don&apos;t have access to the Price Catalog.</div>
      </div>
    );
  }
  if (catalogQuery.isError) {
    return (
      <div className="sx-error-state" role="alert">
        Failed to load the price catalog.
      </div>
    );
  }

  const products = canReadMerchandise ? (productsQuery.data ?? []) : null;
  const productById = new Map((products ?? []).map((product) => [product.id, product]));
  const inventory: InventoryLookup = { productById, balances: balancesQuery.data ?? null };
  /** What `item` may be linked to: this organization's active, non-variant
      products not already linked to another item (plus its own link). */
  const linkableFor = (item: ServiceCatalogItem | null): MerchandiseProduct[] | null =>
    products === null
      ? null
      : products.filter(
          (product) =>
            product.id === item?.merchandiseProductId ||
            (product.isActive && !product.hasVariants && !catalog.some((other) => other.id !== item?.id && other.merchandiseProductId === product.id)),
        );
  const pendingFtcCount = catalog.filter((item) => item.isActive && ftcClassValue(item.ftcClass) === '').length;
  const addedItemCount = catalog.filter((item) => item.category === CATALOG_ITEM_CATEGORY).length;
  const unpricedCount = catalog.filter((item) => item.isActive && item.defaultPrice === null).length;
  const categoryById = new Map(categories.map((category) => [category.id, category]));

  // Group the visible items by category, in category order; "No category" last.
  const groups: Array<{ key: string; title: string; items: ServiceCatalogItem[] }> = [];
  for (const category of categories) {
    const items = visible.filter((item) => item.categoryId === category.id);
    if (items.length > 0) groups.push({ key: category.id, title: category.isActive ? category.name : `${category.name} (inactive category)`, items });
  }
  const uncategorized = visible.filter((item) => !item.categoryId || !categoryById.has(item.categoryId));
  if (uncategorized.length > 0) groups.push({ key: NO_CATEGORY, title: 'No category', items: uncategorized });

  return (
    <div>
      <div className="sx-settings-head">
        <h2 className="sx-settings-title">Price Catalog</h2>
        <p className="sx-settings-desc">
          The services, merchandise and other charges staff can add to a case order. A price change applies to items added to orders from now
          on — existing orders, statements and receipts always keep the prices they were saved with.
        </p>
      </div>

      {!canConfigure && (
        <p className="sx-form-banner sx-form-banner-info">You can view the catalog. Only an administrator can change it.</p>
      )}

      {addedItemCount === 0 && (
        <div className="sx-form-banner sx-form-banner-info">
          <strong>Getting started.</strong> No catalog items have been added yet — only the primary services are listed, without prices.
          {canConfigure
            ? ' Once the approved price list is supplied, set each primary service’s price and add the other services, merchandise and charges with “Add item”. Nothing is priced automatically.'
            : ' An administrator will add items and prices once the approved price list is supplied.'}
        </div>
      )}

      {unpricedCount > 0 && (
        <p className="sx-form-banner sx-form-banner-info">
          {unpricedCount === 1 ? '1 active item has' : `${unpricedCount} active items have`} no price set. Staff can&apos;t save a case order that
          includes an item without a price.
        </p>
      )}

      {pendingFtcCount > 0 && (
        <p className="sx-form-banner sx-form-banner-info">
          {pendingFtcCount === 1 ? '1 active item is' : `${pendingFtcCount} active items are`} pending FTC classification review. Statements list
          such items separately as pending classification until an administrator classifies them against the approved General Price List.
        </p>
      )}

      {/* 2026-11 refresh: Items and Categories as panels — a header band
          (title, count, what it is, the action), then the content. */}
      <section className="sx-panel sx-catalog-panel" aria-labelledby="price-catalog-items">
        <div className="sx-panel-head">
          <div className="sx-panel-heading">
            <div className="sx-panel-title">
              <h3 id="price-catalog-items" className="sx-catalog-title">
                Items
              </h3>
              <span className="sx-panel-count">{groups.reduce((count, group) => count + group.items.length, 0)}</span>
            </div>
            <p className="sx-panel-sub">What staff can add to a case order, by category.</p>
          </div>
          {canConfigure && (
            <div className="sx-panel-actions">
              <button type="button" className="sx-btn sx-btn-primary sx-btn-sm" onClick={() => setEditor({ item: null })}>
                Add item
              </button>
            </div>
          )}
        </div>
        <div className="sx-panel-body">
        <div className="sx-filterbar">
          <label className="sx-filter">
            <span className="sx-filter-label">Search</span>
            <TextField className="sx-input" type="search" placeholder="Name, code or description" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search the catalog" />
          </label>
          <label className="sx-filter">
            <span className="sx-filter-label">Category</span>
            <SelectField className="sx-select" aria-label="Category" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
              <option value="">All categories</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
              <option value={NO_CATEGORY}>No category</option>
            </SelectField>
          </label>
          <label className="sx-filter">
            <span className="sx-filter-label">Status</span>
            <SelectField className="sx-select" aria-label="Status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="all">All</option>
            </SelectField>
          </label>
        </div>

        {groups.length === 0 ? (
          <div className="sx-empty">
            <div className="sx-empty-title">No items match these filters.</div>
          </div>
        ) : (
          groups.map((group) => (
            <div key={group.key} className="sx-catalog-group">
              <h4 className="sx-panel-section-title">{group.title}</h4>
              <div className="sx-table-wrap">
                <table className="sx-table sx-table-stack">
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th>Code</th>
                      <th>Pricing</th>
                      <th className="sx-num">Price</th>
                      <th>FTC</th>
                      <th>Status</th>
                      {canConfigure && <th />}
                    </tr>
                  </thead>
                  <tbody>
                    {group.items.map((item) => (
                      <CatalogItemRow key={item.id} item={item} inventory={inventory} canConfigure={canConfigure} onEdit={() => setEditor({ item })} />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))
        )}
        </div>
      </section>

      <CategoriesSection categories={categories} catalog={catalog} canConfigure={canConfigure} />

      {editor && (
        <CatalogItemEditorModal
          open
          item={editor.item}
          categories={categories}
          linkableProducts={editor.item === null || editor.item.category === CATALOG_ITEM_CATEGORY ? linkableFor(editor.item) : null}
          onClose={() => setEditor(null)}
        />
      )}
    </div>
  );
}

type InventoryLookup = { productById: Map<string, MerchandiseProduct>; balances: InventoryBalance[] | null };

const PRIMARY_DEACTIVATION_MESSAGE =
  'Deactivating this primary service removes it from the services staff can choose for NEW cases. Existing cases on it keep working — their orders, documents, payments and workflow assignment are unchanged, and its workflow is not deactivated. You can reactivate it at any time.';

/** "On hand 4 · Reserved 1 · Available 3", summed over every location —
    read-only; only the inventory system changes stock. */
function stockSummary(productId: string, balances: InventoryBalance[] | null): string | null {
  if (balances === null) return null;
  const lines = balances.filter((balance) => balance.productId === productId && balance.variantId === null);
  const onHand = lines.reduce((sum, balance) => sum + balance.onHand, 0);
  const reserved = lines.reduce((sum, balance) => sum + balance.reserved, 0);
  const available = lines.reduce((sum, balance) => sum + availableFromBalance(balance), 0);
  return `On hand ${onHand} · Reserved ${reserved} · Available ${available}`;
}

function CatalogItemRow({
  item,
  inventory,
  canConfigure,
  onEdit,
}: {
  item: ServiceCatalogItem;
  inventory: InventoryLookup;
  canConfigure: boolean;
  onEdit: () => void;
}) {
  const update = useUpdateCatalogItem();
  const [error, setError] = useState<string | null>(null);
  const [confirmingDeactivation, setConfirmingDeactivation] = useState(false);
  const isPrimary = item.category === SERVICE_TYPE_CATEGORY;
  const product = item.merchandiseProductId ? inventory.productById.get(item.merchandiseProductId) ?? null : null;
  const stock = item.merchandiseProductId ? stockSummary(item.merchandiseProductId, inventory.balances) : null;
  const pendingFtc = ftcClassValue(item.ftcClass) === '';

  const setActive = (isActive: boolean, confirmPrimaryServiceDeactivation = false) =>
    update.mutateAsync({ itemId: item.id, changes: { isActive }, expectedRevision: item.revision ?? 0, confirmPrimaryServiceDeactivation });

  async function toggleActive() {
    setError(null);
    if (isPrimary && item.isActive) {
      setConfirmingDeactivation(true);
      return;
    }
    try {
      await setActive(!item.isActive);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'The item could not be updated.');
    }
  }

  return (
    <tr>
      <td data-label="Item" data-primary className="sx-cell-title">
        {item.displayName}
        {item.description && <div className="sx-cell-sub">{item.description}</div>}
        {item.merchandiseProductId && (
          <div className="sx-cell-sub">
            Inventory: {product ? `${product.name} (${product.sku})${product.isActive ? '' : ' — archived'}` : 'linked record'}
            {stock && <> · {stock}</>}
          </div>
        )}
        {isPrimary && !item.isActive && <div className="sx-cell-sub">Not offered for new cases. Existing cases are unaffected.</div>}
        {error && (
          <div className="sx-error" role="alert">
            {error}
          </div>
        )}
      </td>
      <td data-label="Code">
        <code style={CODE_STYLE}>{item.serviceCode}</code>
      </td>
      <td data-label="Pricing">{pricingLabel(item)}</td>
      <td data-label="Price" className="sx-num">
        {item.merchandiseProductId ? (
          product ? (
            `${formatCentsAsCurrency(product.retailPrice, 'usd')} (inventory record)`
          ) : (
            'From inventory record'
          )
        ) : item.defaultPrice === null ? (
          <span className="sx-status">{formatCatalogPrice(null)}</span>
        ) : (
          `${formatCatalogPrice(item.defaultPrice)}${item.pricingType === 'per_unit' && item.category === CATALOG_ITEM_CATEGORY ? ' each' : ''}`
        )}
      </td>
      <td data-label="FTC">
        <span className={pendingFtc ? 'sx-status sx-status-warn' : 'sx-status'}>{ftcClassLabel(item.ftcClass)}</span>
      </td>
      <td data-label="Status">
        <span className={item.isActive ? 'sx-status sx-status-ok' : 'sx-status'}>{item.isActive ? 'Active' : 'Inactive'}</span>
      </td>
      {canConfigure && (
        <td>
          <div className="sx-row-actions">
            <button type="button" className="sx-btn sx-btn-secondary sx-btn-sm" onClick={onEdit} aria-label={`Edit ${item.displayName}`}>
              Edit
            </button>
            <button
              type="button"
              className="sx-btn sx-btn-ghost sx-btn-sm"
              onClick={() => void toggleActive()}
              disabled={update.isPending}
              aria-label={`${item.isActive ? 'Deactivate' : 'Reactivate'} ${item.displayName}`}
            >
              {item.isActive ? 'Deactivate' : 'Reactivate'}
            </button>
          </div>
          {confirmingDeactivation && (
            <ConfirmActionDialog
              open
              onClose={() => setConfirmingDeactivation(false)}
              title={`Deactivate ${item.displayName}?`}
              message={PRIMARY_DEACTIVATION_MESSAGE}
              confirmLabel="Deactivate service"
              onConfirm={async () => {
                await setActive(false, true);
              }}
            />
          )}
        </td>
      )}
    </tr>
  );
}

function CategoriesSection({
  categories,
  catalog,
  canConfigure,
}: {
  categories: ServiceCatalogCategory[];
  catalog: ServiceCatalogItem[];
  canConfigure: boolean;
}) {
  const createCategory = useCreateCatalogCategory();
  const [newName, setNewName] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function addCategory() {
    const name = newName.trim();
    if (!name) return;
    setError(null);
    try {
      await createCategory.mutateAsync(name);
      setNewName('');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'The category could not be added.');
    }
  }

  return (
    <section className="sx-panel sx-catalog-panel" aria-labelledby="price-catalog-categories">
      <div className="sx-panel-head">
        <div className="sx-panel-heading">
          <div className="sx-panel-title">
            <h3 id="price-catalog-categories" className="sx-catalog-title">
              Categories
            </h3>
            <span className="sx-panel-count">{categories.length}</span>
          </div>
          <p className="sx-panel-sub">Categories organize the catalog and the item list on a case order. They never change a price.</p>
        </div>
      </div>
      <div className="sx-panel-body">
      {categories.length === 0 ? (
        <div className="sx-empty">
          <div className="sx-empty-title">No categories yet.</div>
        </div>
      ) : (
        <div className="sx-table-wrap">
          <table className="sx-table sx-table-stack">
            <thead>
              <tr>
                <th>Category</th>
                <th className="sx-num">Items</th>
                <th>Status</th>
                {canConfigure && <th />}
              </tr>
            </thead>
            <tbody>
              {categories.map((category, index) => (
                <CategoryRow
                  key={category.id}
                  category={category}
                  previous={categories[index - 1] ?? null}
                  next={categories[index + 1] ?? null}
                  itemCount={catalog.filter((item) => item.categoryId === category.id).length}
                  canConfigure={canConfigure}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
      </div>
      {canConfigure && (
        <div className="sx-panel-foot">
        <form
          className="sx-filterbar"
          onSubmit={(event) => {
            event.preventDefault();
            void addCategory();
          }}
        >
          <label className="sx-filter">
            <span className="sx-filter-label">New category</span>
            <TextField className="sx-input" value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={60} aria-label="New category name" />
          </label>
          <button type="submit" className="sx-btn sx-btn-secondary sx-btn-sm" disabled={!newName.trim() || createCategory.isPending}>
            Add category
          </button>
        </form>
        </div>
      )}
      {error && (
        <div className="sx-form-banner sx-form-banner-error" role="alert">
          {error}
        </div>
      )}
    </section>
  );
}

function CategoryRow({
  category,
  previous,
  next,
  itemCount,
  canConfigure,
}: {
  category: ServiceCatalogCategory;
  previous: ServiceCatalogCategory | null;
  next: ServiceCatalogCategory | null;
  itemCount: number;
  canConfigure: boolean;
}) {
  const update = useUpdateCatalogCategory();
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(category.name);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<unknown>) {
    setError(null);
    try {
      await action();
      return true;
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'The category could not be updated.');
      return false;
    }
  }

  const save = (changes: Partial<{ name: string; sortOrder: number; isActive: boolean }>) =>
    update.mutateAsync({ categoryId: category.id, changes, expectedRevision: category.revision });

  /** Swaps this category's position with its neighbour's. */
  const move = (neighbour: ServiceCatalogCategory) =>
    run(async () => {
      const mine = category.sortOrder === neighbour.sortOrder ? neighbour.sortOrder + (neighbour === previous ? -1 : 1) : neighbour.sortOrder;
      await update.mutateAsync({ categoryId: neighbour.id, changes: { sortOrder: category.sortOrder }, expectedRevision: neighbour.revision });
      await save({ sortOrder: Math.max(mine, 0) });
    });

  return (
    <tr>
      <td data-label="Category" data-primary className="sx-cell-title">
        {renaming ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void run(() => save({ name: name.trim() })).then((ok) => ok && setRenaming(false));
            }}
          >
            <TextField className="sx-input" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} aria-label={`New name for ${category.name}`} autoFocus />
            <div className="sx-row-actions" style={{ marginTop: 6 }}>
              <button type="submit" className="sx-btn sx-btn-primary sx-btn-sm" disabled={!name.trim() || update.isPending}>
                Save
              </button>
              <button
                type="button"
                className="sx-btn sx-btn-ghost sx-btn-sm"
                onClick={() => {
                  setRenaming(false);
                  setName(category.name);
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        ) : (
          category.name
        )}
        {error && (
          <div className="sx-error" role="alert">
            {error}
          </div>
        )}
      </td>
      <td data-label="Items" className="sx-num">
        {itemCount}
      </td>
      <td data-label="Status">
        <span className={category.isActive ? 'sx-status sx-status-ok' : 'sx-status'}>{category.isActive ? 'Active' : 'Inactive'}</span>
      </td>
      {canConfigure && (
        <td>
          <div className="sx-row-actions">
            <button type="button" className="sx-btn sx-btn-ghost sx-btn-sm" onClick={() => previous && void move(previous)} disabled={!previous || update.isPending} aria-label={`Move ${category.name} up`}>
              ↑
            </button>
            <button type="button" className="sx-btn sx-btn-ghost sx-btn-sm" onClick={() => next && void move(next)} disabled={!next || update.isPending} aria-label={`Move ${category.name} down`}>
              ↓
            </button>
            {!renaming && (
              <button type="button" className="sx-btn sx-btn-secondary sx-btn-sm" onClick={() => setRenaming(true)} aria-label={`Rename ${category.name}`}>
                Rename
              </button>
            )}
            <button
              type="button"
              className="sx-btn sx-btn-ghost sx-btn-sm"
              onClick={() => void run(() => save({ isActive: !category.isActive }))}
              disabled={update.isPending}
              aria-label={`${category.isActive ? 'Deactivate' : 'Reactivate'} ${category.name}`}
            >
              {category.isActive ? 'Deactivate' : 'Reactivate'}
            </button>
          </div>
        </td>
      )}
    </tr>
  );
}
