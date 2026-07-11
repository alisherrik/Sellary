import {
  BanknotesIcon, CreditCardIcon, DevicePhoneMobileIcon, DocumentTextIcon,
} from '@heroicons/react/24/outline';
import { formatCurrency } from '../../lib/format';
import { calculateCashPayment, calculateCreditInitialPayment } from '../../lib/posPricing';
import type { CashierCardType, CashierPaymentMethod } from '../../lib/pos-payload';
import { CreditPanel, type CreditPanelProps } from './CreditPanel';

const CARD_TYPES: { id: CashierCardType; label: string }[] = [
  { id: 'alif', label: 'Alif' },
  { id: 'eskhata', label: 'Eskhata' },
  { id: 'dc', label: 'DC' },
];

const METHODS: { id: CashierPaymentMethod; label: string; Icon: typeof BanknotesIcon }[] = [
  { id: 'cash', label: 'Наличные', Icon: BanknotesIcon },
  { id: 'card', label: 'Карта', Icon: CreditCardIcon },
  { id: 'mobile', label: 'Мобильный', Icon: DevicePhoneMobileIcon },
];

// The credit bundle is CreditPanelProps minus `total` (PaymentModal owns the total).
export type CreditModalState = Omit<CreditPanelProps, 'total'>;

interface PaymentModalProps {
  open: boolean;
  total: number;
  method: CashierPaymentMethod;
  onMethod: (m: CashierPaymentMethod) => void;
  cardType: CashierCardType | null;
  onCardType: (c: CashierCardType) => void;
  cashReceived: string;
  onCashReceived: (v: string) => void;
  loading: boolean;
  onConfirm: () => void;
  onClose: () => void;
  credit: CreditModalState;
}

export function PaymentModal(props: PaymentModalProps) {
  const {
    open, total, method, onMethod, cardType, onCardType,
    cashReceived, onCashReceived, loading, onConfirm, onClose, credit,
  } = props;
  if (!open) return null;

  const cash = calculateCashPayment(cashReceived, total);
  const creditCalc = calculateCreditInitialPayment(credit.paidAmount, total);
  const canConfirm =
    !loading &&
    (method !== 'cash' || cash.isSufficient) &&
    (method !== 'card' || cardType !== null) &&
    (method !== 'credit' || (credit.selectedCustomerId !== null && creditCalc.isValid));

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl dark:bg-gray-800">
        <div className="mb-4 flex items-end justify-between">
          <span className="font-bold text-gray-900 dark:text-white">К оплате</span>
          <span className="text-[28px] font-extrabold tabular-nums text-gray-900 dark:text-white">
            {formatCurrency(total)}
          </span>
        </div>

        <div className="mb-3 grid grid-cols-2 gap-2">
          {METHODS.map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => onMethod(id)}
              className={`flex items-center justify-center gap-2 rounded-2xl border py-3 text-sm font-bold ${
                method === id
                  ? 'border-blue-600 bg-blue-600 text-white'
                  : 'border-gray-200 bg-white text-gray-600 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300'
              }`}
            >
              <Icon className="h-5 w-5" /> {label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => onMethod('credit')}
            className={`flex items-center justify-center gap-2 rounded-2xl border py-3 text-sm font-bold ${
              method === 'credit'
                ? 'border-amber-600 bg-amber-600 text-white'
                : 'border-amber-200 bg-amber-50 text-amber-600 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-400'
            }`}
          >
            <DocumentTextIcon className="h-5 w-5" /> В долг
          </button>
        </div>

        {method === 'card' && (
          <div className="mb-3 grid grid-cols-3 gap-2">
            {CARD_TYPES.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => onCardType(c.id)}
                className={`rounded-xl border py-2 text-sm font-semibold ${
                  cardType === c.id
                    ? 'border-blue-600 bg-blue-600 text-white'
                    : 'border-gray-200 bg-white text-gray-600 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300'
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>
        )}

        {method === 'cash' && (
          <div className="mb-3">
            <input
              type="number"
              value={cashReceived}
              onChange={(e) => onCashReceived(e.target.value)}
              placeholder="Получено"
              className="mb-2 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-white"
            />
            {cash.received !== null && (
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Сдача</span>
                <span className="font-bold text-green-600 tabular-nums">{formatCurrency(cash.change)}</span>
              </div>
            )}
          </div>
        )}

        {method === 'credit' && <CreditPanel total={total} {...credit} />}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="h-12 flex-1 rounded-2xl border border-gray-200 font-bold text-gray-600 dark:border-gray-600 dark:text-gray-300"
          >
            Отмена
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!canConfirm}
            className="h-12 flex-[2] rounded-2xl text-[16px] font-extrabold text-white shadow-lg disabled:cursor-not-allowed disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg,#22c55e,#16a34a)' }}
          >
            {loading ? 'Сохранение…' : 'Завершить продажу'}
          </button>
        </div>
      </div>
    </div>
  );
}
