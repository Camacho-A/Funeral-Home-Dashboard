import crypto from 'crypto';
import type { DataAdapterMode } from '../lib/env';
import { createNotification } from './notificationService';
import { NOTIFICATION_TYPES } from '../domain/notifications/notificationTypeRegistry';
import type { ActivityContext } from './activityService';

/**
 * Phase 35 (Merchandise, Inventory & Commerce). The single low-stock
 * notification, fired best-effort exactly once on a downward threshold
 * crossing (services/inventoryService.ts computes the crossing; the routes
 * call this only when `lowStockCrossed` is true). Delivered via
 * `recipientScope: 'role'` to the organization's administrators — inventory
 * oversight is a role-level responsibility, never a specific individual's.
 * Best-effort: a notification failure never fails the stock operation that
 * triggered it, mirroring every other additive notification in this codebase.
 * See docs/adr/ADR-039-merchandise-inventory-and-commerce.md §23/§24.
 */
export async function notifyInventoryLowStock(
  ctx: ActivityContext,
  productId: string,
  productName: string,
  dataAdapterMode: DataAdapterMode,
): Promise<void> {
  try {
    await createNotification(
      {
        notificationType: NOTIFICATION_TYPES.COMMERCE_INVENTORY_LOW_STOCK.key,
        entityType: 'merchandiseProduct',
        entityId: productId,
        recipientScope: 'role',
        recipientRoleKey: 'administrator',
        tokens: { entityTitle: productName },
        idFactory: () => crypto.randomUUID(),
      },
      ctx,
      dataAdapterMode,
    );
  } catch (error) {
    console.error('Failed to send low-stock notification:', error instanceof Error ? error.message : error);
  }
}
