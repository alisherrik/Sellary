import {
  BanknotesIcon, CreditCardIcon, DevicePhoneMobileIcon, MagnifyingGlassIcon, UserPlusIcon,
} from '@heroicons/react/24/outline';
import { formatCurrency } from '../../lib/format';
import { calculateCreditInitialPayment } from '../../lib/posPricing';
import type { CashierCreditPaymentMethod } from '../../lib/pos-payload';
import type { CustomerWithBalance } from '../../lib/db';

const CREDIT_METHODS: { id: CashierCreditPaymentMethod; label: string; Icon: typeof BanknotesIcon }[] = [
  { id: 'cash', label: 'Наличные', Icon: BanknotesIcon },
  { id: 'card', label: 'Карта', Icon: CreditCardIcon },
  { id: 'mobile', label: 'Мобильный', Icon: DevicePhoneMobileIcon },
];

export interface CreditPanelProps {
  total: number;
  customers: CustomerWithBalance[];
  search: string;
  onSearch: (v: string) => void;
  selectedCustomerId: string | null;
  onSelect: (clientCustomerId: string) => void;
  qcName: string;
  onQcName: (v: string) => void;
  qcPhone: string;
  onQcPhone: (v: string) => void;
  qcDescription: string;
  onQcDescription: (v: string) => void;
  creatingCustomer: boolean;
  onCreateCustomer: () => void;
  paidAmount: string;
  onPaidAmount: (v: string) => void;
  paymentMethod: CashierCreditPaymentMethod;
  onPaymentMethod: (m: CashierCreditPaymentMethod) => void;
}

export function CreditPanel(props: CreditPanelProps) {
  const {
    total, customers, search, onSearch, selectedCustomerId, onSelect,
    qcName, onQcName, qcPhone, onQcPhone, qcDescription, onQcDescription,
    creatingCustomer, onCreateCustomer, paidAmount, onPaidAmount, paymentMethod, onPaymentMethod,
  } = props;

  const q = search.trim().toLowerCase();
  const visible = q
    ? customers.filter(
        (c) => c.name.toLowerCase().includes(q) || (c.phone ?? '').toLowerCase().includes(q),
      )
    : customers;

  const credit = calculateCreditInitialPayment(paidAmount, total);
  const canCreate = qcName.trim().length > 0 && qcPhone.trim().length > 0 && !creatingCustomer;

  return (
    <div className="mb-3 space-y-3">
      {/* Search */}
      <div className="relative">
        <MagnifyingGlassIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Поиск клиента…"
          aria-label="Поиск клиента"
          className="h-10 w-full rounded-xl border border-gray-200 bg-white pl-9 pr-3 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-white"
        />
      </div>

      {/* Customer list */}
      <div className="max-h-40 space-y-1 overflow-y-auto">
        {visible.length === 0 ? (
          <p className="px-1 py-2 text-center text-[12px] text-gray-400">Клиенты не найдены</p>
        ) : (
          visible.map((c) => {
            const selected = c.client_customer_id === selectedCustomerId;
            const debt = c.local_balance;
            return (
              <button
                key={c.client_customer_id}
                type="button"
                onClick={() => onSelect(c.client_customer_id)}
                className={`flex w-full items-center justify-between gap-2 rounded-xl border px-3 py-2 text-left text-sm ${
                  selected
                    ? 'border-blue-600 bg-blue-50 dark:bg-blue-900/20'
                    : 'border-gray-200 bg-white dark:border-gray-600 dark:bg-gray-800'
                }`}
              >
                <span className="min-w-0">
                  <span className="block truncate font-bold text-gray-900 dark:text-white">{c.name}</span>
                  {c.phone && <span className="block truncate text-[11px] text-gray-400">{c.phone}</span>}
                </span>
                {debt > 0 && (
                  <span className="shrink-0 text-[12px] font-bold tabular-nums text-red-600">
                    {formatCurrency(debt)}
                  </span>
                )}
              </button>
            );
          })
        )}
      </div>

      {/* Quick-create */}
      <div className="rounded-xl border border-dashed border-gray-300 p-3 dark:border-gray-600">
        <p className="mb-2 text-[12px] font-semibold text-gray-500">Новый клиент</p>
        <div className="space-y-2">
          <input
            type="text"
            value={qcName}
            onChange={(e) => onQcName(e.target.value)}
            placeholder="ФИО"
            aria-label="ФИО клиента"
            className="h-9 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-white"
          />
          <input
            type="tel"
            value={qcPhone}
            onChange={(e) => onQcPhone(e.target.value)}
            placeholder="Телефон"
            aria-label="Телефон клиента"
            className="h-9 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-white"
          />
          <input
            type="text"
            value={qcDescription}
            onChange={(e) => onQcDescription(e.target.value)}
            placeholder="Примечание (необязательно)"
            aria-label="Примечание"
            className="h-9 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-white"
          />
          <button
            type="button"
            onClick={onCreateCustomer}
            disabled={!canCreate}
            className="flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-gray-900 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50 dark:bg-gray-600"
          >
            <UserPlusIcon className="h-4 w-4" /> Создать клиента
          </button>
        </div>
      </div>

      {/* Initial payment */}
      <div>
        <label className="mb-1 block text-[12px] font-semibold text-gray-500">Оплачено сейчас</label>
        <input
          type="number"
          value={paidAmount}
          onChange={(e) => onPaidAmount(e.target.value)}
          placeholder="0"
          aria-label="Оплачено сейчас"
          className="mb-2 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-white"
        />
        <div className="mb-2 grid grid-cols-3 gap-2">
          {CREDIT_METHODS.map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => onPaymentMethod(id)}
              className={`flex items-center justify-center gap-1 rounded-xl border py-2 text-[12px] font-bold ${
                paymentMethod === id
                  ? 'border-blue-600 bg-blue-600 text-white'
                  : 'border-gray-200 bg-white text-gray-600 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300'
              }`}
            >
              <Icon className="h-4 w-4" /> {label}
            </button>
          ))}
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-gray-500">Останется долг</span>
          <span className={`font-bold tabular-nums ${credit.isValid ? 'text-amber-600' : 'text-red-600'}`}>
            {formatCurrency(credit.remaining)}
          </span>
        </div>
        {!credit.isValid && (
          <p className="mt-1 text-[11px] font-medium text-red-600">Первый платёж больше суммы продажи</p>
        )}
      </div>
    </div>
  );
}
