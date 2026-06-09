'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useCartStore } from '@/lib/store';
import { salesApi } from '@/lib/api';
import { formatCurrency, hotkeyManager, printReceipt, registerHotkeys } from '@/lib/utils';
import {
  PlusIcon,
  TrashIcon,
  BanknotesIcon,
  CreditCardIcon,
  DevicePhoneMobileIcon,
  XMarkIcon,
  ShoppingBagIcon,
  ArchiveBoxXMarkIcon,
  CheckCircleIcon,
} from '@heroicons/react/24/outline';

import ProductDrawer from '@/components/pos/ProductDrawer';
import toast from 'react-hot-toast';
import { useServerHealth } from '@/providers/ServerHealthProvider';
import {
  calculateDiscountFromEditedPrice,
  calculatePosPricing,
  formatEditableAmount,
} from '@/lib/posPricing';

const PAYMENT_METHODS = [
  { id: 'cash', label: 'Наличные', Icon: BanknotesIcon },
  { id: 'card', label: 'Карта', Icon: CreditCardIcon },
  { id: 'mobile', label: 'Мобильный', Icon: DevicePhoneMobileIcon },
] as const;

// One selection vocabulary across the register: the brand blue tint + a checkmark cue,
// the same pattern payment methods use. Banks are told apart by name, not by hue
// (Two-Accent Rule: Register Blue for action/selection, never a third decorative color).
const CARD_TYPES = [
  { id: 'alif', label: 'Alif' },
  { id: 'eskhata', label: 'Eskhata' },
  { id: 'dc', label: 'DC' },
] as const;

