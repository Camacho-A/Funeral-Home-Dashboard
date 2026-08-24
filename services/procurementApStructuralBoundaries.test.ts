import { readdirSync, readFileSync, statSync } from 'fs';
import { extname, join, sep } from 'path';
import { describe, expect, it } from 'vitest';

/**
 * Phase 36 (Procurement & Accounts Payable). Structural boundary tests
 * (ADR-040), mirroring the Phase 35 harness. They prove — by grepping the
 * real source — the approved architectural invariants: PO commitments never
 * post to the GL, receiving stays owned by the inventory subsystem, AP never
 * mutates inventory or fabricates receipts, bill lines are first-class,
 * vendor payments never use the customer PaymentService, posted journals are
 * corrected by reversal (never destructive delete), targeted per-aggregate
 * leasing (no org-wide AP lock) guards posting-sensitive transitions,
 * ActivityService/NotificationService/ledger ownership is unchanged, routes
 * carry no accounting logic, and no Family Portal surface can expose
 * procurement/AP/cost data.
 */
const SKIP_DIRS = new Set(['node_modules', '.next', '.git']);
function walk(dir: string, results: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const fullPath = join(dir, entry);
    if (statSync(fullPath).isDirectory()) walk(fullPath, results);
    else if (['.ts', '.tsx'].includes(extname(fullPath)) && !fullPath.endsWith('.test.ts') && !fullPath.endsWith('.test.tsx')) results.push(fullPath);
  }
  return results;
}
const root = join(__dirname, '..');
const allFiles = walk(root);
const read = (f: string) => readFileSync(f, 'utf8');
const rel = (f: string) => f.slice(root.length + 1);
function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

describe('Procurement/AP collection writers (structural)', () => {
  const writers: Record<string, string> = {
    suppliers: join(__dirname, 'supplierService.ts'),
    purchaseOrders: join(__dirname, 'purchaseOrderService.ts'),
    purchaseOrderLineItems: join(__dirname, 'purchaseOrderService.ts'),
    vendorBills: join(__dirname, 'accountsPayableService.ts'),
    vendorBillLineItems: join(__dirname, 'accountsPayableService.ts'),
    billPayments: join(__dirname, 'accountsPayableService.ts'),
  };
  for (const [collection, writerPath] of Object.entries(writers)) {
    it(`only ${writerPath.split(sep).pop()} writes to "${collection}"`, () => {
      const pattern = new RegExp(`(?:insertWixDataItem|updateWixDataItem|deleteWixDataItem)(?:<[^>]*>)?\\(\\s*['"]${collection}['"]`);
      const offenders = allFiles.filter((f) => f !== writerPath && pattern.test(read(f)));
      expect(offenders, `unexpected writer(s) of "${collection}": ${offenders.map(rel).join(', ')}`).toEqual([]);
    });
  }
});

describe('Procurement/AP activity-event emitter boundary (structural)', () => {
  const emitters: Record<string, string> = {
    SUPPLIER_CREATED: 'supplierService.ts', SUPPLIER_UPDATED: 'supplierService.ts', SUPPLIER_ARCHIVED: 'supplierService.ts',
    PURCHASE_ORDER_CREATED: 'purchaseOrderService.ts', PURCHASE_ORDER_SUBMITTED: 'purchaseOrderService.ts', PURCHASE_ORDER_RECEIVED: 'purchaseOrderService.ts', PURCHASE_ORDER_CLOSED: 'purchaseOrderService.ts', PURCHASE_ORDER_CANCELLED: 'purchaseOrderService.ts',
    VENDOR_BILL_CREATED: 'accountsPayableService.ts', VENDOR_BILL_VOIDED: 'accountsPayableService.ts', BILL_PAYMENT_RECORDED: 'accountsPayableService.ts',
  };
  for (const [key, emitterFile] of Object.entries(emitters)) {
    it(`only activityService.ts and ${emitterFile} reference ACTIVITY_EVENT_TYPES.${key}`, () => {
      const pattern = new RegExp(`ACTIVITY_EVENT_TYPES\\.${key}\\b`);
      const allowed = new Set([join(__dirname, 'activityService.ts'), join(__dirname, emitterFile)]);
      const offenders = allFiles.filter((f) => !allowed.has(f) && pattern.test(read(f)));
      expect(offenders, `unexpected emitter(s) of ${key}: ${offenders.map(rel).join(', ')}`).toEqual([]);
    });
  }
});

