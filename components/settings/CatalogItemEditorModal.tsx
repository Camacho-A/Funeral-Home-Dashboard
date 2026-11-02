'use client';

import { useState, type FormEvent } from 'react';
import { Modal } from '@/components/ui/Modal';
import { TextField } from '@/components/ui/TextField';
import { TextArea } from '@/components/ui/TextArea';
import { SelectField } from '@/components/ui/SelectField';
import { useCreateCatalogItem, useUpdateCatalogItem } from '@/hooks/useServiceCatalog';
import { PriceCatalogRequestError, type CatalogItemChanges } from '@/services/pricingClient';
import type { ServiceCatalogCategory, ServiceCatalogItem } from '@/types/serviceCatalog';
import type { MerchandiseProduct } from '@/types/merchandiseProduct';
import { SERVICE_TYPE_CATEGORY } from '@/domain/pricing/serviceCodes';
import { formatCentsAsCurrency } from '@/utils/format';
import { FTC_CLASS_OPTIONS, ftcClassValue } from './priceCatalogFtc';

/**
 * Gus Phase 5C-3 (administrator-managed price catalog). Add or edit one
 * catalog item. A new item gets a code and a pricing type that never change
 * afterwards (order lines key off them); an existing one can be renamed,
 * described, filed under a category and priced. A blank price means "price
 * not set" — never $0 — and an order including the item can't be saved
 * until it has one. The server re-validates everything; this form only
 * catches mistakes early.
 *
 * Phase 5C-3 finalization: an FTC classification (or "Pending review"), and —
 * for an added item — an optional link to one inventory-tracked merchandise
 * record, whose price and stock then apply (the item keeps no price of its
 * own). A classification is never guessed from a name or category.
 */

/** "$1,234.50" / "1234.5" / "1234" -> 123450; anything else (negative,
    more than two decimals, non-numeric) -> null. String-based, so no
    floating-point rounding ever touches the cents value. */
export function parseDollarsToCents(input: string): number | null {
  const cleaned = input.trim().replace(/^\$/, '').replace(/,/g, '');
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!match) return null;
  const cents = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
  return Number.isSafeInteger(cents) && cents <= MAX_PRICE_CENTS ? cents : null;
}

const MAX_PRICE_CENTS = 100_000_000;

export function centsToDollarInput(cents: number | null): string {
  return cents === null ? '' : (cents / 100).toFixed(2);
}

const ITEM_CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{1,39}$/;