export default function POS() {
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'card' | 'mobile'>('cash');
  const [cardType, setCardType] = useState<'alif' | 'eskhata' | 'dc' | null>(null);
  const [loading, setLoading] = useState(false);
  const [totalEdit, setTotalEdit] = useState<string | null>(null);
  const [priceEdits, setPriceEdits] = useState<Record<number, string>>({});
  const [qtyEdits, setQtyEdits] = useState<Record<number, string>>({});
  const { isServerReachable } = useServerHealth();

  // Two-button confirm in a toast for destructive actions. Keyboard- and touch-reachable,
  // one consistent confirmation vocabulary across clear-cart and tab-close.
  const confirmAction = useCallback(
    (message: string, confirmLabel: string, onConfirm: () => void) => {
      toast(
        (t) => (
          <div className="flex flex-col gap-3">
            <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{message}</span>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => toast.dismiss(t.id)}
                className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={() => {
                  toast.dismiss(t.id);
                  onConfirm();
                }}
                className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-bold text-white transition-colors hover:bg-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-1"
              >
                {confirmLabel}
              </button>
            </div>
          </div>
        ),
        { duration: 6000 },
      );
    },
    [],
  );

  const {
    sessions,
    activeSessionId,
    createSession,
    switchSession,
    deleteSession,
    addItem,
    removeItem,
    updateQuantity,
    setDiscount,
    clearCart,
    getSubtotal,
    getTax,
    getTotal,
    getItemCount,
  } = useCartStore();
  const activeSession = sessions.find((session) => session.id === activeSessionId);
  const items = useMemo(() => activeSession?.items ?? [], [activeSession]);
  const [overallDiscounts, setOverallDiscounts] = useState<Record<string, number>>({});
  const overallDiscount = overallDiscounts[activeSessionId] ?? 0;
  const setActiveOverallDiscount = useCallback(
    (discount: number) => {
      setOverallDiscounts((prev) => ({ ...prev, [activeSessionId]: discount }));
    },
    [activeSessionId],
  );

  useEffect(() => {
    registerHotkeys();
    return () => {
      hotkeyManager.unregister('Enter');
      hotkeyManager.unregister('F2');
    };
  }, []);

  useEffect(() => {
    setShowPaymentModal(false);
    setCardType(null);
    setPaymentMethod('cash');
    setTotalEdit(null);
    setPriceEdits({});
    setQtyEdits({});
    setLoading(false);
  }, [activeSessionId]);

  const resetCheckout = useCallback(() => {
    clearCart();
    setShowPaymentModal(false);
    setCardType(null);
    setPaymentMethod('cash');
    setActiveOverallDiscount(0);
    setTotalEdit(null);
    setPriceEdits({});
    setQtyEdits({});
  }, [clearCart, setActiveOverallDiscount]);

  const completeSale = useCallback(async () => {
    if (items.length === 0) {
      toast.error('Корзина пуста');
      return;
    }

    if (paymentMethod === 'card' && !cardType) {
      toast.error('Выберите тип карты');
      return;
    }

    setLoading(true);

    const saleItems = items.map((item) => {
      const hasMarkup = item.discount < 0;
      return {
        product_id: item.product.id,
        quantity: item.quantity,
        unit_price: hasMarkup
          ? item.product.sell_price + Math.abs(item.discount)
          : item.product.sell_price,
        tax_percent: item.product.tax_percent,
        discount_amount: Math.max(0, item.discount || 0),
      };
    });
    const saleData: any = {
      items: saleItems,
      payment_method: paymentMethod,
      discount_amount: Math.max(0, items.reduce((sum, item) => sum + Math.max(0, item.discount || 0), 0) + overallDiscount),
    };

    if (paymentMethod === 'card' && cardType) {
      saleData.card_type = cardType;
    }

    if (!isServerReachable) {
      toast.error('Нет связи с сервером. Проверьте подключение к интернету.');
      setLoading(false);
      return;
    }

    try {
      const { data: sale } = await salesApi.create(saleData);
      toast.success('Продажа завершена');
      printReceipt(sale);
      resetCheckout();
    } catch (error: any) {
      toast.error(error.response?.data?.detail || 'Не удалось завершить продажу');
    } finally {
      setLoading(false);
    }
  }, [items, paymentMethod, cardType, isServerReachable, overallDiscount, resetCheckout]);

  useEffect(() => {
    hotkeyManager.register({
      key: 'Enter',
      handler: () => {
        if (showPaymentModal) {
          completeSale();
        } else if (items.length > 0 && !isDrawerOpen) {
          setShowPaymentModal(true);
        }
      },
      description: 'Завершить продажу',
    });

    hotkeyManager.register({
      key: 'F2',
      handler: () => setIsDrawerOpen(true),
      description: 'Открыть каталог товаров',
    });
  }, [showPaymentModal, items.length, isDrawerOpen, completeSale]);

  // Esc closes the payment modal. The register is keyboard- and scanner-driven;
  // every modal needs an emergency exit without reaching for the mouse.
  useEffect(() => {
    if (!showPaymentModal) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowPaymentModal(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [showPaymentModal]);

  const subtotal = getSubtotal();
  const tax = getTax();
  const total = getTotal();
  const itemCount = getItemCount();
  const itemDiscounts = items.reduce((sum, item) => sum + (item.discount || 0), 0);
  const pricing = calculatePosPricing({
    subtotal,
    tax,
    itemDiscounts,
    overallDiscount,
  });
  const finalTotal = pricing.finalTotal;
  const hasOverallDiscount = overallDiscount !== 0;
  const isOverallMarkup = overallDiscount < 0;
  const getSessionItemCount = (sessionItems: typeof items) =>
    sessionItems.reduce((sum, item) => sum + item.quantity, 0);

  return (
    <>
      <div className="h-full flex flex-col gap-3 sm:gap-4">
        <div className="flex items-center gap-2 overflow-x-auto rounded-2xl border border-gray-200 bg-white p-2 shadow-sm dark:border-gray-700 dark:bg-gray-800">
          <div
            role="tablist"
            aria-label="Активные продажи"
            className="flex min-w-0 flex-1 items-center gap-2"
          >
            {sessions.map((session) => {
              const isActive = session.id === activeSessionId;
              const sessionItemCount = getSessionItemCount(session.items);

              return (
                <div
                  key={session.id}
                  className={`flex h-10 shrink-0 items-center rounded-xl border transition-colors ${
                    isActive
                      ? 'border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-500 dark:bg-blue-900/30 dark:text-blue-200'
                      : 'border-gray-200 bg-gray-50 text-gray-600 hover:border-gray-300 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300'
                  }`}
                >
                  <button
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    aria-current={isActive ? 'page' : undefined}
                    onClick={() => switchSession(session.id)}
                    className="flex h-full min-w-0 items-center gap-2 rounded-xl px-3 text-xs font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 sm:text-sm"
                  >
                    <span className="max-w-24 truncate sm:max-w-36">{session.name}</span>
                    <span
                      className={`rounded-full px-1.5 py-0.5 text-[10px] ${
                        isActive
                          ? 'bg-blue-100 text-blue-700 dark:bg-blue-800 dark:text-blue-100'
                          : 'bg-white text-gray-500 dark:bg-gray-800 dark:text-gray-300'
                      }`}
                    >
                      {sessionItemCount}
                    </span>
                  </button>
                  {sessions.length > 1 && (
                    <button
                      type="button"
                      aria-label={`Закрыть ${session.name}`}
                      onClick={() => {
                        if (sessionItemCount > 0) {
                          confirmAction(
                            `Закрыть «${session.name}»? Товаров в корзине: ${sessionItemCount}.`,
                            'Закрыть',
                            () => deleteSession(session.id),
                          );
                        } else {
                          deleteSession(session.id);
                        }
                      }}
                      className={`mr-1 rounded-lg p-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 ${
                        isActive
                          ? 'text-blue-600 hover:bg-blue-100 hover:text-blue-700 dark:text-blue-300 dark:hover:bg-blue-800'
                          : 'text-gray-500 hover:bg-gray-200 hover:text-red-500 dark:text-gray-400 dark:hover:bg-gray-800'
                      }`}
                    >
                      <XMarkIcon className="h-4 w-4" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          <button
            type="button"
            aria-label="Новая продажа"
            title="Новая продажа"
            onClick={createSession}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white shadow-sm transition-colors hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
          >
            <PlusIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-xl dark:border-gray-700 dark:bg-gray-800">
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain p-2 pb-28 sm:space-y-3 sm:p-4 sm:pb-32">
            {items.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center">
                <ShoppingBagIcon className="mb-4 h-16 w-16 text-gray-300 dark:text-gray-600 sm:h-24 sm:w-24" />
                <p className="text-sm font-medium text-gray-600 dark:text-gray-300 sm:text-lg">Корзина пуста</p>
                <p className="text-xs text-gray-500 dark:text-gray-400 sm:text-sm">Нажмите кнопку ниже, чтобы добавить товар</p>
              </div>
            ) : (
              items.map((item) => {
                const sellPrice = Number(item.product.sell_price);
const discountAmount = item.discount || 0;
                const finalPrice = sellPrice - discountAmount;
                const hasPriceAdjustment = discountAmount !== 0;
                const isMarkup = discountAmount < 0;
                const absDiscountAmount = Math.abs(discountAmount);
                const priceChangePercent = sellPrice > 0
                  ? (absDiscountAmount / sellPrice) * 100
                  : 0;

                return (
                <div
                  key={item.product.id}
                  className={`flex flex-col gap-1 rounded-xl p-2 transition-all sm:gap-2 sm:p-4 ${
                    hasPriceAdjustment
                      ? isMarkup
                        ? 'bg-blue-50 ring-1 ring-blue-200 dark:bg-blue-900/10 dark:ring-blue-800'
                        : 'bg-green-50 ring-1 ring-green-200 dark:bg-green-900/10 dark:ring-green-800'
                      : 'bg-gray-50 hover:bg-gray-100 dark:bg-gray-750/50 dark:hover:bg-gray-700'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 sm:gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-bold text-gray-900 dark:text-white sm:text-lg">
                      {item.product.name}
                    </div>
                    <div className="text-[10px] text-gray-500 sm:text-sm">
                      {formatCurrency(sellPrice)} / {item.product.uom}
                    </div>
                  </div>

                    <div className="flex items-center gap-1 sm:gap-3">
                      <div className="flex items-center gap-1">
                        <input
                          type="text"
                          inputMode="decimal"
                          aria-label={`Количество: ${item.product.name}`}
                          value={qtyEdits[item.product.id] ?? item.quantity.toString()}
                          onChange={(e) => {
                            // Hold the raw text while editing; never delete the line mid-type.
                            setQtyEdits((prev) => ({ ...prev, [item.product.id]: e.target.value }));
                          }}
                          onBlur={() => {
                            const raw = qtyEdits[item.product.id];
                            setQtyEdits((prev) => {
                              const next = { ...prev };
                              delete next[item.product.id];
                              return next;
                            });
                            if (raw === undefined) return;
                            const parsed = parseFloat(raw.replace(',', '.'));
                            // Invalid or empty: keep the line, revert to the last valid quantity.
                            if (isNaN(parsed) || parsed <= 0) return;
                            if (parsed > item.product.stock_quantity) {
                              toast.error(`Доступно: ${item.product.stock_quantity} ${item.product.uom}`);
                              return;
                            }
                            updateQuantity(item.product.id, parsed);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                          }}
                          className="w-16 rounded-lg border border-gray-200 bg-white px-2 py-1 text-center text-xs font-bold focus:outline-none focus:ring-2 focus:ring-blue-400 dark:border-gray-600 dark:bg-gray-800 sm:w-20 sm:text-sm"
                        />
                        <span className="text-[10px] text-gray-500 sm:text-xs">{item.product.uom}</span>
                      </div>

                    <div className="min-w-[70px] text-right sm:min-w-[110px]">
                      <input
                        type="text"
                        inputMode="decimal"
                        value={priceEdits[item.product.id] ?? formatEditableAmount(hasPriceAdjustment ? finalPrice : sellPrice)}
                        onChange={(e) => {
                          setPriceEdits((prev) => ({ ...prev, [item.product.id]: e.target.value }));
                        }}
                        onBlur={() => {
                          const raw = priceEdits[item.product.id];
                          if (raw !== undefined) {
                            setDiscount(item.product.id, calculateDiscountFromEditedPrice(raw, sellPrice));
                          }
                          setPriceEdits((prev) => {
                            const next = { ...prev };
                            delete next[item.product.id];
                            return next;
                          });
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                        }}
                        className={`w-full rounded-lg border bg-white px-2 py-1 text-right text-xs font-bold focus:outline-none focus:ring-2 sm:text-sm ${
                          isMarkup
                            ? 'border-blue-300 text-blue-700 focus:ring-blue-400 dark:border-blue-700 dark:bg-gray-800 dark:text-blue-300'
                            : hasPriceAdjustment
                              ? 'border-green-300 text-green-700 focus:ring-green-400 dark:border-green-700 dark:bg-gray-800 dark:text-green-300'
                              : 'border-gray-200 text-blue-600 focus:ring-blue-400 dark:border-gray-600 dark:bg-gray-800'
                        }`}
                      />
                    </div>

                    <button
                      type="button"
                      aria-label={`Удалить ${item.product.name}`}
                      onClick={() => removeItem(item.product.id)}
                      className="rounded-lg p-2 text-gray-500 transition-colors hover:bg-gray-100 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 dark:hover:bg-gray-700"
                    >
                      <TrashIcon className="h-5 w-5 sm:h-6 sm:w-6" />
                    </button>
                  </div>
                  </div>

                  {hasPriceAdjustment && (
                    <div className="flex items-center justify-end gap-2">
                      <span className={`rounded-full px-2 py-0.5 text-[9px] font-medium ${
                        isMarkup
                          ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
                          : 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
                      }`}>
                        {isMarkup
                          ? `+${formatCurrency(absDiscountAmount)} (+${priceChangePercent.toFixed(0)}%)`
                          : `-${formatCurrency(absDiscountAmount)} (-${priceChangePercent.toFixed(0)}%)`
                        }
                      </span>
                      <button
                        type="button"
                        aria-label="Сбросить корректировку цены"
                        onClick={() => setDiscount(item.product.id, 0)}
                        className="rounded p-0.5 text-gray-500 transition-colors hover:text-red-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
                      >
                        <XMarkIcon className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                </div>
                );
              })
            )}
          </div>

          <div className="absolute bottom-0 left-0 right-0 border-t border-gray-100 bg-white p-2 dark:border-gray-700 dark:bg-gray-800 sm:p-4">
            <div className="flex items-center justify-between gap-2 sm:gap-4">
              <button
                onClick={() => setIsDrawerOpen(true)}
                className="flex min-h-[44px] flex-shrink-0 items-center justify-center gap-1 rounded-xl bg-blue-600 px-3 py-2.5 text-xs font-bold text-white shadow-lg transition-all hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 sm:gap-2 sm:px-6 sm:py-3 sm:text-base"
              >
                <PlusIcon className="h-4 w-4 sm:h-5 sm:w-5" />
                <span className="hidden sm:inline">Товар</span>
                <kbd className="ml-1 hidden rounded bg-white/20 px-1.5 py-0.5 text-[10px] font-semibold lg:inline">F2</kbd>
              </button>

              <div className="flex-1 text-right">
                <div className="flex items-center justify-end gap-2">
                  <span className="text-[10px] text-gray-600 dark:text-gray-300 sm:text-xs">Итого</span>
                  <span className="text-right text-2xl font-black text-blue-600">
                    {formatCurrency(finalTotal)}
                  </span>
                </div>
              </div>

              <button
                onClick={() => items.length > 0 && setShowPaymentModal(true)}
                disabled={items.length === 0}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-green-600 px-4 py-2.5 text-sm font-bold text-white shadow-lg transition-all hover:bg-green-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-gray-400 sm:px-8 sm:py-3 sm:text-lg"
              >
                Оплатить
                <kbd className="hidden rounded bg-white/20 px-1.5 py-0.5 text-[10px] font-semibold lg:inline">Enter</kbd>
              </button>
            </div>

            {items.length > 0 && (
              <button
                onClick={() =>
                  confirmAction('Очистить корзину? Все товары будут удалены.', 'Очистить', () =>
                    clearCart(),
                  )
                }
                className="mt-2 flex w-full items-center justify-center gap-1 rounded-lg py-1.5 text-xs font-medium text-red-500 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 sm:py-2 sm:text-sm"
              >
                <ArchiveBoxXMarkIcon className="h-3 w-3 sm:h-4 sm:w-4" />
                Очистить корзину
              </button>
            )}
          </div>
        </div>

        <ProductDrawer
          isOpen={isDrawerOpen}
          onClose={() => setIsDrawerOpen(false)}
          onAddToCart={(product) => {
            addItem(product);
            toast.success(`${product.name} добавлен`);
          }}
        />

        {showPaymentModal && (
          <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
            <div
              className="absolute inset-0 bg-gray-900/60 backdrop-blur-sm"
              onClick={() => setShowPaymentModal(false)}
            />
            <div className="relative max-h-[90vh] w-full overflow-y-auto rounded-t-3xl bg-white p-4 shadow-2xl dark:bg-gray-800 sm:max-w-lg sm:rounded-3xl sm:p-6">
              <div className="mb-4 flex items-center justify-between sm:mb-6">
                <h2 className="text-lg font-bold text-gray-900 dark:text-white sm:text-2xl">Оплата</h2>
                <button
                  type="button"
                  aria-label="Закрыть"
                  onClick={() => setShowPaymentModal(false)}
                  className="rounded-lg p-1 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-gray-300 dark:hover:bg-gray-700"
                >
                  <XMarkIcon className="h-5 w-5 sm:h-6 sm:w-6" />
                </button>
              </div>

              <div className="mb-4 rounded-2xl bg-gray-50 p-4 dark:bg-gray-900 sm:mb-6">
                <div className="flex items-center justify-between text-sm text-gray-500">
                  <span>Подытог</span>
                  <span>{formatCurrency(subtotal)}</span>
                </div>
                {itemDiscounts > 0 && (
                  <div className="mt-1 flex items-center justify-between text-sm text-green-600">
                    <span>Скидки на товары</span>
                    <span>-{formatCurrency(itemDiscounts)}</span>
                  </div>
                )}
                {itemDiscounts < 0 && (
                  <div className="mt-1 flex items-center justify-between text-sm text-blue-600">
                    <span>Наценки на товары</span>
                    <span>+{formatCurrency(Math.abs(itemDiscounts))}</span>
                  </div>
                )}
                {overallDiscount > 0 && (
                  <div className="mt-1 flex items-center justify-between text-sm text-green-600">
                    <span>Общая скидка</span>
                    <span>-{formatCurrency(overallDiscount)}</span>
                  </div>
                )}
                {overallDiscount < 0 && (
                  <div className="mt-1 flex items-center justify-between text-sm text-blue-600">
                    <span>Общая наценка</span>
                    <span>+{formatCurrency(Math.abs(overallDiscount))}</span>
                  </div>
                )}
                <div className="mt-2 flex items-center justify-between text-sm text-gray-500">
                  <span>Налог</span>
                  <span>{formatCurrency(tax)}</span>
                </div>
                <div className="mt-3 border-t border-gray-200 pt-3 dark:border-gray-700">
                  <div className="text-xs text-gray-500">К оплате</div>
                  <div className="text-3xl font-black text-blue-600 sm:text-5xl">
                    {formatCurrency(finalTotal)}
                  </div>
                </div>
              </div>

              <div className="mb-4 grid grid-cols-3 gap-2 sm:mb-6 sm:gap-4">
                {PAYMENT_METHODS.map(({ id, label, Icon }) => {
                  const selected = paymentMethod === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => {
                        setPaymentMethod(id);
                        if (id !== 'card') setCardType(null);
                      }}
                      className={`relative flex min-h-[44px] flex-col items-center justify-center rounded-xl border-2 p-2 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 sm:p-4 ${
                        selected
                          ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-200'
                          : 'border-gray-200 text-gray-600 hover:border-gray-300 dark:border-gray-600 dark:text-gray-300'
                      }`}
                    >
                      {selected && (
                        <CheckCircleIcon className="absolute right-1 top-1 h-4 w-4 text-blue-600 dark:text-blue-300" />
                      )}
                      <Icon className="mb-1 h-6 w-6 sm:mb-2 sm:h-8 sm:w-8" />
                      <span className="text-[10px] font-semibold sm:text-sm">{label}</span>
                    </button>
                  );
                })}
              </div>

              {paymentMethod === 'card' && (
                <div className="mb-4 sm:mb-8">
                  <div className="mb-2 text-xs font-medium text-gray-600 sm:mb-3 sm:text-sm">
                    Тип карты
                  </div>
                  <div className="grid grid-cols-3 gap-2 sm:gap-3">
                    {CARD_TYPES.map(({ id, label }) => {
                      const selected = cardType === id;
                      return (
                        <button
                          key={id}
                          type="button"
                          aria-pressed={selected}
                          onClick={() => setCardType(id)}
                          className={`relative min-h-[44px] rounded-xl border-2 p-2 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 sm:p-4 ${
                            selected
                              ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                              : 'border-gray-200 hover:border-gray-300 dark:border-gray-600'
                          }`}
                        >
                          {selected && (
                            <CheckCircleIcon className="absolute right-1 top-1 h-4 w-4 text-blue-600 dark:text-blue-300" />
                          )}
                          <div
                            className={`text-lg font-bold sm:text-2xl ${
                              selected ? 'text-blue-700 dark:text-blue-200' : 'text-gray-600 dark:text-gray-300'
                            }`}
                          >
                            {label}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <button
                onClick={completeSale}
                disabled={loading}
                className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-green-600 py-3 text-base font-bold text-white transition-all hover:bg-green-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-gray-400 sm:py-4 sm:text-xl"
              >
                {loading ? (
                  'Обработка...'
                ) : (
                  <>
                    Завершить продажу
                    <kbd className="hidden rounded bg-white/20 px-1.5 py-0.5 text-xs font-semibold sm:inline">Enter</kbd>
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
