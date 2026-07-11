import { useEffect, useState } from 'react';
import type { CustomerWithBalance, LocalLedgerEntry } from '../../lib/db';
import { getCustomerLedgerLocal } from '../../lib/db';
import { formatCurrency } from '../../lib/format';
import { SyncStatusBadge } from '../history/SyncStatusBadge';
import { DebtPaymentModal } from './DebtPaymentModal';

const entryLabels: Record<LocalLedgerEntry['kind'], string> = {
  credit_sale: 'Продажа в долг',
  payment: 'Оплата долга',
};

export function CustomerDetail({
  customer,
  onChanged,
}: {
  customer: CustomerWithBalance;
  onChanged: () => void;
}) {
  const [ledger, setLedger] = useState<LocalLedgerEntry[]>([]);
  const [loadingLedger, setLoadingLedger] = useState(true);
  const [showPayment, setShowPayment] = useState(false);

  const debt = Number(customer.local_balance || 0);

  // Reload on customer switch AND whenever the derived debt changes (i.e. after a payment).
  useEffect(() => {
    let cancelled = false;
    setLoadingLedger(true);
    getCustomerLedgerLocal(customer.client_customer_id).then((rows) => {
      if (!cancelled) {
        setLedger(rows);
        setLoadingLedger(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [customer.client_customer_id, customer.local_balance]);

  const handleSaved = () => {
    setShowPayment(false);
    onChanged();
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-gray-100 p-4 dark:border-gray-700">
        <p className="text-xs uppercase tracking-wide text-gray-400">Выбранный клиент</p>
        <h2 className="mt-1 text-lg font-black text-gray-900 dark:text-white">{customer.name}</h2>
        {customer.phone && <p className="text-sm text-gray-500">{customer.phone}</p>}
        <div className="mt-3 rounded-2xl bg-red-50 p-3 dark:bg-red-900/20">
          <p className="text-xs text-red-500">Текущий долг</p>
          <p className="text-2xl font-black tabular-nums text-red-600">{formatCurrency(debt)}</p>
        </div>
        <button
          type="button"
          onClick={() => setShowPayment(true)}
          disabled={debt <= 0}
          className="mt-3 w-full rounded-xl bg-green-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:bg-gray-300"
        >
          Принять оплату долга
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <p className="mb-3 text-sm font-bold text-gray-900 dark:text-white">История долга (локально)</p>
        {loadingLedger ? (
          <p className="py-6 text-center text-sm text-gray-400">Загрузка истории…</p>
        ) : ledger.length === 0 ? (
          <p className="py-6 text-center text-sm text-gray-400">Нет несинхронизированных операций</p>
        ) : (
          <div className="space-y-2">
            {ledger.map((entry) => (
              <div key={entry.ref_id} className="rounded-xl bg-gray-50 p-3 dark:bg-gray-700/50">
                <div className="flex justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-gray-900 dark:text-white">
                      {entryLabels[entry.kind]}
                      {entry.kind === 'credit_sale' && entry.receipt_no != null ? ` · чек #${entry.receipt_no}` : ''}
                    </p>
                    {entry.description && <p className="truncate text-xs text-gray-400">{entry.description}</p>}
                    {entry.kind === 'payment' &&
                      entry.sync_status === 'synced' &&
                      entry.applied_amount != null &&
                      entry.applied_amount < Math.abs(entry.amount) && (
                        <p className="mt-0.5 text-xs font-medium text-amber-600">
                          переплата не применена (учтено {formatCurrency(entry.applied_amount)})
                        </p>
                      )}
                    <span className="mt-1 inline-block">
                      <SyncStatusBadge syncStatus={entry.sync_status} errorKind={entry.error_kind} />
                    </span>
                  </div>
                  <span className={`shrink-0 font-black tabular-nums ${entry.amount >= 0 ? 'text-red-600' : 'text-green-600'}`}>
                    {entry.amount >= 0 ? '+' : ''}
                    {formatCurrency(entry.amount)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showPayment && (
        <DebtPaymentModal customer={customer} onClose={() => setShowPayment(false)} onSaved={handleSaved} />
      )}
    </div>
  );
}
