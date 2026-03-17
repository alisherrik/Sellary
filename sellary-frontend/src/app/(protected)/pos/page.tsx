'use client';

import { useState, useEffect, useCallback } from 'react';
import { useCartStore } from '@/lib/store';
import { salesApi } from '@/lib/api';
import { formatCurrency, hotkeyManager, registerHotkeys } from '@/lib/utils';
import {
  PlusIcon,
  MinusIcon,
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
import { addToSyncQueue } from '@/lib/syncQueue';
import { useServerHealth } from '@/providers/ServerHealthProvider';
import { isOfflineModeEnabled } from '@/lib/features';

export default function POS() {
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'card' | 'mobile'>('cash');
  const [cardType, setCardType] = useState<'alif' | 'eskhata' | 'dc' | null>(null);
  const [loading, setLoading] = useState(false);
  const { isServerReachable } = useServerHealth();

  const {
    items,
    addItem,
    removeItem,
    updateQuantity,
    clearCart,
    getSubtotal,
    getTax,
    getTotal,
    getItemCount,
  } = useCartStore();

  useEffect(() => {
    registerHotkeys();
    return () => {
      hotkeyManager.unregister('Enter');
      hotkeyManager.unregister('F2');
    };
  }, []);

  const resetCheckout = useCallback(() => {
    clearCart();
    setShowPaymentModal(false);
    setCardType(null);
    setPaymentMethod('cash');
  }, [clearCart]);

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

    const saleData: any = {
      items: items.map((item) => ({
        product_id: item.product.id,
        quantity: item.quantity,
        unit_price: item.product.sell_price,
        tax_percent: item.product.tax_percent,
        discount_amount: item.discount,
      })),
      payment_method: paymentMethod,
      discount_amount: 0,
    };

    if (paymentMethod === 'card' && cardType) {
      saleData.card_type = cardType;
    }

    if (!isServerReachable) {
      if (!isOfflineModeEnabled) {
        toast.error('Нет связи с сервером. В MVP офлайн-продажи отключены.');
        setLoading(false);
        return;
      }

      await addToSyncQueue({
        url: '/api/sales',
        method: 'POST',
        body: saleData,
        type: 'sale',
      });

      toast.success('Чек сохранен в очереди');
      resetCheckout();
      setLoading(false);
      return;
    }

    try {
      await salesApi.create(saleData);
      toast.success('Продажа завершена');
      resetCheckout();
    } catch (error: any) {
      const isNetworkError =
        error.message === 'Network Error' ||
        error.code === 'ERR_NETWORK' ||
        error.code === 'ERR_INTERNET_DISCONNECTED';
      const shouldQueue = isNetworkError || error.response?.status >= 500;

      if (shouldQueue && isOfflineModeEnabled) {
        await addToSyncQueue({
          url: '/api/sales',
          method: 'POST',
          body: saleData,
          type: 'sale',
        });

        toast.success('Чек сохранен в очереди');
        resetCheckout();
      } else {
        toast.error(error.response?.data?.detail || 'Не удалось завершить продажу');
      }
    } finally {
      setLoading(false);
    }
  }, [items, paymentMethod, cardType, isServerReachable, resetCheckout]);

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

  const handleQuantityChange = (itemId: number, change: number) => {
    const item = items.find((entry) => entry.product.id === itemId);
    if (!item) {
      return;
    }

    const nextQuantity = item.quantity + change;
    if (nextQuantity <= 0) {
      removeItem(itemId);
      return;
    }

    if (nextQuantity > item.product.stock_quantity) {
      toast.error(`Доступно: ${item.product.stock_quantity}`);
      return;
    }

    updateQuantity(itemId, nextQuantity);
  };

  const subtotal = getSubtotal();
  const tax = getTax();
  const total = getTotal();
  const itemCount = getItemCount();

  return (
    <>
      <div className="h-[calc(100vh-80px)] sm:h-[calc(100vh-100px)] flex flex-col gap-3 sm:gap-4">
        <div className="rounded-2xl border border-gray-200 bg-white p-3 shadow-sm dark:border-gray-700 dark:bg-gray-800">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h1 className="text-lg font-bold text-gray-900 dark:text-white sm:text-2xl">Касса</h1>
              <p className="text-xs text-gray-500 dark:text-gray-400 sm:text-sm">
                Одна активная корзина, быстрый расчет и простой MVP-сценарий
              </p>
            </div>
            <div className="rounded-xl bg-blue-50 px-3 py-2 text-right dark:bg-blue-900/20">
              <div className="text-[11px] uppercase tracking-wide text-blue-600 dark:text-blue-300">
                Корзина
              </div>
              <div className="text-base font-bold text-blue-700 dark:text-blue-200 sm:text-lg">
                {itemCount} шт
              </div>
            </div>
          </div>
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
              items.map((item) => (
                <div
                  key={item.product.id}
                  className="flex items-center justify-between gap-2 rounded-xl bg-gray-50 p-2 transition-colors hover:bg-gray-100 dark:bg-gray-750/50 dark:hover:bg-gray-700 sm:gap-4 sm:p-4"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-bold text-gray-900 dark:text-white sm:text-lg">
                      {item.product.name}
                    </div>
                    <div className="text-[10px] text-gray-500 sm:text-sm">
                      {formatCurrency(item.product.sell_price)}
                    </div>
                  </div>

                  <div className="flex items-center gap-1 sm:gap-3">
                    <div className="flex items-center rounded-lg border border-gray-200 bg-white shadow-sm dark:border-gray-600 dark:bg-gray-800">
                      <button
                        onClick={() => handleQuantityChange(item.product.id, -1)}
                        className="p-1.5 hover:text-blue-600 sm:p-3"
                      >
                        <MinusIcon className="h-3 w-3 sm:h-5 sm:w-5" />
                      </button>
                      <span className="w-6 text-center text-xs font-bold sm:w-10 sm:text-base">
                        {item.quantity}
                      </span>
                      <button
                        onClick={() => handleQuantityChange(item.product.id, 1)}
                        className="p-1.5 hover:text-blue-600 sm:p-3"
                      >
                        <PlusIcon className="h-3 w-3 sm:h-5 sm:w-5" />
                      </button>
                    </div>

                    <div className="min-w-[56px] text-right sm:min-w-[90px]">
                      <div className="text-xs font-bold text-blue-600 sm:text-lg">
                        {formatCurrency(Number(item.product.sell_price) * item.quantity)}
                      </div>
                    </div>

                    <button
                      onClick={() => removeItem(item.product.id)}
                      className="p-1 text-gray-400 hover:text-red-500 sm:p-2"
                    >
                      <TrashIcon className="h-4 w-4 sm:h-6 sm:w-6" />
                    </button>
                  </div>
                </div>
              ))
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
                <div className="text-[10px] text-gray-500 sm:text-xs">Итого</div>
                <div className="text-lg font-black text-blue-600 sm:text-2xl">{formatCurrency(total)}</div>
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
                <div className="mt-2 flex items-center justify-between text-sm text-gray-500">
                  <span>Налог</span>
                  <span>{formatCurrency(tax)}</span>
                </div>
                <div className="mt-3 border-t border-gray-200 pt-3 dark:border-gray-700">
                  <div className="text-xs text-gray-500">К оплате</div>
                  <div className="text-3xl font-black text-blue-600 sm:text-5xl">
                    {formatCurrency(total)}
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
