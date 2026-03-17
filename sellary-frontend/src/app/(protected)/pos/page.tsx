'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
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
  DocumentPlusIcon,
  ArchiveBoxXMarkIcon
} from '@heroicons/react/24/outline';

import ProductDrawer from '@/components/pos/ProductDrawer';
import toast from 'react-hot-toast';
import { addToSyncQueue } from '@/lib/syncQueue';
import { useServerHealth } from '@/providers/ServerHealthProvider';

export default function POS() {
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'card' | 'mobile'>('cash');
  const [cardType, setCardType] = useState<'alif' | 'eskhata' | 'dc' | null>(null);
  const [loading, setLoading] = useState(false);
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
    clearCart,
    getSubtotal,
    getTax,
    getTotal,
  } = useCartStore();

  const activeSession = sessions.find(s => s.id === activeSessionId);
  const items = useMemo(() => activeSession?.items || [], [activeSession]);

  useEffect(() => {
    registerHotkeys();
    return () => {
      hotkeyManager.unregister('Enter');
      hotkeyManager.unregister('F2');
    };
  }, []);

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

    // CRITICAL: Check server health BEFORE making API call
    // This prevents unnecessary timeouts when offline
    if (!isServerReachable) {
      // Server is known to be down, queue immediately
      await addToSyncQueue({
        url: '/api/sales',
        method: 'POST',
        body: saleData,
        type: 'sale'
      });
      toast.success('Офлайн режим: Чек сохранен в очереди', { icon: '💾' });

      // Clear cart
      if (sessions.length > 1) {
        deleteSession(activeSessionId);
      } else {
        clearCart();
      }
      setShowPaymentModal(false);
      setCardType(null);
      setLoading(false);
      return;
    }

    // Server is reachable, try direct API call
    try {
      await salesApi.create(saleData);
      toast.success('Продажа завершена!');

      if (sessions.length > 1) {
        deleteSession(activeSessionId);
      } else {
        clearCart();
      }
      setShowPaymentModal(false);
      setCardType(null);
    } catch (error: any) {
      // Server was supposed to be reachable but request failed
      // This could be a transient error, server just went down, etc.
      const isNetworkError = error.message === 'Network Error' || error.code === 'ERR_NETWORK' || error.code === 'ERR_INTERNET_DISCONNECTED';
      const shouldQueue = isNetworkError || error.response?.status >= 500;

      if (shouldQueue) {
        await addToSyncQueue({
          url: '/api/sales',
          method: 'POST',
          body: saleData,
          type: 'sale'
        });
        toast.success('Офлайн режим: Чек сохранен в очереди', { icon: '💾' });

        // Clear cart
        if (sessions.length > 1) {
          deleteSession(activeSessionId);
        } else {
          clearCart();
        }
        setShowPaymentModal(false);
        setCardType(null);
      } else {
        toast.error(error.response?.data?.detail || 'Ошибка при продаже');
      }
    } finally {
      setLoading(false);
    }
  }, [items, paymentMethod, cardType, sessions, activeSessionId, deleteSession, clearCart, isServerReachable]);

  useEffect(() => {
    hotkeyManager.register({
      key: 'Enter',
      handler: () => {
        if (showPaymentModal) {
          completeSale();
        } else if (!isDrawerOpen && items.length > 0) {
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
  }, [showPaymentModal, isDrawerOpen, items, completeSale]);

  const handleQuantityChange = (itemId: number, change: number) => {
    const item = items.find((i) => i.product.id === itemId);
    if (!item) return;
    const newQuantity = item.quantity + change;
    if (newQuantity <= 0) {
      removeItem(itemId);
    } else if (newQuantity <= item.product.stock_quantity) {
      updateQuantity(itemId, newQuantity);
    } else {
      toast.error(`Доступно: ${item.product.stock_quantity}`);
    }
  };

  const subtotal = getSubtotal();
  const tax = getTax();
  const total = getTotal();

  return (
    <>

      <div className="h-[calc(100vh-80px)] sm:h-[calc(100vh-100px)] flex flex-col">

        {/* Sessions Tabs */}
        <div className="flex items-center gap-1 sm:gap-2 mb-2 sm:mb-4 overflow-x-auto pb-2 scrollbar-hide">
          {sessions.map((session) => (
            <div
              key={session.id}
              onClick={() => switchSession(session.id)}
              className={`group relative flex items-center min-w-[100px] sm:min-w-[140px] cursor-pointer px-2 sm:px-4 py-2 sm:py-3 rounded-t-xl border-b-2 transition-all select-none ${session.id === activeSessionId
                ? 'bg-white dark:bg-gray-800 border-blue-500 text-blue-600 dark:text-blue-400 shadow-sm z-10'
                : 'bg-gray-100 dark:bg-gray-900 border-transparent text-gray-500 hover:bg-gray-50'
                }`}
            >
              <div className="flex-1 min-w-0">
                <div className="font-bold text-xs sm:text-sm truncate">{session.name}</div>
                <div className="text-[10px] sm:text-xs opacity-70">{session.items.length} шт</div>
              </div>
              {sessions.length > 1 && (
                <button
                  onClick={(e) => { e.stopPropagation(); deleteSession(session.id); }}
                  className="p-1 rounded-full opacity-0 group-hover:opacity-100 hover:bg-red-100 text-red-500 transition-all ml-1"
                >
                  <XMarkIcon className="w-3 h-3 sm:w-4 sm:h-4" />
                </button>
              )}
            </div>
          ))}
          <button
            onClick={createSession}
            className="flex items-center gap-1 sm:gap-2 px-2 sm:px-4 py-2 sm:py-3 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-xl transition-colors flex-shrink-0"
          >
            <DocumentPlusIcon className="w-4 h-4 sm:w-5 sm:h-5" />
            <span className="font-medium text-xs sm:text-sm hidden sm:inline">Новый чек</span>
          </button>
        </div>

        {/* Main Content */}
        <div className="flex-1 bg-white dark:bg-gray-800 rounded-2xl shadow-xl border border-gray-100 dark:border-gray-700 flex flex-col overflow-hidden relative">

          {/* Cart Items */}
          <div className="flex-1 overflow-y-auto p-2 sm:p-4 space-y-2 sm:space-y-3 pb-24">
            {items.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-gray-300 dark:text-gray-600">
                <ShoppingBagIcon className="w-16 h-16 sm:w-24 sm:h-24 mb-4 opacity-50" />
                <p className="text-sm sm:text-lg font-medium">Корзина пуста</p>
                <p className="text-xs sm:text-sm">Нажмите + чтобы добавить</p>
              </div>
            ) : (
              items.map((item) => (
                <div key={item.product.id} className="flex items-center justify-between p-2 sm:p-4 bg-gray-50 dark:bg-gray-750/50 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-xl transition-colors gap-2 sm:gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-gray-900 dark:text-white text-sm sm:text-lg truncate">{item.product.name}</div>
                    <div className="text-[10px] sm:text-sm text-gray-500">{formatCurrency(item.product.sell_price)}</div>
                  </div>

                  <div className="flex items-center gap-1 sm:gap-3">
                    <div className="flex items-center bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-600">
                      <button onClick={() => handleQuantityChange(item.product.id, -1)} className="p-1.5 sm:p-3 hover:text-blue-600">
                        <MinusIcon className="w-3 h-3 sm:w-5 sm:h-5" />
                      </button>
                      <span className="w-6 sm:w-10 text-center font-bold text-xs sm:text-base">{item.quantity}</span>
                      <button onClick={() => handleQuantityChange(item.product.id, 1)} className="p-1.5 sm:p-3 hover:text-blue-600">
                        <PlusIcon className="w-3 h-3 sm:w-5 sm:h-5" />
                      </button>
                    </div>

                    <div className="text-right min-w-[50px] sm:min-w-[80px]">
                      <div className="font-bold text-xs sm:text-lg text-blue-600">{formatCurrency(Number(item.product.sell_price) * item.quantity)}</div>
                    </div>

                    <button onClick={() => removeItem(item.product.id)} className="p-1 sm:p-2 text-gray-400 hover:text-red-500">
                      <TrashIcon className="w-4 h-4 sm:w-6 sm:h-6" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Bottom Fixed Bar */}
          <div className="absolute bottom-0 left-0 right-0 bg-white dark:bg-gray-800 border-t border-gray-100 dark:border-gray-700 p-2 sm:p-4 safe-area-bottom">
            <div className="flex items-center justify-between gap-2 sm:gap-4">
              {/* Add Button */}
              <button
                onClick={() => setIsDrawerOpen(true)}
                className="flex items-center justify-center gap-1 sm:gap-2 bg-blue-600 text-white px-3 sm:px-6 py-2.5 sm:py-3 rounded-xl shadow-lg hover:bg-blue-700 transition-all font-bold text-xs sm:text-base flex-shrink-0"
              >
                <PlusIcon className="w-4 h-4 sm:w-5 sm:h-5" />
                <span className="hidden sm:inline">Добавить</span>
              </button>

              {/* Summary */}
              <div className="flex-1 text-right">
                <div className="text-[10px] sm:text-xs text-gray-500">Итого</div>
                <div className="font-black text-lg sm:text-2xl text-blue-600">{formatCurrency(total)}</div>
              </div>

              {/* Pay Button */}
              <button
                onClick={() => items.length > 0 && setShowPaymentModal(true)}
                disabled={items.length === 0}
                className="bg-green-600 hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white px-4 sm:px-8 py-2.5 sm:py-3 rounded-xl font-bold text-sm sm:text-lg shadow-lg transition-all"
              >
                Оплатить
              </button>
            </div>

            {/* Clear Button - only show if cart has items */}
            {items.length > 0 && (
              <button
                onClick={() => clearCart()}
                className="w-full mt-2 py-1.5 sm:py-2 text-red-500 hover:bg-red-50 rounded-lg font-medium text-xs sm:text-sm flex items-center justify-center gap-1"
              >
                <ArchiveBoxXMarkIcon className="w-3 h-3 sm:w-4 sm:h-4" />
                Очистить
              </button>
            )}
          </div>
        </div>

        {/* Product Drawer */}
        <ProductDrawer
          isOpen={isDrawerOpen}
          onClose={() => setIsDrawerOpen(false)}
          onAddToCart={(product) => {
            addItem(product);
            toast.success(`${product.name} добавлен`);
          }}
        />

        {/* Payment Modal */}
        {showPaymentModal && (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
            <div className="absolute inset-0 bg-gray-900/60 backdrop-blur-sm" onClick={() => setShowPaymentModal(false)} />
            <div className="relative bg-white dark:bg-gray-800 rounded-t-3xl sm:rounded-3xl shadow-2xl w-full sm:max-w-lg p-4 sm:p-6 max-h-[90vh] overflow-y-auto safe-area-bottom">
              <div className="flex justify-between items-center mb-4 sm:mb-6">
                <h2 className="text-lg sm:text-2xl font-bold text-gray-900 dark:text-white">Оплата</h2>
                <button onClick={() => setShowPaymentModal(false)}><XMarkIcon className="w-5 h-5 sm:w-6 sm:h-6 text-gray-400" /></button>
              </div>

              <div className="text-center mb-4 sm:mb-8">
                <div className="text-xs sm:text-sm text-gray-500 mb-1">К оплате</div>
                <div className="text-3xl sm:text-5xl font-black text-blue-600">{formatCurrency(total)}</div>
              </div>

              <div className="grid grid-cols-3 gap-2 sm:gap-4 mb-4 sm:mb-6">
                <button onClick={() => { setPaymentMethod('cash'); setCardType(null); }} className={`flex flex-col items-center justify-center p-2 sm:p-4 rounded-xl border-2 transition-all ${paymentMethod === 'cash' ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 hover:border-gray-300'}`}>
                  <BanknotesIcon className="w-6 h-6 sm:w-8 sm:h-8 mb-1 sm:mb-2" />
                  <span className="font-semibold text-[10px] sm:text-sm">Наличные</span>
                </button>
                <button onClick={() => setPaymentMethod('card')} className={`flex flex-col items-center justify-center p-2 sm:p-4 rounded-xl border-2 transition-all ${paymentMethod === 'card' ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 hover:border-gray-300'}`}>
                  <CreditCardIcon className="w-6 h-6 sm:w-8 sm:h-8 mb-1 sm:mb-2" />
                  <span className="font-semibold text-[10px] sm:text-sm">Карта</span>
                </button>
                <button onClick={() => { setPaymentMethod('mobile'); setCardType(null); }} className={`flex flex-col items-center justify-center p-2 sm:p-4 rounded-xl border-2 transition-all ${paymentMethod === 'mobile' ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 hover:border-gray-300'}`}>
                  <DevicePhoneMobileIcon className="w-6 h-6 sm:w-8 sm:h-8 mb-1 sm:mb-2" />
                  <span className="font-semibold text-[10px] sm:text-sm">Мобильный</span>
                </button>
              </div>

              {paymentMethod === 'card' && (
                <div className="mb-4 sm:mb-8">
                  <div className="text-xs sm:text-sm font-medium text-gray-600 mb-2 sm:mb-3">Тип карты</div>
                  <div className="grid grid-cols-3 gap-2 sm:gap-3">
                    <button onClick={() => setCardType('alif')} className={`flex flex-col items-center p-2 sm:p-4 rounded-xl border-2 transition-all ${cardType === 'alif' ? 'border-green-500 bg-green-50' : 'border-gray-200 hover:border-green-300'}`}>
                      <div className={`text-lg sm:text-2xl font-bold mb-0.5 ${cardType === 'alif' ? 'text-green-600' : 'text-green-500'}`}>Alif</div>
                      <span className="text-[10px] sm:text-xs text-gray-500">Банк</span>
                    </button>
                    <button onClick={() => setCardType('eskhata')} className={`flex flex-col items-center p-2 sm:p-4 rounded-xl border-2 transition-all ${cardType === 'eskhata' ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-blue-300'}`}>
                      <div className={`text-lg sm:text-2xl font-bold mb-0.5 ${cardType === 'eskhata' ? 'text-blue-600' : 'text-blue-500'}`}>Eskhata</div>
                      <span className="text-[10px] sm:text-xs text-gray-500">Банк</span>
                    </button>
                    <button onClick={() => setCardType('dc')} className={`flex flex-col items-center p-2 sm:p-4 rounded-xl border-2 transition-all ${cardType === 'dc' ? 'border-purple-500 bg-purple-50' : 'border-gray-200 hover:border-purple-300'}`}>
                      <div className={`text-lg sm:text-2xl font-bold mb-0.5 ${cardType === 'dc' ? 'text-purple-600' : 'text-purple-500'}`}>DC</div>
                      <span className="text-[10px] sm:text-xs text-gray-500">Dushanbe</span>
                    </button>
                  </div>
                </div>
              )}

              <button
                onClick={completeSale}
                disabled={loading}
                className="w-full py-3 sm:py-4 bg-green-600 hover:bg-green-700 text-white rounded-xl font-bold text-base sm:text-xl shadow-lg transition-all"
              >
                {loading ? 'Обработка...' : 'Завершить'}
              </button>
            </div>
          </div>
        )}
      </div>

    </>
  );
}
