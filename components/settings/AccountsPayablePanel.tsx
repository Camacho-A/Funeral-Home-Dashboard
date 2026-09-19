'use client';

import { useState } from 'react';
import { useOrganization } from '@/hooks/useOrganization';
import { useSuppliers, useBills, useCreateBill, useVoidBill, useRecordPayment } from '@/hooks/useProcurement';
import { useMyPermissions } from '@/hooks/useRbac';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { SelectField } from '@/components/ui/SelectField';
import { EmptyState } from '@/components/ui/EmptyState';

/**
 * Phase 36 (Procurement & Accounts Payable). Settings → Accounts Payable.
 * Lists vendor bills with their status and outstanding balance; supports
 * entering an expense-only (non-PO) bill, recording a payment, and voiding.
 * Every amount and journal entry is computed server-side — this panel only
 * submits intent. Actions are gated by ap.read / ap.manage / ap.pay; a user
 * with ap.manage but not ap.pay simply gets a 403 on the payment call.
 * Goods bills (PO receipt matching) are entered from the purchase-order flow.
 */
function dollarsToCents(v: string): number {
  return Math.round(Number(v) * 100);
}
function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function AccountsPayablePanel() {
  const { organizationId } = useOrganization();
  const myPermissionsQuery = useMyPermissions(organizationId);
  const suppliersQuery = useSuppliers(organizationId, false);
  const billsQuery = useBills(organizationId);
  const createBill = useCreateBill(organizationId);
  const voidBill = useVoidBill(organizationId);
  const recordPayment = useRecordPayment(organizationId);

  const [billForm, setBillForm] = useState({ supplierId: '', billNumber: '', dueDate: '', accountNumber: '5010', amount: '' });
  const [payFor, setPayFor] = useState<string | null>(null);
  const [payForm, setPayForm] = useState({ amount: '', method: 'check', cashAccountNumber: '1000', referenceNumber: '' });
  const [error, setError] = useState<string | null>(null);

  if (myPermissionsQuery.isPending) {
    return <p>Loading accounts payable…</p>;
  }

  // Manors go-live hardening: a page/UI guard, not just relying on the
  // underlying supplier/bill routes' own ap.read enforcement — production
  // testing showed this panel rendered the full AP workflow (supplier
  // picker, bill entry, vendor bill list) for a caller lacking ap.read,
  // since it had no permission check of its own at all.
  if (!(myPermissionsQuery.data?.permissions ?? []).includes('ap.read')) {
    return <EmptyState message="You don't have access to accounts payable for this organization." />;
  }

  const suppliers = suppliersQuery.data ?? [];
  const bills = billsQuery.data ?? [];

  async function handleCreateExpenseBill(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await createBill.mutateAsync({
        organizationId,
        supplierId: billForm.supplierId,
        billNumber: billForm.billNumber.trim(),
        billDate: new Date().toISOString(),
        dueDate: billForm.dueDate ? new Date(billForm.dueDate).toISOString() : new Date().toISOString(),
        goodsLines: [],
        expenseLines: [{ accountNumber: billForm.accountNumber.trim(), amountCents: dollarsToCents(billForm.amount || '0') }],
      });
      setBillForm({ supplierId: '', billNumber: '', dueDate: '', accountNumber: '5010', amount: '' });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to enter bill.');
    }
  }

  async function handlePay(billId: string) {
    setError(null);
    try {
      await recordPayment.mutateAsync({ billId, input: { organizationId, amountCents: dollarsToCents(payForm.amount || '0'), paymentDate: new Date().toISOString(), method: payForm.method, cashAccountNumber: payForm.cashAccountNumber.trim(), referenceNumber: payForm.referenceNumber.trim() || null } });
      setPayFor(null);
      setPayForm({ amount: '', method: 'check', cashAccountNumber: '1000', referenceNumber: '' });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to record payment.');
    }
  }

  return (
    <div>
      <Card>
        <h2>New expense bill (non-PO)</h2>
        <form onSubmit={handleCreateExpenseBill}>
          <SelectField value={billForm.supplierId} onChange={(e) => setBillForm({ ...billForm, supplierId: e.target.value })}>
            <option value="">Select supplier…</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </SelectField>
          <TextField placeholder="Bill / invoice number" value={billForm.billNumber} onChange={(e) => setBillForm({ ...billForm, billNumber: e.target.value })} required />
          <TextField type="date" placeholder="Due date" value={billForm.dueDate} onChange={(e) => setBillForm({ ...billForm, dueDate: e.target.value })} />
          <TextField placeholder="Expense account #" value={billForm.accountNumber} onChange={(e) => setBillForm({ ...billForm, accountNumber: e.target.value })} />
          <TextField type="number" step="0.01" placeholder="Amount ($)" value={billForm.amount} onChange={(e) => setBillForm({ ...billForm, amount: e.target.value })} />
          {error && <p role="alert">{error}</p>}
          <Button type="submit" disabled={createBill.isPending || !billForm.supplierId}>Enter bill</Button>
        </form>
      </Card>

      <Card>
        <h2>Vendor bills</h2>
        {bills.length === 0 ? (
          <EmptyState message="No vendor bills yet." />
        ) : (
          <ul>
            {bills.map((b) => {
              const outstanding = b.totalAmountCents - b.amountPaidCents;
              return (
                <li key={b.id}>
                  <strong>{b.billNumber}</strong> — {b.status} — total {money(b.totalAmountCents)}, outstanding {money(outstanding)}
                  {b.netVarianceCents !== 0 && <span> — variance {money(b.netVarianceCents)}</span>}{' '}
                  {b.status !== 'void' && b.status !== 'paid' && <Button type="button" onClick={() => setPayFor(payFor === b.id ? null : b.id)}>Record payment</Button>}
                  {b.status !== 'void' && b.amountPaidCents === 0 && <Button type="button" onClick={() => voidBill.mutate({ billId: b.id })} disabled={voidBill.isPending}>Void</Button>}
                  {payFor === b.id && (
                    <div>
                      <TextField type="number" step="0.01" placeholder="Amount ($)" value={payForm.amount} onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })} />
                      <SelectField value={payForm.method} onChange={(e) => setPayForm({ ...payForm, method: e.target.value })}>
                        <option value="check">Check</option>
                        <option value="ach">ACH</option>
                        <option value="card">Card</option>
                        <option value="cash">Cash</option>
                        <option value="other">Other</option>
                      </SelectField>
                      <TextField placeholder="Cash account #" value={payForm.cashAccountNumber} onChange={(e) => setPayForm({ ...payForm, cashAccountNumber: e.target.value })} />
                      <TextField placeholder="Reference #" value={payForm.referenceNumber} onChange={(e) => setPayForm({ ...payForm, referenceNumber: e.target.value })} />
                      <Button type="button" onClick={() => handlePay(b.id)} disabled={recordPayment.isPending}>Save payment</Button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
