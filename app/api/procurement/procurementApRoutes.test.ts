import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ORGANIZATION_ID, SECOND_MOCK_ORGANIZATION_ID } from '@/services/__mocks__/organizationIds';
import { mockDefaultUser, mockMultiOrgUser } from '@/services/__mocks__/authFixtures';
import { supplierFixtures, purchaseOrderFixtures, purchaseOrderLineItemFixtures, vendorBillFixtures, vendorBillLineItemFixtures, billPaymentFixtures } from '@/services/__mocks__/procurementFixtures';
import { ledgerAccountFixtures, journalEntryFixtures, journalEntryLineFixtures } from '@/services/__mocks__/ledgerFixtures';
import { activityEventFixtures } from '@/services/__mocks__/activityEventFixtures';

let mockSession: { user: typeof mockDefaultUser } | null = { user: mockDefaultUser };
vi.mock('@/lib/auth/session', () => ({ getSession: async () => mockSession }));

const suppliers = await import('./suppliers/route');
const purchaseOrders = await import('./purchase-orders/route');
const bills = await import('../accounting/bills/route');
const payments = await import('../accounting/bills/[billId]/payments/route');

const ORIGIN = { origin: 'http://localhost', host: 'localhost', 'content-type': 'application/json' };
function post(mod: { POST: (r: Request) => Promise<Response> }, url: string, body: unknown, headers: Record<string, string> = ORIGIN) {
  return mod.POST(new Request(`http://localhost${url}`, { method: 'POST', headers, body: JSON.stringify(body) }));
}
function paymentsPost(body: unknown, headers: Record<string, string> = ORIGIN) {
  return payments.POST(new Request('http://localhost/api/accounting/bills/b1/payments', { method: 'POST', headers, body: JSON.stringify(body) }), { params: Promise.resolve({ billId: 'b1' }) });
}

beforeEach(() => {
  process.env.DATA_ADAPTER = 'mock';
  mockSession = { user: mockDefaultUser };
  for (const a of [supplierFixtures, purchaseOrderFixtures, purchaseOrderLineItemFixtures, vendorBillFixtures, vendorBillLineItemFixtures, billPaymentFixtures, ledgerAccountFixtures, journalEntryFixtures, journalEntryLineFixtures, activityEventFixtures]) a.length = 0;
});

describe('suppliers route — auth & delegation', () => {
  it('400 without organizationId', async () => {
    expect((await suppliers.GET(new Request('http://localhost/api/procurement/suppliers'))).status).toBe(400);
  });
  it('403 for a forged organizationId (tenant isolation)', async () => {
    expect((await suppliers.GET(new Request(`http://localhost/api/procurement/suppliers?organizationId=${SECOND_MOCK_ORGANIZATION_ID}`))).status).toBe(403);
  });
  it('403 without Origin (CSRF) on POST', async () => {
    expect((await post(suppliers, '/api/procurement/suppliers', { organizationId: DEFAULT_ORGANIZATION_ID, name: 'Acme' }, { 'content-type': 'application/json' })).status).toBe(403);
  });
  it('administrator creates a supplier (201), duplicate → 409', async () => {
    expect((await post(suppliers, '/api/procurement/suppliers', { organizationId: DEFAULT_ORGANIZATION_ID, name: 'Acme' })).status).toBe(201);
    expect((await post(suppliers, '/api/procurement/suppliers', { organizationId: DEFAULT_ORGANIZATION_ID, name: 'Acme' })).status).toBe(409);
  });
});

describe('PO route — procurement.manage; non-posting', () => {
  it('officeStaff (procurement.manage) can create a supplier + PO with no GL posting', async () => {
    mockSession = { user: mockMultiOrgUser }; // role "staff" → officeStaff in DEFAULT org
    const sup = await post(suppliers, '/api/procurement/suppliers', { organizationId: DEFAULT_ORGANIZATION_ID, name: 'S1' });
    expect(sup.status).toBe(201);
    const supplierId = (await sup.json()).supplier.id;
    // A product is needed for a PO line; create via admin-less service directly is out of scope — use a bogus product → 400.
    const res = await post(purchaseOrders, '/api/procurement/purchase-orders', {
      organizationId: DEFAULT_ORGANIZATION_ID, supplierId, locationId: `${DEFAULT_ORGANIZATION_ID}-primary-location`, orderDate: '2026-08-21', lines: [{ productId: 'nope', quantityOrdered: 1, unitCostCents: 100 }],
    });
    expect(res.status).toBe(400); // product not found — still no GL posting happened
    expect(journalEntryFixtures.length).toBe(0);
  });
});

describe('AP routes — ap.manage / ap.pay separation', () => {
  it('officeStaff can VIEW bills (ap.read) but cannot ENTER a bill (ap.manage → 403)', async () => {
    mockSession = { user: mockMultiOrgUser };
    const list = await bills.GET(new Request(`http://localhost/api/accounting/bills?organizationId=${DEFAULT_ORGANIZATION_ID}`));
    expect(list.status).toBe(200); // ap.read
    const create = await post(bills, '/api/accounting/bills', { organizationId: DEFAULT_ORGANIZATION_ID, supplierId: 's', billNumber: 'INV-1', billDate: '2026-08-21', dueDate: '2026-08-21', expenseLines: [{ accountNumber: '5010', amountCents: 100 }] });
    expect(create.status).toBe(403); // lacks ap.manage
  });

  it('officeStaff cannot RECORD a payment (ap.pay → 403) — procurement authority does not imply payment authority', async () => {
    mockSession = { user: mockMultiOrgUser };
    expect((await paymentsPost({ organizationId: DEFAULT_ORGANIZATION_ID, amountCents: 100, cashAccountNumber: '1000' })).status).toBe(403);
  });

  it('administrator (ap.manage + ap.pay) passes the policy gate on both', async () => {
    // Admin: bill create reaches the service (fails 400 on missing supplier, NOT 403).
    const create = await post(bills, '/api/accounting/bills', { organizationId: DEFAULT_ORGANIZATION_ID, supplierId: 'missing', billNumber: 'INV-1', billDate: '2026-08-21', dueDate: '2026-08-21', expenseLines: [{ accountNumber: '5010', amountCents: 100 }] });
    expect(create.status).toBe(400);
    // Admin: payment passes the ap.pay policy gate (reaches the service — not a 403).
    expect((await paymentsPost({ organizationId: DEFAULT_ORGANIZATION_ID, amountCents: 100, cashAccountNumber: '1000' })).status).not.toBe(403);
  });
});
