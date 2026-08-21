import type { MerchandiseProduct } from '../../types/merchandiseProduct';
import type { InventoryMovement } from '../../types/inventoryMovement';
import type { InventoryReservation } from '../../types/inventoryReservation';
import type { InventoryBalance } from '../../types/inventoryBalance';

/**
 * Phase 35 (Merchandise, Inventory & Commerce). Mock fixtures for the
 * merchandise/inventory collections. All start EMPTY: no merchandise data
 * exists anywhere in Beacon today (confirmed — `serviceCatalog` is services,
 * not merchandise), so there is nothing to seed and no historical migration.
 * Tests populate these through the services under test, exactly as the
 * Phase 19C caseOrder fixtures do.
 *
 * Exported as mutable arrays so mock-mode service writes push/splice into
 * them — the same convention every other `__mocks__/*Fixtures.ts` file uses.
 */
export const merchandiseProductFixtures: MerchandiseProduct[] = [];
export const inventoryMovementFixtures: InventoryMovement[] = [];
export const inventoryReservationFixtures: InventoryReservation[] = [];
export const inventoryBalanceFixtures: InventoryBalance[] = [];

/** Ephemeral per-stock-line lease + write-claim rows (services/inventoryLockService.ts).
    Internal to the lock mechanism — never a domain entity. */
export type InventoryLockRow = { id: string; lockKey: string; lockToken: string; fenceToken: number; lockedAt: string; expiresAt: string };
export type InventoryWriteClaimRow = { id: string; lockKey: string; lockToken: string; fenceToken: number; claimedAt: string; expiresAt: string };
export const inventoryLockFixtures: InventoryLockRow[] = [];
export const inventoryWriteClaimFixtures: InventoryWriteClaimRow[] = [];