describe('Purchase Orders never post to the GL (structural)', () => {
  it('purchaseOrderService.ts never calls createAndPostJournalEntry or reverseJournalEntry', () => {
    const src = read(join(__dirname, 'purchaseOrderService.ts'));
    expect(/createAndPostJournalEntry\s*\(/.test(src), 'a PO must be a non-posting commitment').toBe(false);
    expect(/reverseJournalEntry\s*\(/.test(src)).toBe(false);
  });
});

describe('AP never mutates inventory / fabricates receipts (structural)', () => {
  it('accountsPayableService.ts never writes inventory collections or calls receiveStock/insertMovement', () => {
    const src = read(join(__dirname, 'accountsPayableService.ts'));
    for (const col of ['inventoryMovements', 'inventoryBalances', 'inventoryReservations']) {
      expect(new RegExp(`(?:insertWixDataItem|updateWixDataItem|deleteWixDataItem)\\([^)]*['"]${col}['"]`).test(src), `AP wrote ${col}`).toBe(false);
    }
    expect(/\breceiveStock\s*\(/.test(src), 'AP must not receive/fabricate stock').toBe(false);
    expect(/\binsertMovement\s*\(/.test(src)).toBe(false);
  });
  it('receiving remains owned by inventoryService — purchaseOrderService receives THROUGH it, never writes inventoryMovements', () => {
    const src = read(join(__dirname, 'purchaseOrderService.ts'));
    expect(/from ['"]\.\/inventoryService['"]/.test(src) && /\breceiveStock\b/.test(src), 'PO receiving must delegate to inventoryService.receiveStock').toBe(true);
    expect(/(?:insertWixDataItem|updateWixDataItem)\([^)]*['"]inventoryMovements['"]/.test(src)).toBe(false);
  });
});

describe('AP bill lines are first-class records, not embedded JSON (structural)', () => {
  it('a dedicated vendorBillLineItems type + mapper exist', () => {
    expect(allFiles.some((f) => rel(f) === join('types', 'vendorBillLineItem.ts'))).toBe(true);
    expect(allFiles.some((f) => rel(f) === join('lib', 'wixVendorBillLineItemMapper.ts'))).toBe(true);
  });
  it('the VendorBill type does not embed a lines/goodsLines array', () => {
    const src = read(join(root, 'types', 'vendorBill.ts'));
    expect(/^\s*(?:lines|goodsLines|lineItems)\s*:/m.test(src), 'bill lines must be their own collection').toBe(false);
  });
});

describe('AP posts only through the ledger; routes carry no accounting logic (structural)', () => {
  it('no route/UI calls createAndPostJournalEntry or buildVendorBillPosting', () => {
    const surface = (f: string) => rel(f).startsWith('app' + sep) || rel(f).startsWith('components' + sep) || rel(f).startsWith('hooks' + sep);
    const pattern = /createAndPostJournalEntry\s*\(|buildVendorBillPosting\s*\(|buildBillPaymentPosting\s*\(/;
    const offenders = allFiles.filter((f) => surface(f) && pattern.test(read(f)));
    expect(offenders, `route/UI contains accounting logic: ${offenders.map(rel).join(', ')}`).toEqual([]);
  });
  it('procurement/accounting-bill routes do not import the ledger posting or vendorBillPosting directly', () => {
    const routeFiles = allFiles.filter((f) => rel(f).startsWith(join('app', 'api', 'procurement')) || rel(f).startsWith(join('app', 'api', 'accounting', 'bills')));
    expect(routeFiles.length).toBeGreaterThan(0);
    const pattern = /vendorBillPosting|from ['"][^'"]*generalLedgerService['"]/;
    const offenders = routeFiles.filter((f) => pattern.test(read(f)));
    expect(offenders, `AP route imports ledger/posting: ${offenders.map(rel).join(', ')}`).toEqual([]);
  });
});

describe('Vendor payments never use the customer PaymentService/PaymentRecord (structural)', () => {
  it('accountsPayableService.ts imports no customer payment module', () => {
    const src = read(join(__dirname, 'accountsPayableService.ts'));
    const code = stripComments(src); // inspect real code, not the doc comment that names the boundary
    for (const mod of ['paymentWorkflow', 'paymentService', 'cloverProvider', 'paymentProvider', 'paymentRecord']) {
      expect(new RegExp(`from ['"][^'"]*${mod}['"]`, 'i').test(code), `AP must not use ${mod}`).toBe(false);
    }
    expect(/PaymentRecord\b/.test(code), 'AP must not reference customer PaymentRecord in code').toBe(false);
  });
});

describe('Posted journals corrected by reversal, never destructive delete (structural)', () => {
  it('accountsPayableService.ts uses reverseJournalEntry and never deletes journalEntries', () => {
    const src = read(join(__dirname, 'accountsPayableService.ts'));
    expect(/reverseJournalEntry\s*\(/.test(src), 'void must reverse').toBe(true);
    expect(/deleteWixDataItem\s*\(\s*['"]journalEntries['"]/.test(src), 'never delete a posted entry').toBe(false);
  });
});

describe('Targeted per-aggregate leasing; no org-wide AP lock (structural)', () => {
  it('AP + PO services lease via aggregateLeaseService, never organizationLockService', () => {
    for (const svc of ['accountsPayableService.ts', 'purchaseOrderService.ts']) {
      const src = read(join(__dirname, svc));
      expect(/from ['"]\.\/aggregateLeaseService['"]/.test(src), `${svc} must use aggregate leases`).toBe(true);
      expect(/organizationLockService/.test(src), `${svc} must not introduce an org-wide lock`).toBe(false);
    }
  });
});

describe('ActivityService / NotificationService ownership unchanged (structural)', () => {
  it('procurement services never write activityEvents / notifications collections directly', () => {
    for (const svc of ['supplierService.ts', 'purchaseOrderService.ts', 'accountsPayableService.ts', 'accountsPayableNotifications.ts']) {
      const src = read(join(__dirname, svc));
      for (const col of ['activityEvents', 'notifications', 'notificationRecipients']) {
        expect(new RegExp(`(?:insertWixDataItem|updateWixDataItem)\\([^)]*['"]${col}['"]`).test(src), `${svc} wrote ${col} directly`).toBe(false);
      }
    }
  });
});

describe('ap.pay independently enforceable from ap.manage (structural)', () => {
  it('a distinct canPayAccountsPayable policy gates ap.pay', () => {
    const src = read(join(__dirname, 'authorizationPolicyService.ts'));
    expect(/canPayAccountsPayable[\s\S]*?['"]ap\.pay['"]/.test(src)).toBe(true);
    expect(/canManageAccountsPayable[\s\S]*?['"]ap\.manage['"]/.test(src)).toBe(true);
  });
});

describe('Family Portal cannot expose procurement/AP/cost data (structural)', () => {
  const familyFiles = allFiles.filter((f) => rel(f).startsWith(join('app', 'api', 'family')) || rel(f).includes(join('portal', 'portal')) || rel(f).includes('portalMerchandise') || rel(f).startsWith(join('components', 'family')) || rel(f).startsWith(join('app', 'family')));
  it('found family-portal surface files (sanity)', () => {
    expect(familyFiles.length).toBeGreaterThan(0);
  });
  it('no family surface imports a procurement/AP service or references supplier/bill/PO/vendor-payment/cost', () => {
    const importPattern = /from ['"][^'"]*(?:supplierService|purchaseOrderService|accountsPayableService|accountsPayableReportingService)['"]/;
    const leakPattern = /\bsupplierService\b|\bvendorBill\b|\bpurchaseOrder\b|\bbillPayment\b|\.cost\b|\bcost\s*:/i;
    const offenders = familyFiles.filter((f) => {
      const code = stripComments(read(f));
      return importPattern.test(code) || leakPattern.test(code);
    });
    expect(offenders, `family surface exposes procurement/AP/cost: ${offenders.map(rel).join(', ')}`).toEqual([]);
  });
});

describe('Phase 36 layering invariant — new operational types (structural)', () => {
  for (const fileName of ['supplier.ts', 'purchaseOrder.ts', 'purchaseOrderLineItem.ts', 'vendorBill.ts', 'vendorBillLineItem.ts', 'billPayment.ts']) {
    it(`${fileName} declares no forbidden *IdentityId field`, () => {
      const source = read(join(root, 'types', fileName));
      const fieldPattern = /^\s*(\w+)\??:\s*/gm;
      const offenders: string[] = [];
      let m: RegExpExecArray | null;
      while ((m = fieldPattern.exec(source)) !== null) if (m[1].endsWith('IdentityId')) offenders.push(m[1]);
      expect(offenders).toEqual([]);
    });
  }
});
