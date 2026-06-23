'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import Link from 'next/link';
import { useCartStore, useUIStore } from '@/lib/store';
import { salesApi, productsApi, categoriesApi } from '@/lib/api';
import { formatCurrency, hotkeyManager, printReceipt, registerHotkeys } from '@/lib/utils';
import { useProducts } from '@/hooks/useQueries';
import { useDebounce } from '@/hooks/useDebounce';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Category, Product } from '@/lib/types';
import { canAdd, isOverStock, remainingStock } from '@/lib/posStock';
import { cartLineKey, hasMultipleUnits, saleUnits } from '@/lib/posUnits';
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
  MagnifyingGlassIcon,
  QrCodeIcon,
} from '@heroicons/react/24/outline';

import toast from 'react-hot-toast';
import { useServerHealth } from '@/providers/ServerHealthProvider';
import {
  calculateCashPayment,
  calculateDiscountFromEditedPrice,
  calculatePosPricing,
  formatEditableAmount,
} from '@/lib/posPricing';

const PAYMENT_METHODS = [
  { id: 'cash', label: 'Наличные', Icon: BanknotesIcon },
  { id: 'card', label: 'Карта', Icon: CreditCardIcon },
  { id: 'mobile', label: 'Мобильный', Icon: DevicePhoneMobileIcon },
] as const;

const CARD_TYPES = [
  { id: 'alif', label: 'Alif' },
  { id: 'eskhata', label: 'Eskhata' },
  { id: 'dc', label: 'DC' },
] as const;

// Soft per-category tint for the tile icon chip, keyed deterministically so a
// category always reads the same colour.
const tilePalette = [
  'bg-sky-100 text-sky-600 dark:bg-sky-900/30 dark:text-sky-300',
  'bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-300',
  'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-300',
  'bg-orange-100 text-orange-600 dark:bg-orange-900/30 dark:text-orange-300',
  'bg-violet-100 text-violet-600 dark:bg-violet-900/30 dark:text-violet-300',
  'bg-rose-100 text-rose-600 dark:bg-rose-900/30 dark:text-rose-300',
  'bg-cyan-100 text-cyan-600 dark:bg-cyan-900/30 dark:text-cyan-300',
  'bg-teal-100 text-teal-600 dark:bg-teal-900/30 dark:text-teal-300',
];
const tileColor = (id?: number | null) =>
  id == null ? 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-300' : tilePalette[id % tilePalette.length];

