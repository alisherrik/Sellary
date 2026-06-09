'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useCartStore } from '@/lib/store';
import { salesApi } from '@/lib/api';
import { formatCurrency, hotkeyManager, registerHotkeys } from '@/lib/utils';
import {
  PlusIcon,
  TrashIcon,
  BanknotesIcon,
  CreditCardIcon,
  DevicePhoneMobileIcon,
  XMarkIcon,
  ShoppingBagIcon,
  ArchiveBoxXMarkIcon,
} from '@heroicons/react/24/outline';

import ProductDrawer from '@/components/pos/ProductDrawer';
import toast from 'react-hot-toast';
import { useServerHealth } from '@/providers/ServerHealthProvider';
import {
  calculateDiscountFromEditedPrice,
  calculatePosPricing,
  formatEditableAmount,
} from '@/lib/posPricing';

export default function POS() {
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'card' | 'mobile'>('cash');
  const [cardType, setCardType] = useState<'alif' | 'eskhata' | 'dc' | null>(null);
  const [loading, setLoading] = useState(false);
  const [totalEdit, setTotalEdit] = useState<string | null>(null);
  const [priceEdits, setPriceEdits] = useState<Record<number, string>>({});
  const { isServerReachable } = useServerHealth();

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
      await salesApi.create(saleData);
      toast.success('Продажа завершена');
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
      description: 'Complete sale',
    });

    hotkeyManager.register({
      key: 'F2',
      handler: () => setIsDrawerOpen(true),
      description: 'Open Product Drawer',
    });
  }, [showPaymentModal, items.length, isDrawerOpen, completeSale]);

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
                    className="flex h-full min-w-0 items-center gap-2 px-3 text-xs font-bold sm:text-sm"
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
                      onClick={() => deleteSession(session.id)}
                      className={`mr-1 rounded-lg p-1 transition-colors ${
                        isActive
                          ? 'text-blue-500 hover:bg-blue-100 hover:text-blue-700 dark:hover:bg-blue-800'
                          : 'text-gray-400 hover:bg-gray-200 hover:text-red-500 dark:hover:bg-gray-800'
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
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white shadow-sm transition-colors hover:bg-blue-700"
          >
            <PlusIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="relative flex-1 overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-xl dark:border-gray-700 dark:bg-gray-800">
          <div className="flex-1 space-y-2 overflow-y-auto p-2 pb-28 sm:space-y-3 sm:p-4 sm:pb-32">
            {items.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center text-gray-300 dark:text-gray-600">
                <ShoppingBagIcon className="mb-4 h-16 w-16 opacity-50 sm:h-24 sm:w-24" />
                <p className="text-sm font-medium sm:text-lg">Корзина пуста</p>
                <p className="text-xs sm:text-sm">Нажмите кнопку ниже, чтобы добавить товар</p>
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
                          value={item.quantity.toString()}
                          onChange={(e) => {
                            const parsed = parseFloat(e.target.value);
                            const existing = items.find((entry) => entry.product.id === item.product.id);
                            if (!existing) return;
                            if (isNaN(parsed) || parsed <= 0) {
                              removeItem(item.product.id);
                              return;
                            }
                            if (parsed > existing.product.stock_quantity) {
                              toast.error(`Доступно: ${existing.product.stock_quantity} ${existing.product.uom}`);
                              return;
                            }
                            updateQuantity(item.product.id, parsed);
                          }}
                          className="w-16 rounded-lg border border-gray-200 bg-white px-2 py-1 text-center text-xs font-bold dark:border-gray-600 dark:bg-gray-800 sm:w-20 sm:text-sm"
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
                      onClick={() => removeItem(item.product.id)}
                      className="p-1 text-gray-400 hover:text-red-500 sm:p-2"
                    >
                      <TrashIcon className="h-4 w-4 sm:h-6 sm:w-6" />
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
                        onClick={() => setDiscount(item.product.id, 0)}
                        className="text-[9px] text-gray-400 hover:text-red-500"
                      >
                        <XMarkIcon className="h-3 w-3" />
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
                className="flex flex-shrink-0 items-center justify-center gap-1 rounded-xl bg-blue-600 px-3 py-2.5 text-xs font-bold text-white shadow-lg transition-all hover:bg-blue-700 sm:gap-2 sm:px-6 sm:py-3 sm:text-base"
              >
                <PlusIcon className="h-4 w-4 sm:h-5 sm:w-5" />
                <span className="hidden sm:inline">Товар</span>
              </button>

              <div className="flex-1 text-right">
                <div className="flex items-center justify-end gap-2">
                  <span className="text-[10px] text-gray-400 sm:text-xs">Итого</span>
                  <span className="text-right text-2xl font-black text-blue-600">
                    {formatCurrency(finalTotal)}
                  </span>
                </div>
              </div>

              <button
                onClick={() => items.length > 0 && setShowPaymentModal(true)}
                disabled={items.length === 0}
                className="rounded-xl bg-green-600 px-4 py-2.5 text-sm font-bold text-white shadow-lg transition-all hover:bg-green-700 disabled:cursor-not-allowed disabled:bg-gray-300 sm:px-8 sm:py-3 sm:text-lg"
              >
                Оплатить
              </button>
            </div>

            {items.length > 0 && (
              <button
                onClick={() => clearCart()}
                className="mt-2 flex w-full items-center justify-center gap-1 rounded-lg py-1.5 text-xs font-medium text-red-500 hover:bg-red-50 sm:py-2 sm:text-sm"
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
                <button onClick={() => setShowPaymentModal(false)}>
                  <XMarkIcon className="h-5 w-5 text-gray-400 sm:h-6 sm:w-6" />
                </button>
              </div>

              <div className="mb-4 rounded-2xl bg-gray-50 p-4 dark:bg-gray-900 sm:mb-6">
                <div className="flex items-center justify-between text-sm text-gray-500">
                  <span>Subtotal</span>
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
                <button
                  onClick={() => {
                    setPaymentMethod('cash');
                    setCardType(null);
                  }}
                  className={`flex flex-col items-center justify-center rounded-xl border-2 p-2 transition-all sm:p-4 ${
                    paymentMethod === 'cash'
                      ? 'border-blue-500 bg-blue-50 text-blue-700'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <BanknotesIcon className="mb-1 h-6 w-6 sm:mb-2 sm:h-8 sm:w-8" />
                  <span className="text-[10px] font-semibold sm:text-sm">Наличные</span>
                </button>
                <button
                  onClick={() => setPaymentMethod('card')}
                  className={`flex flex-col items-center justify-center rounded-xl border-2 p-2 transition-all sm:p-4 ${
                    paymentMethod === 'card'
                      ? 'border-blue-500 bg-blue-50 text-blue-700'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <CreditCardIcon className="mb-1 h-6 w-6 sm:mb-2 sm:h-8 sm:w-8" />
                  <span className="text-[10px] font-semibold sm:text-sm">Карта</span>
                </button>
                <button
                  onClick={() => {
                    setPaymentMethod('mobile');
                    setCardType(null);
                  }}
                  className={`flex flex-col items-center justify-center rounded-xl border-2 p-2 transition-all sm:p-4 ${
                    paymentMethod === 'mobile'
                      ? 'border-blue-500 bg-blue-50 text-blue-700'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <DevicePhoneMobileIcon className="mb-1 h-6 w-6 sm:mb-2 sm:h-8 sm:w-8" />
                  <span className="text-[10px] font-semibold sm:text-sm">Мобильный</span>
                </button>
              </div>

              {paymentMethod === 'card' && (
                <div className="mb-4 sm:mb-8">
                  <div className="mb-2 text-xs font-medium text-gray-600 sm:mb-3 sm:text-sm">
                    Тип карты
                  </div>
                  <div className="grid grid-cols-3 gap-2 sm:gap-3">
                    <button
                      onClick={() => setCardType('alif')}
                      className={`rounded-xl border-2 p-2 transition-all sm:p-4 ${
                        cardType === 'alif'
                          ? 'border-green-500 bg-green-50'
                          : 'border-gray-200 hover:border-green-300'
                      }`}
                    >
                      <div className={`text-lg font-bold sm:text-2xl ${cardType === 'alif' ? 'text-green-600' : 'text-green-500'}`}>
                        Alif
                      </div>
                    </button>
                    <button
                      onClick={() => setCardType('eskhata')}
                      className={`rounded-xl border-2 p-2 transition-all sm:p-4 ${
                        cardType === 'eskhata'
                          ? 'border-blue-500 bg-blue-50'
                          : 'border-gray-200 hover:border-blue-300'
                      }`}
                    >
                      <div className={`text-lg font-bold sm:text-2xl ${cardType === 'eskhata' ? 'text-blue-600' : 'text-blue-500'}`}>
                        Eskhata
                      </div>
                    </button>
                    <button
                      onClick={() => setCardType('dc')}
                      className={`rounded-xl border-2 p-2 transition-all sm:p-4 ${
                        cardType === 'dc'
                          ? 'border-purple-500 bg-purple-50'
                          : 'border-gray-200 hover:border-purple-300'
                      }`}
                    >
                      <div className={`text-lg font-bold sm:text-2xl ${cardType === 'dc' ? 'text-purple-600' : 'text-purple-500'}`}>
                        DC
                      </div>
                    </button>
                  </div>
                </div>
              )}

              <button
                onClick={completeSale}
                disabled={loading}
                className="w-full rounded-xl bg-green-600 py-3 text-base font-bold text-white transition-all hover:bg-green-700 sm:py-4 sm:text-xl"
              >
                {loading ? 'Обработка...' : 'Завершить продажу'}
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