export function CatalogItemEditorModal({
  open,
  item,
  categories,
  linkableProducts = null,
  onClose,
}: {
  open: boolean;
  /** null = add a new item. */
  item: ServiceCatalogItem | null;
  categories: ServiceCatalogCategory[];
  /** Merchandise records this item may be linked to (already filtered to
      this organization's active, unlinked, non-variant products), or null
      when the viewer can't read merchandise. */
  linkableProducts?: MerchandiseProduct[] | null;
  onClose: () => void;
}) {
  const isNew = item === null;
  const [itemCode, setItemCode] = useState('');
  const [displayName, setDisplayName] = useState(item?.displayName ?? '');
  const [description, setDescription] = useState(item?.description ?? '');
  const [categoryId, setCategoryId] = useState(item?.categoryId ?? '');
  const [pricingType, setPricingType] = useState<'flat' | 'per_unit'>(item?.pricingType === 'per_unit' ? 'per_unit' : 'flat');
  const [price, setPrice] = useState(centsToDollarInput(item?.defaultPrice ?? null));
  const [ftcClass, setFtcClass] = useState(ftcClassValue(item?.ftcClass));
  const [productId, setProductId] = useState(item?.merchandiseProductId ?? '');
  const isPrimary = item?.category === SERVICE_TYPE_CATEGORY;
  const linkedProduct = productId ? (linkableProducts ?? []).find((product) => product.id === productId) ?? null : null;
  const [error, setError] = useState<string | null>(null);
  const createItem = useCreateCatalogItem();
  const updateItem = useUpdateCatalogItem();
  const isSaving = createItem.isPending || updateItem.isPending;

  const normalizedCode = itemCode.trim().toUpperCase();
  const codeInvalid = isNew && normalizedCode !== '' && !ITEM_CODE_PATTERN.test(normalizedCode);
  // A linked item takes its price from the inventory record.
  const priceCents = productId ? null : price.trim() === '' ? null : parseDollarsToCents(price);
  const priceInvalid = !productId && price.trim() !== '' && priceCents === null;
  const nameMissing = displayName.trim() === '';
  const canSubmit = !isSaving && !nameMissing && !priceInvalid && (!isNew || (normalizedCode !== '' && !codeInvalid));
  // A deactivated category stays selectable only for an item already in it.
  const categoryOptions = categories.filter((category) => category.isActive || category.id === item?.categoryId);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    setError(null);
    try {
      if (isNew) {
        await createItem.mutateAsync({
          itemCode: normalizedCode,
          displayName: displayName.trim(),
          description: description.trim() === '' ? null : description.trim(),
          categoryId: categoryId === '' ? null : categoryId,
          pricingType,
          defaultPrice: priceCents,
          ftcClass: ftcClass === '' ? null : ftcClass,
        });
      } else {
        const changes: CatalogItemChanges = {};
        if (displayName.trim() !== item.displayName) changes.displayName = displayName.trim();
        const nextDescription = description.trim() === '' ? null : description.trim();
        if (nextDescription !== (item.description ?? null)) changes.description = nextDescription;
        const nextCategoryId = categoryId === '' ? null : categoryId;
        if (nextCategoryId !== (item.categoryId ?? null)) changes.categoryId = nextCategoryId;
        if (priceCents !== item.defaultPrice) changes.defaultPrice = priceCents;
        const nextFtcClass = ftcClass === '' ? null : ftcClass;
        if (nextFtcClass !== (ftcClassValue(item.ftcClass) || null)) changes.ftcClass = nextFtcClass;
        const nextProductId = productId === '' ? null : productId;
        if (nextProductId !== (item.merchandiseProductId ?? null)) changes.merchandiseProductId = nextProductId;
        if (Object.keys(changes).length > 0) {
          await updateItem.mutateAsync({ itemId: item.id, changes, expectedRevision: item.revision ?? 0 });
        }
      }
      onClose();
    } catch (failure) {
      setError(
        failure instanceof PriceCatalogRequestError || failure instanceof Error ? failure.message : 'The catalog item could not be saved.',
      );
    }
  }

  const title = isNew ? 'Add Catalog Item' : 'Edit Catalog Item';
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <div className="sx-modal-header">
        <h2 className="sx-modal-title">{title}</h2>
        <button type="button" className="sx-icon-btn" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>
      <form onSubmit={handleSubmit}>
        <div className="sx-modal-body">
          <div className="sx-form-grid">
            <div className="sx-field sx-span-all">
              <label className="sx-label" htmlFor="catalog-item-code">
                Item code
              </label>
              {isNew ? (
                <>
                  <TextField
                    className="sx-input"
                    id="catalog-item-code"
                    value={itemCode}
                    onChange={(e) => setItemCode(e.target.value.toUpperCase())}
                    placeholder="e.g. CERTIFIED_COPY"
                    autoComplete="off"
                    aria-invalid={codeInvalid ? true : undefined}
                    aria-describedby="catalog-item-code-help"
                    required
                    autoFocus
                  />
                  <p className="sx-help" id="catalog-item-code-help">
                    2–40 letters, digits, &ldquo;_&rdquo; or &ldquo;-&rdquo;. Unique in your catalog; it can&rsquo;t be changed later.
                  </p>
                  {codeInvalid && <div className="sx-error">Use 2–40 letters, digits, &ldquo;_&rdquo; or &ldquo;-&rdquo;, starting with a letter or digit.</div>}
                </>
              ) : (
                <div id="catalog-item-code" className="sx-cell-title">
                  <code>{item.serviceCode}</code>
                </div>
              )}
            </div>

            <div className="sx-field sx-span-all">
              <label className="sx-label" htmlFor="catalog-item-name">
                Name (shown on case orders and statements)
              </label>
              <TextField className="sx-input" id="catalog-item-name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={120} required autoFocus={!isNew} />
            </div>

            <div className="sx-field sx-span-all">
              <label className="sx-label" htmlFor="catalog-item-description">
                Description (optional, internal)
              </label>
              <TextArea className="sx-textarea" id="catalog-item-description" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} rows={3} />
            </div>

            <div className="sx-field">
              <label className="sx-label" htmlFor="catalog-item-category">
                Category
              </label>
              <SelectField className="sx-select" id="catalog-item-category" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                <option value="">No category</option>
                {categoryOptions.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                    {category.isActive ? '' : ' (inactive)'}
                  </option>
                ))}
              </SelectField>
            </div>

            <div className="sx-field">
              <span className="sx-label" id="catalog-item-pricing-label">
                Pricing
              </span>
              {isNew ? (
                <div role="radiogroup" aria-labelledby="catalog-item-pricing-label">
                  <label style={{ display: 'block' }}>
                    <input type="radio" name="catalog-item-pricing" checked={pricingType === 'flat'} onChange={() => setPricingType('flat')} /> Flat — charged once
                  </label>
                  <label style={{ display: 'block' }}>
                    <input type="radio" name="catalog-item-pricing" checked={pricingType === 'per_unit'} onChange={() => setPricingType('per_unit')} /> Per unit — times a quantity
                  </label>
                </div>
              ) : (
                <div>
                  {item.category === SERVICE_TYPE_CATEGORY ? 'Primary service — one per case order' : item.pricingType === 'per_unit' ? 'Per unit' : 'Flat'}
                </div>
              )}
            </div>

            <div className="sx-field sx-span-all">
              <label className="sx-label" htmlFor="catalog-item-ftc">
                FTC classification
              </label>
              <SelectField className="sx-select" id="catalog-item-ftc" value={ftcClass} onChange={(e) => setFtcClass(e.target.value)} aria-describedby="catalog-item-ftc-help">
                {FTC_CLASS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </SelectField>
              <p className="sx-help" id="catalog-item-ftc-help">
                How this item is presented on statements under the FTC Funeral Rule. Choose it from your approved General Price List — it is
                never set automatically. Orders already saved keep the classification they were saved with.
              </p>
            </div>

            {!isPrimary && linkableProducts !== null && (
              <div className="sx-field sx-span-all">
                <label className="sx-label" htmlFor="catalog-item-product">
                  Inventory record (merchandise)
                </label>
                <SelectField className="sx-select" id="catalog-item-product" value={productId} onChange={(e) => setProductId(e.target.value)}>
                  <option value="">Not linked</option>
                  {linkableProducts.map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.name} ({product.sku})
                    </option>
                  ))}
                </SelectField>
                <p className="sx-help">
                  {linkableProducts.length === 0
                    ? 'No inventory-tracked merchandise records are available to link yet.'
                    : 'Linking uses the inventory record’s stock and price. Stock only changes through the inventory system — never by linking.'}
                </p>
              </div>
            )}

            <div className="sx-field sx-span-all">
              <label className="sx-label" htmlFor="catalog-item-price">
                Price ($){pricingType === 'per_unit' ? ' per unit' : ''}
              </label>
              {linkedProduct && (
                <p className="sx-help">Price from the inventory record: {formatCentsAsCurrency(linkedProduct.retailPrice, 'usd')}</p>
              )}
              <TextField
                className="sx-input"
                id="catalog-item-price"
                inputMode="decimal"
                placeholder={productId ? 'Set by the inventory record' : 'Leave blank if not set yet'}
                disabled={Boolean(productId)}
                value={productId ? '' : price}
                onChange={(e) => setPrice(e.target.value)}
                aria-invalid={priceInvalid ? true : undefined}
                style={{ maxWidth: 220 }}
              />
              {priceInvalid && <div className="sx-error">Enter a dollar amount, e.g. 1250.00</div>}
              <p className="sx-help">
                A new price applies to items added to case orders from now on. Existing orders, statements and receipts keep the prices they
                were saved with.
              </p>
            </div>
          </div>

          {error && (
            <div className="sx-form-banner sx-form-banner-error" role="alert">
              {error}
            </div>
          )}
        </div>

        <div className="sx-modal-footer">
          <button type="button" className="sx-btn sx-btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="sx-btn sx-btn-primary" disabled={!canSubmit}>
            {isSaving ? 'Saving…' : isNew ? 'Add Item' : 'Save'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