export default function POS() {
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'card' | 'mobile'>('cash');
  const [cardType, setCardType] = useState<'alif' | 'eskhata' | 'dc' | null>(null);
  const [cashReceived, setCashReceived] = useState('');
  const [loading, setLoading] = useState(false);
  const [totalEdit, setTotalEdit] = useState<string | null>(null);
  const [priceEdits, setPriceEdits] = useState<Record<string, string>>({});
  const [qtyEdits, setQtyEdits] = useState<Record<string, string>>({});
  // Editable line total → back-computes quantity (qty = total / unit price). Lets
  // the cashier weigh goods and just enter the money amount.
  const [lineTotalEdits, setLineTotalEdits] = useState<Record<string, string>>({});
  const [showCartSheet, setShowCartSheet] = useState(false);
  const { isServerReachable } = useServerHealth();
  const queryClient = useQueryClient();
  const { cartPanelWidth, setCartPanelWidth } = useUIStore();
  const resizeStateRef = useRef<{ startX: number; startWidth: number } | null>(null);

  // Drag the handle between the catalog and the cart to resize the cart panel.
  // The cart sits on the right, so dragging left widens it. Width is clamped and
  // persisted inside the store's setter.
  const handleResizeStart = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      resizeStateRef.current = { startX: e.clientX, startWidth: cartPanelWidth };
      const onMove = (ev: PointerEvent) => {
        const state = resizeStateRef.current;
        if (!state) return;
        setCartPanelWidth(state.startWidth - (ev.clientX - state.startX));
      };
      const onUp = () => {
        resizeStateRef.current = null;
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        document.body.style.removeProperty('user-select');
        document.body.style.removeProperty('cursor');
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'col-resize';
    },
    [cartPanelWidth, setCartPanelWidth],
  );

  // Catalog state (inline register catalog).
  const [searchQuery, setSearchQuery] = useState('');
  const debouncedSearch = useDebounce(searchQuery, 300);
  const [selectedCategory, setSelectedCategory] = useState<number | null>(null);
  const [barcode, setBarcode] = useState('');
  const barcodeInputRef = useRef<HTMLInputElement>(null);

  const catalogParams: Record<string, string | number> = { limit: 100 };
  if (debouncedSearch) catalogParams.search = debouncedSearch;
  if (selectedCategory) catalogParams.category_id = selectedCategory;
  const { data: products = [], isLoading: productsLoading } = useProducts(catalogParams);

  const { data: categories = [] } = useQuery<Category[]>({
    queryKey: ['categories', 'active'],
    queryFn: async () => {
      const response = await categoriesApi.getAll({ active_only: true });
      return response.data;
    },
  });

  // Two-button confirm in a toast for destructive actions.
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
    changeUnit,
    setDiscount,
    clearCart,
    getSubtotal,
    getTax,
  } = useCartStore();
  const activeSession = sessions.find((session) => session.id === activeSessionId);
  const items = useMemo(() => activeSession?.items ?? [], [activeSession]);

  // Stock guardrails. The catalog query (`products`) holds the freshest stock;
  // fall back to the cart item's snapshot for products outside the current
  // search/category filter. All stock math is in the product's BASE unit — a
  // cart line in an alternative unit consumes `quantity * unit.factor` base units.
  const productStock = useMemo(() => {
    const map = new Map<number, number>();
    for (const product of products) map.set(product.id, Number(product.stock_quantity));
    return map;
  }, [products]);
  const stockForItem = useCallback(
    (item: { product: Product }) =>
      productStock.get(item.product.id) ?? Number(item.product.stock_quantity),
    [productStock],
  );
  // Total base-unit demand per product across all cart lines (units share stock).
  const cartBaseByProduct = useMemo(() => {
    const map = new Map<number, number>();
    for (const item of items) {
      const base = item.quantity * (item.unit?.factor ?? 1);
      map.set(item.product.id, (map.get(item.product.id) ?? 0) + base);
    }
    return map;
  }, [items]);
  // Max sellable quantity for a line in its own unit, given other lines of the
  // same product already claim some of the shared stock.
  const maxSoldForItem = useCallback(
    (item: { product: Product; unit?: { factor: number }; quantity: number }) => {
      const factor = item.unit?.factor ?? 1;
      const stock = stockForItem(item);
      const otherBase = (cartBaseByProduct.get(item.product.id) ?? 0) - item.quantity * factor;
      return Math.max(0, (stock - otherBase) / factor);
    },
    [stockForItem, cartBaseByProduct],
  );
  const overStockItems = useMemo(
    () =>
      items.filter((item) =>
        isOverStock(stockForItem(item), cartBaseByProduct.get(item.product.id) ?? 0),
      ),
    [items, stockForItem, cartBaseByProduct],
  );
  const hasOverStock = overStockItems.length > 0;

  const [overallDiscounts, setOverallDiscounts] = useState<Record<string, number>>({});
  const overallDiscount = overallDiscounts[activeSessionId] ?? 0;
  const setActiveOverallDiscount = useCallback(
    (discount: number) => {
      setOverallDiscounts((prev) => ({ ...prev, [activeSessionId]: discount }));
    },
    [activeSessionId],
  );

  const subtotal = getSubtotal();
  const tax = getTax();
  const itemDiscounts = items.reduce((sum, item) => sum + (item.discount || 0), 0);
  const pricing = calculatePosPricing({ subtotal, tax, itemDiscounts, overallDiscount });
  const finalTotal = pricing.finalTotal;
  const cashPayment = useMemo(
    () => calculateCashPayment(cashReceived, finalTotal),
    [cashReceived, finalTotal],
  );
  const openPaymentModal = useCallback(() => {
    setCashReceived(formatEditableAmount(finalTotal));
    setShowPaymentModal(true);
  }, [finalTotal]);

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
    setCashReceived('');
    setTotalEdit(null);
    setPriceEdits({});
    setQtyEdits({});
    setLineTotalEdits({});
    setLoading(false);
  }, [activeSessionId]);

  const handleAddToCart = useCallback(
    (product: Product) => {
      // Tiles add one unit of the base unit (factor 1 -> +1 base unit).
      const inCartBase = cartBaseByProduct.get(product.id) ?? 0;
      const stock = Number(product.stock_quantity);
      if (!canAdd(stock, inCartBase, 1)) {
        const left = remainingStock(stock, inCartBase);
        toast.error(
          left > 0
            ? `«${product.name}»: доступно ещё ${left} ${product.uom}`
            : `«${product.name}» — нет в наличии. Пополните через «Закупки».`,
        );
        return;
      }
      addItem(product);
      toast.success(`${product.name} добавлен`);
    },
    [addItem, cartBaseByProduct],
  );

  const handleBarcodeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!barcode.trim()) return;
    try {
      const response = await productsApi.getByBarcode(barcode);
      handleAddToCart(response.data);
      setBarcode('');
    } catch (error: any) {
      toast.error(error.response?.data?.detail || 'Товар не найден');
    }
    barcodeInputRef.current?.focus();
  };

  const resetCheckout = useCallback(() => {
    clearCart();
    setShowPaymentModal(false);
    setShowCartSheet(false);
    setCardType(null);
    setPaymentMethod('cash');
    setCashReceived('');
    setActiveOverallDiscount(0);
    setTotalEdit(null);
    setPriceEdits({});
    setQtyEdits({});
    setLineTotalEdits({});
  }, [clearCart, setActiveOverallDiscount]);

  const completeSale = useCallback(async () => {
    if (items.length === 0) {
      toast.error('Корзина пуста');
      return;
    }

    if (hasOverStock) {
      toast.error('Недостаточно товара на складе. Проверьте корзину.');
      return;
    }

    if (paymentMethod === 'card' && !cardType) {
      toast.error('Выберите тип карты');
      return;
    }

    if (paymentMethod === 'cash' && !cashPayment.isSufficient) {
      toast.error('Недостаточно наличных');
      return;
    }

    setLoading(true);

    const saleItems = items.map((item) => {
      const unitPrice = Number(item.unit?.price ?? item.product.sell_price);
      const hasMarkup = item.discount < 0;
      return {
        product_id: item.product.id,
        // null = base unit; quantity & unit_price are in the chosen unit.
        product_unit_id: item.unit?.id ?? null,
        quantity: item.quantity,
        unit_price: hasMarkup ? unitPrice + Math.abs(item.discount) : unitPrice,
        tax_percent: Number(item.product.tax_percent),
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
      // Refresh stock counts so the catalog reflects what was just sold.
      queryClient.invalidateQueries({ queryKey: ['products'] });
      // Clear the register first so the next sale can start immediately, then
      // print on the next tick — window.print() is blocking and must not sit on
      // the checkout's critical path.
      resetCheckout();
      setTimeout(() => printReceipt(sale), 0);
    } catch (error: any) {
      const detail = error.response?.data?.detail;
      // The backend FIFO ledger is the final guard against overselling. If a
      // race (stale stock, a parallel sale) slips a line through the UI checks,
      // turn the raw "Insufficient stock…" string into an actionable message
      // and refresh the catalog so the cashier sees the corrected counts.
      if (typeof detail === 'string' && detail.toLowerCase().includes('insufficient stock')) {
        queryClient.invalidateQueries({ queryKey: ['products'] });
        toast.error(
          'Недостаточно товара на складе. Количества обновлены — уменьшите количество в корзине или пополните запас через «Закупки».',
        );
      } else {
        toast.error(detail || 'Не удалось завершить продажу');
      }
    } finally {
      setLoading(false);
    }
  }, [items, hasOverStock, paymentMethod, cardType, cashPayment.isSufficient, isServerReachable, overallDiscount, resetCheckout, queryClient]);

  useEffect(() => {
    hotkeyManager.register({
      key: 'Enter',
      handler: () => {
        if (showPaymentModal) {
          completeSale();
        } else if (items.length > 0) {
          openPaymentModal();
        }
      },
      description: 'Завершить продажу',
    });

    hotkeyManager.register({
      key: 'F2',
      handler: () => barcodeInputRef.current?.focus(),
      description: 'Фокус на штрихкод',
    });
  }, [showPaymentModal, items.length, completeSale, openPaymentModal]);

  // Esc closes the payment modal.
  useEffect(() => {
    if (!showPaymentModal) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowPaymentModal(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [showPaymentModal]);

  const getSessionItemCount = (sessionItems: typeof items) =>
    sessionItems.reduce((sum, item) => sum + item.quantity, 0);
  const cartCount = getSessionItemCount(items);

  // ---- Cart panel (shared between desktop aside and mobile sheet) ----
  const cartPanel = (
    <div className="flex h-full flex-col">
      {/* Session tabs */}
      <div role="tablist" aria-label="Активные продажи" className="flex items-center gap-2 overflow-x-auto whitespace-nowrap border-b border-gray-100 px-3 py-3 dark:border-gray-700">
        {sessions.map((session) => {
          const isActive = session.id === activeSessionId;
          const count = getSessionItemCount(session.items);
          return (
            <div
              key={session.id}
              className={`flex h-9 shrink-0 items-center rounded-xl transition-colors ${
                isActive ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-300'
              }`}
            >
              <button
                type="button"
                role="tab"
                aria-selected={isActive}
                aria-current={isActive ? 'page' : undefined}
                onClick={() => switchSession(session.id)}
                className="flex h-full items-center gap-2 rounded-xl px-3 text-[13px] font-bold"
              >
                <span className="max-w-24 truncate">{session.name}</span>
                <span className={`rounded-full px-1.5 text-[11px] ${isActive ? 'bg-white/25' : 'bg-white dark:bg-gray-800'}`}>{count}</span>
              </button>
              {sessions.length > 1 && (
                <button
                  type="button"
                  aria-label={`Закрыть ${session.name}`}
                  onClick={() => {
                    if (count > 0) {
                      confirmAction(`Закрыть «${session.name}»? Товаров: ${count}.`, 'Закрыть', () => deleteSession(session.id));
                    } else {
                      deleteSession(session.id);
                    }
                  }}
                  className={`mr-1 rounded-lg p-1 ${isActive ? 'text-white/80 hover:bg-white/20' : 'text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600'}`}
                >
                  <XMarkIcon className="h-4 w-4" />
                </button>
              )}
            </div>
          );
        })}
        <button
          type="button"
          aria-label="Новая продажа"
          title="Новая продажа"
          onClick={createSession}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gray-900 text-white transition-colors hover:bg-gray-700 dark:bg-gray-600 dark:hover:bg-gray-500"
        >
          <PlusIcon className="h-5 w-5" />
        </button>
      </div>

      <div className="flex items-center gap-2 px-5 pb-2 pt-4">
        <h2 className="text-[18px] font-extrabold text-gray-900 dark:text-white">Чек</h2>
        <span className="ml-auto text-[13px] font-semibold text-gray-400">{cartCount} товаров</span>
      </div>

      {/* Items */}
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 pb-2">
        {items.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <ShoppingBagIcon className="mb-3 h-16 w-16 text-gray-200 dark:text-gray-600" />
            <p className="text-sm font-medium text-gray-500 dark:text-gray-300">Корзина пуста</p>
            <p className="text-xs text-gray-400">Нажмите на товар слева, чтобы добавить</p>
          </div>
        ) : (
          items.map((item) => {
            const key = cartLineKey(item.product.id, item.unit?.id ?? null);
            const unitPrice = Number(item.unit?.price ?? item.product.sell_price);
            const unitLabel = item.unit?.label ?? item.product.uom;
            const discountAmount = item.discount || 0;
            const finalPrice = unitPrice - discountAmount;
            const hasPriceAdjustment = discountAmount !== 0;
            const isMarkup = discountAmount < 0;
            const absDiscountAmount = Math.abs(discountAmount);
            const units = saleUnits(item.product);
            const showUnitPicker = hasMultipleUnits(item.product);
            const maxSold = maxSoldForItem(item);
            const lineOverStock = isOverStock(
              stockForItem(item),
              cartBaseByProduct.get(item.product.id) ?? 0,
            );

            return (
              <div
                key={key}
                className={`rounded-2xl p-3 transition-colors ${
                  hasPriceAdjustment
                    ? isMarkup
                      ? 'bg-blue-50 ring-1 ring-blue-200 dark:bg-blue-900/10 dark:ring-blue-800'
                      : 'bg-green-50 ring-1 ring-green-200 dark:bg-green-900/10 dark:ring-green-800'
                    : 'bg-gray-50 dark:bg-gray-700/50'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl text-sm font-bold ${tileColor(item.product.category_id)}`}>
                    {item.product.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14px] font-bold text-gray-900 dark:text-white">{item.product.name}</p>
                    <p className="text-[12px] text-gray-400">{formatCurrency(unitPrice)} / {unitLabel}</p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        const next = item.quantity - 1;
                        if (next <= 0) removeItem(key);
                        else updateQuantity(key, next);
                      }}
                      className="grid h-8 w-8 place-items-center rounded-xl bg-white text-lg font-bold text-gray-600 shadow-sm dark:bg-gray-800 dark:text-gray-200"
                    >
                      −
                    </button>
                    <input
                      type="text"
                      inputMode="decimal"
                      aria-label={`Количество: ${item.product.name}`}
                      value={qtyEdits[key] ?? item.quantity.toString()}
                      onChange={(e) => setQtyEdits((prev) => ({ ...prev, [key]: e.target.value }))}
                      onBlur={() => {
                        const raw = qtyEdits[key];
                        setQtyEdits((prev) => {
                          const next = { ...prev };
                          delete next[key];
                          return next;
                        });
                        if (raw === undefined) return;
                        const parsed = parseFloat(raw.replace(',', '.'));
                        if (isNaN(parsed) || parsed <= 0) return;
                        if (parsed > maxSold + 1e-9) {
                          // Clamp to what the shared stock can cover rather than
                          // leaving an invalid quantity that would fail at checkout.
                          if (maxSold <= 0) {
                            removeItem(key);
                            toast.error(`«${item.product.name}» — нет в наличии`);
                          } else {
                            const clamped = Number(maxSold.toFixed(3));
                            updateQuantity(key, clamped);
                            toast.error(`Доступно только ${clamped} ${unitLabel}`);
                          }
                          return;
                        }
                        updateQuantity(key, parsed);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                      }}
                      className="w-10 rounded-lg border border-transparent bg-transparent text-center text-sm font-extrabold text-gray-900 focus:border-gray-200 focus:bg-white focus:outline-none dark:text-white dark:focus:bg-gray-800"
                    />
                    <button
                      type="button"
                      disabled={item.quantity + 1 > maxSold + 1e-9}
                      title={
                        item.quantity + 1 > maxSold + 1e-9
                          ? `Доступно: ${Number(maxSold.toFixed(3))} ${unitLabel}`
                          : undefined
                      }
                      onClick={() => updateQuantity(key, item.quantity + 1)}
                      className="grid h-8 w-8 place-items-center rounded-xl bg-blue-600 text-lg font-bold text-white transition-opacity disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-500 dark:disabled:bg-gray-600"
                    >
                      +
                    </button>
                  </div>
                </div>

                {showUnitPicker && (
                  <div className="mt-2 flex items-center gap-2">
                    <span className="text-[11px] text-gray-400">Ед.</span>
                    <select
                      aria-label={`Единица измерения: ${item.product.name}`}
                      value={String(item.unit?.id ?? 'base')}
                      onChange={(e) => {
                        const next = units.find(
                          (u) => String(u.id ?? 'base') === e.target.value,
                        );
                        if (next) changeUnit(key, next);
                      }}
                      className="h-8 flex-1 rounded-lg border border-gray-200 bg-white px-2 text-[12px] font-semibold text-gray-700 focus:border-blue-400 focus:outline-none dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
                    >
                      {units.map((u) => (
                        <option key={String(u.id ?? 'base')} value={String(u.id ?? 'base')}>
                          {u.label} · {formatCurrency(u.price)}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div className="mt-2 flex items-center gap-2">
                  <span className="text-[11px] text-gray-400">Цена</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={priceEdits[key] ?? formatEditableAmount(hasPriceAdjustment ? finalPrice : unitPrice)}
                    onChange={(e) => setPriceEdits((prev) => ({ ...prev, [key]: e.target.value }))}
                    onBlur={() => {
                      const raw = priceEdits[key];
                      if (raw !== undefined) {
                        setDiscount(key, calculateDiscountFromEditedPrice(raw, unitPrice));
                      }
                      setPriceEdits((prev) => {
                        const next = { ...prev };
                        delete next[key];
                        return next;
                      });
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                    }}
                    className={`w-24 rounded-lg border bg-white px-2 py-1 text-right text-[13px] font-bold focus:outline-none focus:ring-2 dark:bg-gray-800 ${
                      isMarkup
                        ? 'border-blue-300 text-blue-700 focus:ring-blue-400 dark:border-blue-700 dark:text-blue-300'
                        : hasPriceAdjustment
                          ? 'border-green-300 text-green-700 focus:ring-green-400 dark:border-green-700 dark:text-green-300'
                          : 'border-gray-200 text-gray-700 focus:ring-blue-400 dark:border-gray-600 dark:text-gray-200'
                    }`}
                  />
                  {hasPriceAdjustment && (
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${isMarkup ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' : 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'}`}>
                      {isMarkup ? '+' : '−'}{formatCurrency(absDiscountAmount)}
                    </span>
                  )}
                  <input
                    type="text"
                    inputMode="decimal"
                    aria-label={`Сумма: ${item.product.name}`}
                    title="Введите сумму — количество посчитается автоматически"
                    value={lineTotalEdits[key] ?? formatEditableAmount(finalPrice * item.quantity)}
                    onChange={(e) => setLineTotalEdits((prev) => ({ ...prev, [key]: e.target.value }))}
                    onBlur={() => {
                      const raw = lineTotalEdits[key];
                      setLineTotalEdits((prev) => {
                        const next = { ...prev };
                        delete next[key];
                        return next;
                      });
                      if (raw === undefined) return;
                      const total = parseFloat(raw.replace(',', '.'));
                      // Back-compute quantity from the entered amount (qty = total / unit price).
                      if (isNaN(total) || total < 0 || finalPrice <= 0) return;
                      let qty = total / finalPrice;
                      if (qty > maxSold + 1e-9) {
                        qty = maxSold;
                        toast.error(`Доступно только ${Number(maxSold.toFixed(3))} ${unitLabel}`);
                      }
                      if (qty <= 0) {
                        removeItem(key);
                        return;
                      }
                      updateQuantity(key, Number(qty.toFixed(3)));
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                    }}
                    className="ml-auto w-24 rounded-lg border border-transparent bg-transparent px-1 py-0.5 text-right text-[14px] font-extrabold tabular-nums text-gray-900 focus:border-gray-200 focus:bg-white focus:outline-none dark:text-white dark:focus:bg-gray-800"
                  />
                  <button
                    type="button"
                    aria-label={`Удалить ${item.product.name}`}
                    onClick={() => removeItem(key)}
                    className="rounded-lg p-1.5 text-gray-400 hover:bg-white hover:text-red-600 dark:hover:bg-gray-800"
                  >
                    <TrashIcon className="h-4 w-4" />
                  </button>
                </div>

                {lineOverStock && (
                  <div className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-1 rounded-lg bg-red-50 px-2.5 py-1.5 text-[11px] font-medium text-red-700 dark:bg-red-900/20 dark:text-red-300">
                    <span>На складе только {stockForItem(item)} {item.product.uom}.</span>
                    <Link
                      href="/purchase-orders"
                      className="font-semibold underline underline-offset-2 hover:text-red-800 dark:hover:text-red-200"
                    >
                      Пополнить запас
                    </Link>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Totals + pay */}
      <div className="border-t border-gray-100 p-4 dark:border-gray-700">
        <div className="mb-1 flex justify-between text-[13px] text-gray-500"><span>Подытог</span><span className="tabular-nums">{formatCurrency(subtotal)}</span></div>
        <div className="mb-1 flex justify-between text-[13px] text-gray-500"><span>Налог</span><span className="tabular-nums">{formatCurrency(tax)}</span></div>
        <div className="mb-3 flex items-end justify-between">
          <span className="font-bold text-gray-900 dark:text-white">Итого</span>
          <span className="text-[28px] font-extrabold leading-none tabular-nums text-gray-900 dark:text-white">{formatCurrency(finalTotal)}</span>
        </div>
        {hasOverStock && (
          <div className="mb-3 rounded-xl bg-red-50 p-2.5 text-[12px] leading-snug text-red-700 dark:bg-red-900/20 dark:text-red-300">
            <p className="font-semibold">Недостаточно товара на складе:</p>
            <p className="mt-0.5">{overStockItems.map((item) => item.product.name).join(', ')}.</p>
            <p className="mt-1">
              Уменьшите количество или{' '}
              <Link href="/purchase-orders" className="font-semibold underline underline-offset-2">
                пополните запас
              </Link>
              .
            </p>
          </div>
        )}
        <div className="flex gap-2">
          {items.length > 0 && (
            <button
              type="button"
              onClick={() => confirmAction('Очистить корзину? Все товары будут удалены.', 'Очистить', () => clearCart())}
              title="Очистить корзину"
              className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-gray-100 text-gray-500 transition-colors hover:bg-red-50 hover:text-red-600 dark:bg-gray-700 dark:text-gray-300"
            >
              <ArchiveBoxXMarkIcon className="h-5 w-5" />
            </button>
          )}
          <button
            type="button"
            onClick={() => items.length > 0 && !hasOverStock && openPaymentModal()}
            disabled={items.length === 0 || hasOverStock}
            title={hasOverStock ? 'Недостаточно товара на складе' : undefined}
            className="flex h-14 flex-1 items-center justify-center gap-2 rounded-2xl text-[17px] font-extrabold text-white shadow-lg transition-all hover:brightness-105 active:scale-[.99] disabled:cursor-not-allowed disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg,#22c55e,#16a34a)' }}
          >
            Оплатить →
            <kbd className="hidden rounded bg-white/20 px-1.5 py-0.5 text-[11px] font-semibold lg:inline">Enter</kbd>
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <>
      <div className="flex h-full min-h-0 gap-4">
        {/* Catalog */}
        <main className="flex min-w-0 flex-1 flex-col">
          {/* Search + barcode */}
          <div className="mb-3 flex items-center gap-2">
            <div className="relative flex-1">
              <MagnifyingGlassIcon className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Поиск товара…"
                className="h-11 w-full rounded-2xl border border-gray-200 bg-white pl-10 pr-3 text-sm shadow-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 dark:border-gray-600 dark:bg-gray-800"
              />
            </div>
            <form onSubmit={handleBarcodeSubmit} className="relative w-40 sm:w-52">
              <QrCodeIcon className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" />
              <input
                ref={barcodeInputRef}
                type="text"
                value={barcode}
                onChange={(e) => setBarcode(e.target.value)}
                placeholder="Штрихкод"
                className="h-11 w-full rounded-2xl border border-gray-200 bg-white pl-10 pr-3 font-mono text-sm shadow-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 dark:border-gray-600 dark:bg-gray-800"
              />
            </form>
          </div>

          {/* Category chips */}
          <div className="-mx-1 mb-3 flex gap-2 overflow-x-auto whitespace-nowrap px-1">
            <button
              type="button"
              onClick={() => setSelectedCategory(null)}
              className={`h-9 shrink-0 rounded-xl px-4 text-[13px] font-bold transition-colors ${
                selectedCategory === null
                  ? 'bg-gray-900 text-white dark:bg-gray-600'
                  : 'border border-gray-200 bg-white text-gray-600 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300'
              }`}
            >
              Все
            </button>
            {categories.map((cat) => (
              <button
                key={cat.id}
                type="button"
                onClick={() => setSelectedCategory(cat.id === selectedCategory ? null : cat.id)}
                className={`h-9 shrink-0 rounded-xl px-4 text-[13px] font-bold transition-colors ${
                  selectedCategory === cat.id
                    ? 'bg-blue-600 text-white'
                    : 'border border-gray-200 bg-white text-gray-600 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300'
                }`}
              >
                {cat.name}
              </button>
            ))}
          </div>

          {/* Tiles */}
          <div className="min-h-0 flex-1 overflow-y-auto pb-24 lg:pb-0">
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {productsLoading
                ? Array.from({ length: 10 }).map((_, i) => (
                    <div key={i} className="h-36 animate-pulse rounded-3xl border border-gray-100 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
                      <div className="mb-3 h-10 w-10 rounded-2xl bg-gray-200 dark:bg-gray-700" />
                      <div className="mb-2 h-3 w-3/4 rounded bg-gray-200 dark:bg-gray-700" />
                      <div className="h-3 w-1/2 rounded bg-gray-200 dark:bg-gray-700" />
                    </div>
                  ))
                : products.map((product) => {
                    const stock = Number(product.stock_quantity);
                    const inCartBase = cartBaseByProduct.get(product.id) ?? 0;
                    const left = remainingStock(stock, inCartBase);
                    const out = stock <= 0;
                    // Tiles add one base unit; disable when a full unit no longer fits.
                    const cannotAdd = out || !canAdd(stock, inCartBase, 1);
                    return (
                      <button
                        key={product.id}
                        type="button"
                        onClick={() => handleAddToCart(product)}
                        disabled={cannotAdd}
                        title={
                          out
                            ? 'Нет в наличии — пополните через «Закупки»'
                            : cannotAdd
                              ? 'Весь доступный остаток уже в корзине'
                              : undefined
                        }
                        className={`group relative flex h-36 flex-col overflow-hidden rounded-3xl border border-gray-100 bg-white p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-lg active:scale-95 dark:border-gray-700 dark:bg-gray-800 ${
                          cannotAdd ? 'cursor-not-allowed opacity-50 grayscale' : ''
                        }`}
                      >
                        <span
                          className={`absolute right-3 top-3 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                            out || left <= 0
                              ? 'bg-gray-200 text-gray-500 dark:bg-gray-700 dark:text-gray-400'
                              : left <= Number(product.min_stock_level)
                                ? 'bg-red-100 text-red-700'
                                : 'bg-emerald-100 text-emerald-700'
                          }`}
                        >
                          {out ? 'нет' : left <= 0 ? 'в корзине' : `${left} ${product.uom}`}
                        </span>
                        <div className={`mb-auto grid h-10 w-10 place-items-center rounded-2xl text-base font-bold ${tileColor(product.category_id)}`}>
                          {product.name.charAt(0).toUpperCase()}
                        </div>
                        <h3 className="line-clamp-2 text-[13px] font-bold leading-tight text-gray-900 dark:text-white">{product.name}</h3>
                        {product.category?.name && (
                          <p className="truncate text-[11px] font-semibold text-gray-400">{product.category.name}</p>
                        )}
                        <div className="mt-1 text-[16px] font-extrabold tabular-nums text-gray-900 dark:text-white">
                          {formatCurrency(product.sell_price)}
                        </div>
                      </button>
                    );
                  })}
            </div>
            {!productsLoading && products.length === 0 && (
              <div className="py-16 text-center text-sm text-gray-400">Товары не найдены</div>
            )}
          </div>
        </main>

        {/* Resize handle (desktop only) */}
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Изменить ширину корзины"
          onPointerDown={handleResizeStart}
          className="group hidden w-2 shrink-0 cursor-col-resize items-center justify-center lg:flex"
        >
          <div className="h-12 w-1 rounded-full bg-gray-300 transition-colors group-hover:bg-blue-400 dark:bg-gray-600 dark:group-hover:bg-blue-500" />
        </div>

        {/* Cart — desktop aside */}
        <aside
          style={{ width: cartPanelWidth }}
          className="hidden shrink-0 overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-xl dark:border-gray-700 dark:bg-gray-800 lg:block"
        >
          {cartPanel}
        </aside>
      </div>

      {/* Mobile cart bar */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-gray-100 bg-white p-3 shadow-2xl dark:border-gray-700 dark:bg-gray-800 lg:hidden">
        <button
          type="button"
          onClick={() => setShowCartSheet(true)}
          className="flex w-full items-center gap-3 rounded-2xl bg-gray-900 px-4 py-3 text-white dark:bg-gray-700"
        >
          <ShoppingBagIcon className="h-5 w-5" />
          <span className="font-bold">Корзина · {cartCount}</span>
          <span className="ml-auto text-[18px] font-extrabold tabular-nums">{formatCurrency(finalTotal)}</span>
        </button>
      </div>

      {/* Mobile cart sheet */}
      {showCartSheet && (
        <div className="fixed inset-0 z-40 flex flex-col justify-end lg:hidden">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setShowCartSheet(false)} />
          <div className="relative max-h-[88vh] overflow-hidden rounded-t-3xl bg-white shadow-2xl dark:bg-gray-800">
            {cartPanel}
          </div>
        </div>
      )}

      {/* Payment modal */}
      {showPaymentModal && (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
          <div className="absolute inset-0 bg-gray-900/60 backdrop-blur-sm" onClick={() => setShowPaymentModal(false)} />
          <div className="relative max-h-[90vh] w-full overflow-y-auto rounded-t-3xl bg-white p-4 shadow-2xl dark:bg-gray-800 sm:max-w-lg sm:rounded-3xl sm:p-6">
            <div className="mb-4 flex items-center justify-between sm:mb-6">
              <h2 className="text-lg font-bold text-gray-900 dark:text-white sm:text-2xl">Оплата</h2>
              <button
                type="button"
                aria-label="Закрыть"
                onClick={() => setShowPaymentModal(false)}
                className="rounded-lg p-1 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:text-gray-300 dark:hover:bg-gray-700"
              >
                <XMarkIcon className="h-5 w-5 sm:h-6 sm:w-6" />
              </button>
            </div>

            <div className="mb-4 rounded-2xl bg-gray-50 p-4 dark:bg-gray-900 sm:mb-6">
              <div className="flex items-center justify-between text-sm text-gray-500"><span>Подытог</span><span className="tabular-nums">{formatCurrency(subtotal)}</span></div>
              {itemDiscounts > 0 && (
                <div className="mt-1 flex items-center justify-between text-sm text-green-600"><span>Скидки на товары</span><span className="tabular-nums">-{formatCurrency(itemDiscounts)}</span></div>
              )}
              {itemDiscounts < 0 && (
                <div className="mt-1 flex items-center justify-between text-sm text-blue-600"><span>Наценки на товары</span><span className="tabular-nums">+{formatCurrency(Math.abs(itemDiscounts))}</span></div>
              )}
              {overallDiscount > 0 && (
                <div className="mt-1 flex items-center justify-between text-sm text-green-600"><span>Общая скидка</span><span className="tabular-nums">-{formatCurrency(overallDiscount)}</span></div>
              )}
              {overallDiscount < 0 && (
                <div className="mt-1 flex items-center justify-between text-sm text-blue-600"><span>Общая наценка</span><span className="tabular-nums">+{formatCurrency(Math.abs(overallDiscount))}</span></div>
              )}
              <div className="mt-2 flex items-center justify-between text-sm text-gray-500"><span>Налог</span><span className="tabular-nums">{formatCurrency(tax)}</span></div>
              <div className="mt-3 border-t border-gray-200 pt-3 dark:border-gray-700">
                <div className="text-xs text-gray-500">К оплате</div>
                <div className="text-3xl font-black tabular-nums text-blue-600 sm:text-5xl">{formatCurrency(finalTotal)}</div>
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
                      if (id === 'cash') setCashReceived(formatEditableAmount(finalTotal));
                    }}
                    className={`relative flex min-h-[44px] flex-col items-center justify-center rounded-xl border-2 p-2 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 sm:p-4 ${
                      selected
                        ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-200'
                        : 'border-gray-200 text-gray-600 hover:border-gray-300 dark:border-gray-600 dark:text-gray-300'
                    }`}
                  >
                    {selected && <CheckCircleIcon className="absolute right-1 top-1 h-4 w-4 text-blue-600 dark:text-blue-300" />}
                    <Icon className="mb-1 h-6 w-6 sm:mb-2 sm:h-8 sm:w-8" />
                    <span className="text-[10px] font-semibold sm:text-sm">{label}</span>
                  </button>
                );
              })}
            </div>

            {paymentMethod === 'cash' && (
              <div className="mb-4 rounded-2xl border border-gray-200 p-4 dark:border-gray-700 sm:mb-6">
                <label
                  htmlFor="cash-received"
                  className="mb-2 block text-xs font-medium text-gray-600 dark:text-gray-300 sm:text-sm"
                >
                  Получено наличными
                </label>
                <input
                  id="cash-received"
                  type="text"
                  inputMode="decimal"
                  value={cashReceived}
                  onChange={(event) => setCashReceived(event.target.value)}
                  className="h-12 w-full rounded-xl border border-gray-300 bg-white px-4 text-right text-xl font-extrabold tabular-nums text-gray-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:border-gray-600 dark:bg-gray-900 dark:text-white dark:focus:ring-blue-900/40"
                />
                <div
                  className={`mt-3 flex items-center justify-between rounded-xl px-3 py-2 text-sm font-bold ${
                    cashPayment.isSufficient
                      ? 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-300'
                      : 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300'
                  }`}
                >
                  <span>{cashPayment.isSufficient ? 'Сдача' : 'Не хватает'}</span>
                  <span className="text-lg tabular-nums">
                    {formatCurrency(cashPayment.isSufficient ? cashPayment.change : cashPayment.shortfall)}
                  </span>
                </div>
              </div>
            )}

            {paymentMethod === 'card' && (
              <div className="mb-4 sm:mb-8">
                <div className="mb-2 text-xs font-medium text-gray-600 sm:mb-3 sm:text-sm">Тип карты</div>
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
                          selected ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20' : 'border-gray-200 hover:border-gray-300 dark:border-gray-600'
                        }`}
                      >
                        {selected && <CheckCircleIcon className="absolute right-1 top-1 h-4 w-4 text-blue-600 dark:text-blue-300" />}
                        <div className={`text-lg font-bold sm:text-2xl ${selected ? 'text-blue-700 dark:text-blue-200' : 'text-gray-600 dark:text-gray-300'}`}>{label}</div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <button
              onClick={completeSale}
              disabled={loading || hasOverStock || (paymentMethod === 'cash' && !cashPayment.isSufficient)}
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
    </>
  );
}
