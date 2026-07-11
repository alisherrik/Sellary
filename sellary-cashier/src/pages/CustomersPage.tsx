import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { CustomerWithBalance } from '../lib/db';
import { getCustomersWithLocalBalance } from '../lib/db';
import { CustomerList } from '../components/customers/CustomerList';
import { CustomerDetail } from '../components/customers/CustomerDetail';
import { debtCounts, filterCustomers } from '../components/customers/customerFilter';
import type { DebtFilter } from '../components/customers/customerFilter';

export function CustomersPage() {
  const navigate = useNavigate();
  const [customers, setCustomers] = useState<CustomerWithBalance[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<DebtFilter>('all');
  const [search, setSearch] = useState('');
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const list = await getCustomersWithLocalBalance();
    setCustomers(list);
    setLoading(false);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const counts = useMemo(() => debtCounts(customers), [customers]);
  const visible = useMemo(() => filterCustomers(customers, filter, search), [customers, filter, search]);

  const selected = useMemo(
    () => visible.find((c) => c.client_customer_id === selectedClientId) ?? visible[0] ?? null,
    [visible, selectedClientId],
  );

  // Keep the selection valid when the visible list changes (filter/search/refetch).
  useEffect(() => {
    if (visible.length === 0) {
      setSelectedClientId(null);
      return;
    }
    if (!visible.some((c) => c.client_customer_id === selectedClientId)) {
      setSelectedClientId(visible[0].client_customer_id);
    }
  }, [visible, selectedClientId]);

  return (
    <div className="flex h-screen flex-col bg-gray-50 p-4 dark:bg-gray-900">
      <div className="mb-3 flex items-center gap-3">
        <button onClick={() => navigate('/cashier')} className="text-sm text-blue-600">
          ← Касса
        </button>
        <h1 className="text-lg font-bold text-gray-900 dark:text-white">Клиенты</h1>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row">
        <CustomerList
          customers={visible}
          selectedClientId={selected?.client_customer_id ?? null}
          onSelect={(c) => setSelectedClientId(c.client_customer_id)}
          search={search}
          onSearch={setSearch}
          filter={filter}
          onFilter={setFilter}
          counts={counts}
          loading={loading}
        />
        <aside className="min-h-0 overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800 lg:w-[420px]">
          {selected ? (
            <CustomerDetail customer={selected} onChanged={reload} />
          ) : (
            <div className="p-10 text-center text-sm text-gray-400">Выберите клиента</div>
          )}
        </aside>
      </div>
    </div>
  );
}
