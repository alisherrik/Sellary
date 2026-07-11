import { useState } from 'react';
import toast from 'react-hot-toast';
import type { CustomerWithBalance } from '../../lib/db';
import { insertCustomerPayment } from '../../lib/db';
import { formatCurrency } from '../../lib/format';

type Method = 'cash' | 'card' | 'mobile';

export function DebtPaymentModal({
  customer,
  onClose,
  onSaved,
}: {
  customer: CustomerWithBalance;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<Method>('cash');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);

  const debt = Number(customer.local_balance || 0);

  const save = async () => {
    const value = Number(amount);
    if (!amount.trim() || !Number.isFinite(value) || value <= 0) {
      toast.error('Введите сумму оплаты');
      return;
    }
    if (value > debt) {
      toast.error('Сумма больше текущего долга');
      return;
    }
    setSaving(true);
    try {
      await insertCustomerPayment({
        customer_client_id: customer.client_customer_id,
        amount: value,
        payment_method: method,
        description: description.trim() || null,
      });
      toast.success('Оплата долга сохранена');
      onSaved();
    } catch (err) {
      console.error('insertCustomerPayment failed', err);
      toast.error('Не удалось сохранить оплату');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 backdrop-blur-sm sm:items-center sm:p-4">
      <div className="w-full rounded-t-2xl bg-white p-4 shadow-2xl dark:bg-gray-800 sm:max-w-md sm:rounded-2xl">
        <h2 className="text-lg font-black text-gray-900 dark:text-white">Оплата долга</h2>
        <p className="mt-1 text-sm text-gray-500">{customer.name}</p>
        <p className="mt-1 text-sm text-gray-500">
          Текущий долг:{' '}
          <span className="font-bold tabular-nums text-red-600">{formatCurrency(debt)}</span>
        </p>

        <label className="mt-4 block text-sm font-medium text-gray-700 dark:text-gray-300">
          Сумма оплаты
          <input
            type="text"
            inputMode="decimal"
            aria-label="Сумма оплаты"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="mt-1 h-11 w-full rounded-xl border border-gray-300 bg-white px-3 text-right text-lg font-bold tabular-nums outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:border-gray-600 dark:bg-gray-900"
          />
        </label>

        <label className="mt-3 block text-sm font-medium text-gray-700 dark:text-gray-300">
          Способ оплаты
          <select
            aria-label="Способ оплаты"
            value={method}
            onChange={(e) => setMethod(e.target.value as Method)}
            className="mt-1 h-11 w-full rounded-xl border border-gray-300 bg-white px-3 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:border-gray-600 dark:bg-gray-900"
          >
            <option value="cash">Наличные</option>
            <option value="card">Карта</option>
            <option value="mobile">Мобильный</option>
          </select>
        </label>

        <label className="mt-3 block text-sm font-medium text-gray-700 dark:text-gray-300">
          Примечание
          <input
            type="text"
            aria-label="Примечание"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="mt-1 h-11 w-full rounded-xl border border-gray-300 bg-white px-3 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:border-gray-600 dark:bg-gray-900"
          />
        </label>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-xl px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            Отмена
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="rounded-xl bg-green-600 px-4 py-2 text-sm font-bold text-white hover:bg-green-700 disabled:bg-gray-400"
          >
            Сохранить оплату
          </button>
        </div>
      </div>
    </div>
  );
}
