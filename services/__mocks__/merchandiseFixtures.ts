import type { MerchandiseProduct } from '../../types/merchandiseProduct';
import type { MerchandiseProductVariant } from '../../types/merchandiseProductVariant';
import type { InventoryMovement } from '../../types/inventoryMovement';
import type { InventoryReservation } from '../../types/inventoryReservation';
import type { InventoryBalance } from '../../types/inventoryBalance';
import { mockCollection } from './mockStore';

/**
 * Phase 35 (Merchandise, Inventory & Commerce). Mock fixtures for the
 * merchandise/inventory collections. All start EMPTY: no merchandise data
 * exists anywhere in Solis today (confirmed — `serviceCatalog` is services,
 * not merchandise), so there is nothing to seed and no historical migration.
 * Tests populate these through the services under test, exactly as the
 * Phase 19C caseOrder fixtures do.
 *
 * Exported as mutable arrays so mock-mode service writes push/splice into
 * them — the same convention every other `__mocks__/*Fixtures.ts` file uses.
 */
export const merchandiseProductFixtures: MerchandiseProduct[] = mockCollection('merchandiseProductFixtures', (): MerchandiseProduct[] => []);
/** Phase 37 (Product Variants — ADR-041). */
export const merchandiseProductVariantFixtures: MerchandiseProductVariant[] = mockCollection('merchandiseProductVariantFixtures', (): MerchandiseProductVariant[] => []);
export const inventoryMovementFixtures: InventoryMovement[] = mockCollection('inventoryMovementFixtures', (): InventoryMovement[] => []);
export const inventoryReservationFixtures: InventoryReservation[] = mockCollection('inventoryReservationFixtures', (): InventoryReservation[] => []);
export const inventoryBalanceFixtures: InventoryBalance[] = mockCollection('inventoryBalanceFixtures', (): InventoryBalance[] => []);

/** Ephemeral per-stock-line lease + write-claim rows (services/inventoryLockService.ts).
    Internal to the lock mechanism — never a domain entity. */
export type InventoryLockRow = { id: string; lockKey: string; lockToken: string; fenceToken: number; lockedAt: string; expiresAt: string };
export type InventoryWriteClaimRow = { id: string; lockKey: string; lockToken: string; fenceToken: number; claimedAt: string; expiresAt: string };
export const inventoryLockFixtures: InventoryLockRow[] = mockCollection('inventoryLockFixtures', (): InventoryLockRow[] => []);
export const inventoryWriteClaimFixtures: InventoryWriteClaimRow[] = mockCollection('inventoryWriteClaimFixtures', (): InventoryWriteClaimRow[] => []);
