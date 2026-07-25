'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import Link from 'next/link';
import { Squares2X2Icon } from '@heroicons/react/24/outline';
import { useAuthStore, useCartStore, useModules, useUIStore } from '@/lib/store';
import { canAccessModule } from '@/lib/modules';
import { salesApi, productsApi, categoriesApi, customersApi, generateIdempotencyKey } from '@/lib/api';
import { formatCurrency, hotkeyManager, printReceipt, registerHotkeys } from '@/lib/utils';
import FilterMenu from '@/components/filters/FilterMenu';
import { ModuleGuard } from '@/components/ModuleGuard';
import { useCurrentShift, useProducts } from '@/hooks/useQueries';
import { ShiftGateBanner, useHasOpenShift } from '@/components/shifts/ShiftGate';
import { useDebounce } from '@/hooks/useDebounce';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Category, Customer, Product } from '@/lib/types';
import { isOverStock, nextAddQuantity, remainingStock } from '@/lib/posStock';
import { useSettingsStore } from '@/store/settingsStore';
import { cartLineKey, hasMultipleUnits, saleUnits } from '@/lib/posUnits';
import {
  PlusIcon,
  TrashIcon,
  BanknotesIcon,
  CreditCardIcon,
  DevicePhoneMobileIcon,
  DocumentTextIcon,
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
  calculateCreditInitialPayment,
  calculateDiscountFromEditedPrice,
  calculateCartTotals,
  formatEditableAmount,
} from '@/lib/posPricing';

type PosPaymentMethod = 'cash' | 'card' | 'mobile' | 'credit';
type CreditInitialPaymentMethod = 'cash' | 'card' | 'mobile';
type PosStockFilter = 'all' | 'available' | 'low' | 'out';

const PAYMENT_METHODS = [
  { id: 'cash', label: 'Наличные', Icon: BanknotesIcon },
  { id: 'card', label: 'Карта', Icon: CreditCardIcon },
  { id: 'mobile', label: 'Мобильный', Icon: DevicePhoneMobileIcon },
  { id: 'credit', label: 'В долг', Icon: DocumentTextIcon },
] as const;

const CARD_TYPES = [
  { id: 'alif', label: 'Alif' },
  { id: 'eskhata', label: 'Eskhata' },
  { id: 'dc', label: 'DC' },
] as const;

const CREDIT_INITIAL_PAYMENT_METHODS = PAYMENT_METHODS.filter(
  (method): method is Extract<(typeof PAYMENT_METHODS)[number], { id: CreditInitialPaymentMethod }> =>
    method.id !== 'credit',
);

// Soft per-category tint for the tile icon chip, keyed deterministically so a
// category always reads the same colour.
// One neutral chip. The old palette assigned eight hues by `category_id % 8`,
// which carries no meaning a cashier can use and breaks DESIGN.md's
// Two-Accent Rule on the very screen the rule was written for.
const tilePalette = ['bg-[var(--erp-surface)] text-[var(--erp-muted)]'];

const tileColor = (_id?: number | null) => tilePalette[0];

function POS() {
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<PosPaymentMethod>('cash');
  const [cardType, setCardType] = useState<'alif' | 'eskhata' | 'dc' | null>(null);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [quickCustomerName, setQuickCustomerName] = useState('');
  const [quickCustomerPhone, setQuickCustomerPhone] = useState('');
  const [quickCustomerDescription, setQuickCustomerDescription] = useState('');
  const [creatingCustomer, setCreatingCustomer] = useState(false);
  const [cashReceived, setCashReceived] = useState('');
  const [creditPaidAmount, setCreditPaidAmount] = useState('');
  const [creditPaymentMethod, setCreditPaymentMethod] = useState<CreditInitialPaymentMethod>('cash');
  const [loading, setLoading] = useState(false);
  const [totalEdit, setTotalEdit] = useState<string | null>(null);
  const [priceEdits, setPriceEdits] = useState<Record<string, string>>({});
  const [qtyEdits, setQtyEdits] = useState<Record<string, string>>({});
  // Editable line total → back-computes quantity (qty = total / unit price). Lets
  // the cashier weigh goods and just enter the money amount.
  const [lineTotalEdits, setLineTotalEdits] = useState<Record<string, string>>({});
  const [showCartSheet, setShowCartSheet] = useState(false);
  const { isServerReachable } = useServerHealth();
  const hasOpenShift = useHasOpenShift();
  const { data: currentShift, isSuccess: shiftStatusKnown } = useCurrentShift();
  const { user } = useAuthStore();
  const posModules = useModules();
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
  const [stockFilter, setStockFilter] = useState<PosStockFilter>('all');
  const [minPriceFilter, setMinPriceFilter] = useState('');
  const [maxPriceFilter, setMaxPriceFilter] = useState('');
  const [barcode, setBarcode] = useState('');
  const barcodeInputRef = useRef<HTMLInputElement>(null);
  // Guards a double-submit within one tick; the key survives a failed attempt
  // so a retry is the same sale to the server.
  const saleInFlight = useRef(false);
  const saleKeyRef = useRef<string | null>(null);

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

  const { data: creditCustomers = [] } = useQuery<Customer[]>({
    queryKey: ['customers', 'pos-credit'],
    queryFn: async () => {
      const response = await customersApi.getAll({ limit: 100 });
      return response.data;
    },
    enabled: showPaymentModal && paymentMethod === 'credit',
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
  const parseCatalogPrice = useCallback((value: string) => {
    const normalized = value.trim().replace(',', '.');
    if (!normalized) return null;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }, []);
  const stockFilterOptions = useMemo(() => {
    const getLeft = (product: Product) =>
      remainingStock(Number(product.stock_quantity), cartBaseByProduct.get(product.id) ?? 0);
    return [
      { key: 'all' as const, label: 'Все товары', count: products.length },
      {
        key: 'available' as const,
        label: 'В наличии',
        count: products.filter((product) =>
          nextAddQuantity(Number(product.stock_quantity), cartBaseByProduct.get(product.id) ?? 0) > 0,
        ).length,
      },
      {
        key: 'low' as const,
        label: 'Мало на складе',
        count: products.filter((product) => {
          const left = getLeft(product);
          return left > 0 && left <= Number(product.min_stock_level);
        }).length,
      },
      {
        key: 'out' as const,
        label: 'Нет в наличии',
        count: products.filter((product) =>
          nextAddQuantity(Number(product.stock_quantity), cartBaseByProduct.get(product.id) ?? 0) <= 0,
        ).length,
      },
    ];
  }, [cartBaseByProduct, products]);
  const visibleProducts = useMemo(() => {
    const minPrice = parseCatalogPrice(minPriceFilter);
    const maxPrice = parseCatalogPrice(maxPriceFilter);

    return products.filter((product) => {
      const price = Number(product.sell_price);
      const inCartBase = cartBaseByProduct.get(product.id) ?? 0;
      const left = remainingStock(Number(product.stock_quantity), inCartBase);
      const canAdd = nextAddQuantity(Number(product.stock_quantity), inCartBase) > 0;

      if (stockFilter === 'available' && !canAdd) return false;
      if (stockFilter === 'low' && !(left > 0 && left <= Number(product.min_stock_level))) return false;
      if (stockFilter === 'out' && canAdd) return false;
      if (minPrice !== null && price < minPrice) return false;
      if (maxPrice !== null && price > maxPrice) return false;

      return true;
    });
  }, [cartBaseByProduct, maxPriceFilter, minPriceFilter, parseCatalogPrice, products, stockFilter]);
  const activeCatalogFilterCount =
    (stockFilter !== 'all' ? 1 : 0) + (minPriceFilter.trim() ? 1 : 0) + (maxPriceFilter.trim() ? 1 : 0);
  const resetCatalogFilters = useCallback(() => {
    setStockFilter('all');
    setMinPriceFilter('');
    setMaxPriceFilter('');
  }, []);
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

  // One rule for the money, shared with the payload below: a line's price edit
  // is a per-unit adjustment, so it multiplies by quantity, and it reaches the
  // server as the unit price rather than as a separate discount. See
  // calculateCartTotals for what went wrong when it did not.
  const pricing = calculateCartTotals(
    items.map((item) => ({
      quantity: item.quantity,
      discount: item.discount,
      taxPercent: Number(item.product.tax_percent),
      unitPrice: Number(item.unit?.price ?? item.product.sell_price),
    })),
    overallDiscount,
  );
  const subtotal = pricing.subtotal;
  const tax = pricing.tax;
  const itemDiscounts = pricing.itemAdjustments;
  const finalTotal = pricing.finalTotal;
  const cashPayment = useMemo(
    () => calculateCashPayment(cashReceived, finalTotal),
    [cashReceived, finalTotal],
  );
  const creditInitialPayment = useMemo(
    () => calculateCreditInitialPayment(creditPaidAmount, finalTotal),
    [creditPaidAmount, finalTotal],
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
    setSelectedCustomer(null);
    setQuickCustomerName('');
    setQuickCustomerPhone('');
    setQuickCustomerDescription('');
    setCashReceived('');
    setCreditPaidAmount('');
    setCreditPaymentMethod('cash');
    setTotalEdit(null);
    setPriceEdits({});
    setQtyEdits({});
    setLineTotalEdits({});
    setLoading(false);
  }, [activeSessionId]);

  const handleAddToCart = useCallback(
    (product: Product) => {
      const inCartBase = cartBaseByProduct.get(product.id) ?? 0;
      const stock = Number(product.stock_quantity);
      const addQuantity = nextAddQuantity(stock, inCartBase);
      if (addQuantity <= 0) {
        const left = remainingStock(stock, inCartBase);
        toast.error(
          left > 0
            ? `«${product.name}»: доступно ещё ${left} ${product.uom}`
            : `«${product.name}» — нет в наличии. Пополните через «Закупки».`,
        );
        return;
      }
      addItem(product, undefined, addQuantity);
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
    setSelectedCustomer(null);
    setQuickCustomerName('');
    setQuickCustomerPhone('');
    setQuickCustomerDescription('');
    setCashReceived('');
    setCreditPaidAmount('');
    setCreditPaymentMethod('cash');
    setActiveOverallDiscount(0);
    setTotalEdit(null);
    setPriceEdits({});
    setQtyEdits({});
    setLineTotalEdits({});
  }, [clearCart, setActiveOverallDiscount]);

  const createQuickCustomer = useCallback(async () => {
    const name = quickCustomerName.trim();
    const phone = quickCustomerPhone.trim();
    const description = quickCustomerDescription.trim();

    if (!name || !phone) {
      toast.error('Укажите ФИО и телефон клиента');
      return;
    }

    setCreatingCustomer(true);
    try {
      const response = await customersApi.create({
        name,
        phone,
        ...(description ? { description } : {}),
      });
      setSelectedCustomer(response.data);
      setQuickCustomerName('');
      setQuickCustomerPhone('');
      setQuickCustomerDescription('');
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      toast.success('Клиент создан');
    } catch (error: any) {
      toast.error(error.response?.data?.detail || 'Не удалось создать клиента');
    } finally {
      setCreatingCustomer(false);
    }
  }, [quickCustomerName, quickCustomerPhone, quickCustomerDescription, queryClient]);

  const completeSale = useCallback(async () => {
    // `loading` is state, so two calls in the same tick both see `false` —
    // Enter can reach the pay button's onClick and the global hotkey in one
    // dispatch. A ref closes in the same tick; the idempotency key below makes
    // the server reject the second request even if one still slips through.
    if (saleInFlight.current) {
      return;
    }

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

    if (paymentMethod === 'credit' && !selectedCustomer) {
      toast.error('Выберите клиента для продажи в долг');
      return;
    }

    if (paymentMethod === 'credit' && !creditInitialPayment.isValid) {
      toast.error('Первый платеж не может быть больше суммы продажи');
      return;
    }

    saleInFlight.current = true;
    setLoading(true);

    const saleItems = items.map((item) => {
      const unitPrice = Number(item.unit?.price ?? item.product.sell_price);
      return {
        product_id: item.product.id,
        // null = base unit; quantity & unit_price are in the chosen unit.
        product_unit_id: item.unit?.id ?? null,
        quantity: item.quantity,
        // The line's price adjustment IS the unit price — discount and markup
        // alike. Sending it separately as discount_amount made the server net
        // it into the line total and, via the sale-level discount, subtract it
        // a second time when computing what a refund owes.
        unit_price: unitPrice - (item.discount || 0),
        tax_percent: Number(item.product.tax_percent),
        discount_amount: 0,
      };
    });
    const isCreditSale = paymentMethod === 'credit';
    const saleData: any = {
      items: saleItems,
      payment_method: paymentMethod,
      // Only the whole-sale discount: per-line adjustments already live in
      // unit_price, and counting them here charged them twice.
      discount_amount: Math.max(0, overallDiscount),
      ...(isCreditSale ? { customer_id: selectedCustomer!.id } : {}),
      ...(isCreditSale && creditInitialPayment.amount > 0
        ? {
            paid_amount: creditInitialPayment.amount,
            initial_payment_method: creditPaymentMethod,
          }
        : {}),
    };

    if (paymentMethod === 'card' && cardType) {
      saleData.card_type = cardType;
    }

    if (!isServerReachable) {
      toast.error('Нет связи с сервером. Проверьте подключение к интернету.');
      saleInFlight.current = false;
      setLoading(false);
      return;
    }

    // One key per checkout, not per request: a retry after a timeout must be
    // recognised by the server as the same sale, not booked a second time.
    if (!saleKeyRef.current) {
      saleKeyRef.current = generateIdempotencyKey();
    }

    try {
      const { data: sale } = await salesApi.create(saleData, saleKeyRef.current);
      saleKeyRef.current = null;
      toast.success('Продажа завершена');
      // Refresh stock counts so the catalog reflects what was just sold.
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      queryClient.invalidateQueries({ queryKey: ['sales'] });
      // Clear the register first so the next sale can start immediately, then
      // print on the next tick — window.print() is blocking and must not sit on
      // the checkout's critical path.
      resetCheckout();
      // Only print when the shop has opted in (Settings → «Печать чека»).
      // Otherwise no print window opens — no receipt, no "Save as PDF" prompt.
      // Read straight from the store so this callback's deps stay stable.
      if (useSettingsStore.getState().receiptPrintEnabled) {
        setTimeout(() => printReceipt(sale), 0);
      }
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
      } else if (error.response?.status === 409 && typeof detail === 'string' && detail.toLowerCase().includes('idempotency')) {
        // The cart changed after a failed attempt, so the held key no longer
        // describes this sale. Without clearing it every later attempt in this
        // tab failed identically, with an untranslated server string.
        saleKeyRef.current = null;
        toast.error('Корзина изменилась после сбоя. Нажмите «Оплатить» ещё раз.');
      } else if (error.response?.status === 409 && typeof detail === 'string' && detail.includes('Смена')) {
        // The shift was closed elsewhere between load and checkout. Refresh the
        // gate so the banner reappears instead of leaving a dead pay button.
        queryClient.invalidateQueries({ queryKey: ['currentShift'] });
        toast.error('Смена не открыта. Откройте смену, чтобы продолжить.');
      } else {
        toast.error(detail || 'Не удалось завершить продажу');
      }
    } finally {
      saleInFlight.current = false;
      setLoading(false);
    }
  }, [items, hasOverStock, paymentMethod, cardType, cashPayment.isSufficient, selectedCustomer, creditInitialPayment, creditPaymentMethod, isServerReachable, overallDiscount, resetCheckout, queryClient]);

  useEffect(() => {
    hotkeyManager.register({
      key: 'Enter',
      handler: () => {
        if (showPaymentModal) {
          completeSale();
        } else if (items.length > 0 && hasOpenShift && !hasOverStock) {
          // The pay button refuses without an open shift; the hotkey used to
          // walk straight past it and meet a 409 after the cash was taken.
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
  }, [showPaymentModal, items.length, hasOpenShift, hasOverStock, completeSale, openPaymentModal]);

  // Esc closes the payment modal.
  useEffect(() => {
    if (!showPaymentModal) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowPaymentModal(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [showPaymentModal]);

  // …and the mobile cart sheet, whose only other dismissal is a tap on the
  // scrim — unreachable from a keyboard or a scanner.
  useEffect(() => {
    if (!showCartSheet) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowCartSheet(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [showCartSheet]);

  // Both overlays declared role="dialog" and then left the cashier's focus
  // behind them: Tab walked straight out into the catalog tiles. On a register
  // PRODUCT.md calls keyboard- and scanner-first, that is the whole contract.
  const paymentPanelRef = useRef<HTMLDivElement>(null);
  const cartSheetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const panel = showPaymentModal
      ? paymentPanelRef.current
      : showCartSheet
        ? cartSheetRef.current
        : null;
    if (!panel) return;

    const opener = document.activeElement as HTMLElement | null;
    const focusables = () =>
      Array.from(
        panel.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])',
        ),
      );
    // The cash field first when there is one — it is what the cashier types next.
    const initial = panel.querySelector<HTMLElement>('input:not([disabled])') ?? focusables()[0];
    initial?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const items = focusables();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      opener?.focus?.();
    };
  }, [showCartSheet, showPaymentModal]);

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
              className={`flex h-11 shrink-0 items-center rounded-xl transition-colors ${
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
                  className={`mr-1 grid h-11 w-9 place-items-center rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--erp-accent)] ${isActive ? 'text-white/80 hover:bg-white/20' : 'text-[var(--erp-muted)] hover:bg-gray-200 dark:hover:bg-gray-600'}`}
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
          className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gray-900 text-white transition-colors hover:bg-gray-700 dark:bg-gray-600 dark:hover:bg-gray-500"
        >
          <PlusIcon className="h-5 w-5" />
        </button>
      </div>

      <div className="flex items-center gap-2 px-5 pb-2 pt-4">
        <h2 className="text-[18px] font-extrabold text-gray-900 dark:text-white">Чек</h2>
        <span className="ml-auto text-[13px] font-semibold text-[var(--erp-muted)]">{cartCount} товаров</span>
      </div>

      {/* Items */}
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 pb-2">
        {items.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <ShoppingBagIcon className="mb-3 h-16 w-16 text-gray-200 dark:text-gray-600" />
            <p className="text-sm font-medium text-gray-500 dark:text-gray-300">Корзина пуста</p>
            <p className="text-xs text-[var(--erp-muted)]">Нажмите на товар слева, чтобы добавить</p>
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
                    <p className="text-[12px] text-[var(--erp-muted)]">{formatCurrency(unitPrice)} / {unitLabel}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        const next = item.quantity - 1;
                        if (next <= 0) removeItem(key);
                        else updateQuantity(key, next);
                      }}
                      className="grid h-11 w-11 place-items-center rounded-xl bg-white text-lg font-bold text-gray-600 shadow-sm dark:bg-gray-800 dark:text-gray-200"
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
                      className="min-h-11 w-12 rounded-lg border border-transparent bg-transparent text-center text-sm font-extrabold text-gray-900 focus:bg-white focus:outline focus:outline-2 focus:outline-offset-1 focus:outline-[var(--erp-accent)] dark:text-white dark:focus:bg-gray-800"
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
                      className="grid h-11 w-11 place-items-center rounded-xl bg-blue-600 text-lg font-bold text-white transition-opacity disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-500 dark:disabled:bg-gray-600"
                    >
                      +
                    </button>
                  </div>
                </div>

                {showUnitPicker && (
                  <div className="mt-2 flex items-center gap-2">
                    <span className="text-[11px] text-[var(--erp-muted)]">Ед.</span>
                    <select
                      aria-label={`Единица измерения: ${item.product.name}`}
                      value={String(item.unit?.id ?? 'base')}
                      onChange={(e) => {
                        const next = units.find(
                          (u) => String(u.id ?? 'base') === e.target.value,
                        );
                        if (next) changeUnit(key, next);
                      }}
                      className="h-11 flex-1 rounded-lg border border-gray-200 bg-white px-2 text-[12px] font-semibold text-gray-700 focus:outline focus:outline-2 focus:outline-offset-1 focus:outline-[var(--erp-accent)] dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
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
                  <span className="text-[11px] text-[var(--erp-muted)]">Цена</span>
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
                    className={`min-h-11 w-24 rounded-lg border bg-white px-2 text-right text-[13px] font-bold focus:outline-none focus:ring-2 dark:bg-gray-800 ${
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
                    className="ml-auto min-h-11 w-24 rounded-lg border border-transparent bg-transparent px-1 text-right text-[14px] font-extrabold tabular-nums text-gray-900 focus:bg-white focus:outline focus:outline-2 focus:outline-offset-1 focus:outline-[var(--erp-accent)] dark:text-white dark:focus:bg-gray-800"
                  />
                  <button
                    type="button"
                    aria-label={`Удалить ${item.product.name}`}
                    onClick={() => removeItem(key)}
                    className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-[var(--erp-muted)] hover:bg-white hover:text-red-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--erp-accent)] dark:hover:bg-gray-800"
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
        <ShiftGateBanner />
        <div className="mb-1 flex justify-between text-[13px] text-gray-500"><span>Подытог</span><span className="tabular-nums">{formatCurrency(subtotal)}</span></div>
        <div className="mb-1 flex justify-between text-[13px] text-gray-500"><span>Налог</span><span className="tabular-nums">{formatCurrency(tax)}</span></div>
        <div className="mb-3 flex items-end justify-between">
          <span className="font-bold text-gray-900 dark:text-white">Итого</span>
          {/* Money-Is-Blue: the same number is Register Blue on the mobile bar;
              it must not be styled by a second law on the desktop panel. */}
          <span className="text-[30px] font-black leading-none tabular-nums text-[var(--erp-accent)]">{formatCurrency(finalTotal)}</span>
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
            onClick={() => items.length > 0 && !hasOverStock && hasOpenShift && openPaymentModal()}
            disabled={items.length === 0 || hasOverStock || !hasOpenShift}
            title={
              !hasOpenShift
                ? 'Откройте смену, чтобы продавать'
                : hasOverStock
                  ? 'Недостаточно товара на складе'
                  : undefined
            }
            // Flat confirm green, not a gradient: white on #22c55e is 2.28:1,
            // and 17px bold is below the large-text threshold, so AA needs 4.5.
            // #15803d gives 5.02:1 and reads under store glare.
            className="flex h-14 flex-1 items-center justify-center gap-2 rounded-2xl bg-[#15803d] text-[17px] font-extrabold text-white shadow-lg transition-colors hover:bg-[#166534] active:scale-[.99] disabled:cursor-not-allowed disabled:bg-gray-400 disabled:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--erp-accent)]"
          >
            Оплатить →
            <kbd className="hidden rounded bg-white/20 px-1.5 py-0.5 text-[11px] font-semibold lg:inline">Enter</kbd>
          </button>
        </div>
      </div>
    </div>
  );

  // A register-only company has no sales history and no customer base; the
  // bar must not offer links that 403.
  const posNavLinks = [
    { href: '/sales', label: 'История продаж', module: 'sales' as const },
    { href: '/shifts', label: 'Смена', module: 'register' as const },
    { href: '/customers', label: 'Клиенты', module: 'customers' as const },
  ].filter((link) => canAccessModule(posModules, link.module));

  const shiftPill = shiftStatusKnown && (
    currentShift ? (
      <span className="flex items-center gap-1.5 whitespace-nowrap text-[var(--erp-text)]">
        <span className="h-[7px] w-[7px] shrink-0 rounded-full bg-[var(--erp-success)]" />
        Смена открыта
      </span>
    ) : (
      <span className="flex items-center gap-1.5 whitespace-nowrap text-[var(--erp-warn)]">
        <span className="h-[7px] w-[7px] shrink-0 rounded-full bg-[var(--erp-warn)]" />
        Смена закрыта
      </span>
    )
  );

  return (
    <div className="flex h-dvh flex-col bg-[var(--erp-surface)]">
      {/* POS top bar — the POS module renders its own fullscreen chrome instead
          of the shared workspace shell (header/rail/sidebar are hidden for
          /pos in the (protected) layout, on desktop and mobile alike). The
          shift pill and the Приложения exit stay on screen at every width:
          they are how a cashier knows a sale is possible, and how they leave. */}
      <div className="flex-none border-b-2 border-[var(--erp-divider)] bg-white pt-safe">
        <div className="flex min-h-[52px] items-center gap-2 px-2 sm:gap-4 sm:px-4">
          <Link
            href="/apps"
            prefetch={false}
            aria-label="Приложения"
            className="-ml-1 flex h-11 w-11 items-center justify-center text-[var(--erp-text)] hover:bg-[var(--erp-surface)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--erp-accent)] sm:hidden"
          >
            <Squares2X2Icon className="h-5 w-5" />
          </Link>
          <div className="text-[17px] font-extrabold text-[var(--erp-text)]">Касса</div>
          <div className="hidden gap-0.5 sm:flex">
            {posNavLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                prefetch={false}
                className="px-3 py-1.5 text-sm font-medium text-[var(--erp-muted)] hover:bg-[var(--erp-surface)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--erp-accent)]"
              >
                {link.label}
              </Link>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-3 text-[13px] sm:gap-3.5 sm:text-sm">
            {shiftPill}
            <span className="hidden text-[var(--erp-muted)] sm:inline">
              {user?.full_name || user?.username}
            </span>
            <Link
              href="/apps"
              prefetch={false}
              className="hidden h-[34px] items-center gap-2 border border-[var(--erp-divider)] px-3 font-medium text-[var(--erp-text)] hover:bg-[var(--erp-surface)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--erp-accent)] sm:flex"
            >
              <Squares2X2Icon className="h-[14px] w-[14px]" />
              Приложения
            </Link>
          </div>
        </div>
        {/* Mobile: the module's other pages, which have no tab bar here. */}
        <div className="flex gap-0.5 overflow-x-auto border-t border-[var(--erp-divider)] px-1 scrollbar-hide sm:hidden">
          {posNavLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              prefetch={false}
              className="flex min-h-[44px] shrink-0 items-center whitespace-nowrap px-3 text-sm font-medium text-[var(--erp-muted)] hover:bg-[var(--erp-surface)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--erp-accent)]"
            >
              {link.label}
            </Link>
          ))}
        </div>
      </div>

      {/* pb clears the fixed mobile cart bar so the last catalog row is reachable. */}
      <div className="flex min-h-0 flex-1 gap-4 p-4 pb-[132px] md:pb-4">
        {/* Catalog */}
        <main className="flex min-w-0 flex-1 flex-col">
          {/* Search + barcode */}
          <div className="mb-3 flex flex-wrap items-center gap-2 sm:flex-nowrap">
            <div className="relative min-w-[220px] flex-1">
              <MagnifyingGlassIcon className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-[var(--erp-muted)]" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Поиск товара…"
                className="h-11 w-full rounded-2xl border border-gray-200 bg-white pl-10 pr-3 text-sm shadow-sm outline-none focus:outline focus:outline-2 focus:outline-offset-1 focus:outline-[var(--erp-accent)] focus:border-[var(--erp-accent)] dark:border-gray-600 dark:bg-gray-800"
              />
            </div>
            <form onSubmit={handleBarcodeSubmit} className="relative w-40 sm:w-52">
              <QrCodeIcon className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-[var(--erp-muted)]" />
              <input
                ref={barcodeInputRef}
                type="text"
                value={barcode}
                onChange={(e) => setBarcode(e.target.value)}
                placeholder="Штрихкод"
                className="h-11 w-full rounded-2xl border border-gray-200 bg-white pl-10 pr-3 font-mono text-sm shadow-sm outline-none focus:outline focus:outline-2 focus:outline-offset-1 focus:outline-[var(--erp-accent)] focus:border-[var(--erp-accent)] dark:border-gray-600 dark:bg-gray-800"
              />
            </form>
            <FilterMenu activeCount={activeCatalogFilterCount} onReset={resetCatalogFilters}>
              <div className="space-y-4">
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--erp-muted)]">
                    Наличие
                  </p>
                  <div className="grid gap-1 rounded-xl bg-gray-100 p-1 dark:bg-gray-900">
                    {stockFilterOptions.map((option) => (
                      <button
                        key={option.key}
                        type="button"
                        aria-label={option.label}
                        data-filter-close
                        onClick={() => setStockFilter(option.key)}
                        className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                          stockFilter === option.key
                            ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-white'
                            : 'text-gray-500 hover:text-gray-700 dark:text-gray-400'
                        }`}
                      >
                        <span>{option.label}</span>
                        <span aria-hidden="true" className="text-xs tabular-nums text-[var(--erp-muted)]">
                          {option.count}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <label className="block">
                    <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-[var(--erp-muted)]">
                      Цена от
                    </span>
                    <input
                      type="text"
                      inputMode="decimal"
                      aria-label="Цена от"
                      value={minPriceFilter}
                      onChange={(event) => setMinPriceFilter(event.target.value)}
                      className="h-10 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm outline-none focus:outline focus:outline-2 focus:outline-offset-1 focus:outline-[var(--erp-accent)] focus:border-[var(--erp-accent)] dark:border-gray-600 dark:bg-gray-900"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-[var(--erp-muted)]">
                      Цена до
                    </span>
                    <input
                      type="text"
                      inputMode="decimal"
                      aria-label="Цена до"
                      value={maxPriceFilter}
                      onChange={(event) => setMaxPriceFilter(event.target.value)}
                      className="h-10 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm outline-none focus:outline focus:outline-2 focus:outline-offset-1 focus:outline-[var(--erp-accent)] focus:border-[var(--erp-accent)] dark:border-gray-600 dark:bg-gray-900"
                    />
                  </label>
                </div>

                <p className="text-xs tabular-nums text-[var(--erp-muted)]">
                  Показано: {visibleProducts.length} из {products.length}
                </p>
              </div>
            </FilterMenu>
          </div>

          {/* Category chips */}
          <div className="-mx-1 mb-3 flex gap-2 overflow-x-auto whitespace-nowrap px-1">
            <button
              type="button"
              onClick={() => setSelectedCategory(null)}
              className={`h-11 shrink-0 rounded-xl px-4 text-[13px] font-bold transition-colors ${
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
                className={`h-11 shrink-0 rounded-xl px-4 text-[13px] font-bold transition-colors ${
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
                    <div key={i} className="h-36 animate-pulse rounded-xl border border-gray-100 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
                      <div className="mb-3 h-10 w-10 rounded-2xl bg-gray-200 dark:bg-gray-700" />
                      <div className="mb-2 h-3 w-3/4 rounded bg-gray-200 dark:bg-gray-700" />
                      <div className="h-3 w-1/2 rounded bg-gray-200 dark:bg-gray-700" />
                    </div>
                  ))
                : visibleProducts.map((product) => {
                    const stock = Number(product.stock_quantity);
                    const inCartBase = cartBaseByProduct.get(product.id) ?? 0;
                    const left = remainingStock(stock, inCartBase);
                    const out = stock <= 0;
                    const cannotAdd = nextAddQuantity(stock, inCartBase) <= 0;
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
                        className={`group relative flex h-36 flex-col overflow-hidden rounded-xl border border-gray-100 bg-white p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-sm active:scale-95 dark:border-gray-700 dark:bg-gray-800 ${
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
                          <p className="truncate text-[11px] font-semibold text-[var(--erp-muted)]">{product.category.name}</p>
                        )}
                        <div className="mt-1 text-[16px] font-extrabold tabular-nums text-gray-900 dark:text-white">
                          {formatCurrency(product.sell_price)}
                        </div>
                      </button>
                    );
                  })}
            </div>
            {/* The products query is gated on server health, so an unreachable
                API arrives here as an empty list — a cashier would rescan and
                blame the barcode. Name the real cause. */}
            {!productsLoading && visibleProducts.length === 0 && (
              isServerReachable ? (
                <div className="py-16 text-center text-sm text-[var(--erp-muted)]">Товары не найдены</div>
              ) : (
                <div role="alert" className="py-16 text-center">
                  <p className="text-sm font-bold text-[var(--erp-warn)]">Нет связи с сервером</p>
                  <p className="mt-1 text-sm text-[var(--erp-muted)]">
                    Товары недоступны. Проверьте подключение к интернету.
                  </p>
                </div>
              )
            )}
          </div>
        </main>

        {/* Resize handle (desktop only) */}
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Изменить ширину корзины"
          onPointerDown={handleResizeStart}
          className="group hidden w-2 shrink-0 cursor-col-resize items-center justify-center md:flex"
        >
          <div className="h-12 w-1 rounded-full bg-gray-300 transition-colors group-hover:bg-blue-400 dark:bg-gray-600 dark:group-hover:bg-blue-500" />
        </div>

        {/* Cart — desktop aside */}
        <aside
          style={{ width: cartPanelWidth }}
          className="hidden shrink-0 overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-xl dark:border-gray-700 dark:bg-gray-800 md:block"
        >
          {cartPanel}
        </aside>
      </div>

      {/* Mobile cart bar — restyled to the ERP design language (sharp corners).
          The total is Register Blue and the heaviest thing in its context; the
          action beneath it is Confirm Green. They no longer share one hue and
          compete. pb-safe keeps Оплатить out of the iOS home-indicator strip.
          Still opens the cart sheet on tap, same as before; the sheet's own
          Оплатить button drives the payment modal. */}
      <div
        className="fixed inset-x-0 bottom-0 z-30 border-t-2 border-[var(--erp-divider)] bg-white p-3 md:hidden"
        style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom, 0px))' }}
      >
        <button
          type="button"
          onClick={() => setShowCartSheet(true)}
          aria-label="Открыть корзину"
          className="flex w-full flex-col gap-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--erp-accent)]"
        >
          <span className="flex items-baseline justify-between gap-3">
            <span className="text-[13px] font-semibold text-[var(--erp-muted)]">{cartCount} товаров</span>
            <span className="text-[30px] font-black leading-none tabular-nums text-[var(--erp-accent)]">
              {formatCurrency(finalTotal)}
            </span>
          </span>
          <span className="flex h-[48px] w-full items-center justify-center gap-2 bg-[var(--erp-success)] text-[15px] font-extrabold text-white">
            <ShoppingBagIcon className="h-4 w-4" />
            Оплатить
          </span>
        </button>
      </div>

      {/* Mobile cart sheet */}
      {showCartSheet && (
        <div className="fixed inset-0 z-40 flex flex-col justify-end md:hidden">
          <div
            className="absolute inset-0 touch-none bg-black/50 backdrop-blur-sm"
            aria-hidden="true"
            onClick={() => setShowCartSheet(false)}
          />
          {/* A definite height, not max-height: cartPanel is `h-full flex-col`
              with an `overflow-y-auto` item list, and `h-full` against an
              auto-height parent resolves to nothing — past ~4 lines the total
              and Оплатить were clipped with no way to scroll to them. */}
          <div
            ref={cartSheetRef}
            role="dialog"
            aria-modal="true"
            aria-label="Корзина"
            className="relative flex h-[88dvh] flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl dark:bg-gray-800"
          >
            {cartPanel}
          </div>
        </div>
      )}

      {/* Payment modal */}
      {showPaymentModal && (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
          <div
            className="absolute inset-0 touch-none bg-gray-900/60 backdrop-blur-sm"
            aria-hidden="true"
            onClick={() => setShowPaymentModal(false)}
          />
          <div
            ref={paymentPanelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="payment-modal-title"
            className="relative max-h-[90dvh] w-full overflow-y-auto rounded-t-3xl bg-white p-4 shadow-2xl dark:bg-gray-800 sm:max-w-lg sm:rounded-xl sm:p-6"
          >
            <div className="mb-4 flex items-center justify-between sm:mb-6">
              <h2 id="payment-modal-title" className="text-lg font-bold text-gray-900 dark:text-white sm:text-2xl">Оплата</h2>
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
                <div className="mt-1 flex items-center justify-between text-sm text-[var(--erp-success)]"><span>Скидки на товары</span><span className="tabular-nums">-{formatCurrency(itemDiscounts)}</span></div>
              )}
              {itemDiscounts < 0 && (
                <div className="mt-1 flex items-center justify-between text-sm text-blue-600"><span>Наценки на товары</span><span className="tabular-nums">+{formatCurrency(Math.abs(itemDiscounts))}</span></div>
              )}
              {overallDiscount > 0 && (
                <div className="mt-1 flex items-center justify-between text-sm text-[var(--erp-success)]"><span>Общая скидка</span><span className="tabular-nums">-{formatCurrency(overallDiscount)}</span></div>
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

            <div className="mb-4 grid grid-cols-2 gap-2 sm:mb-6 sm:grid-cols-4 sm:gap-4">
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
                      if (id !== 'credit') {
                        setSelectedCustomer(null);
                        setCreditPaidAmount('');
                        setCreditPaymentMethod('cash');
                      }
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
                  className="h-12 w-full rounded-xl border border-gray-300 bg-white px-4 text-right text-xl font-extrabold tabular-nums text-gray-900 outline-none transition focus:outline focus:outline-2 focus:outline-offset-1 focus:outline-[var(--erp-accent)] dark:border-gray-600 dark:bg-gray-900 dark:text-white dark:focus:ring-blue-900/40"
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

            {paymentMethod === 'credit' && (
              <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50/60 p-4 dark:border-amber-900/40 dark:bg-amber-900/10 sm:mb-6">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-bold text-gray-900 dark:text-white">Клиент для продажи в долг</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">Выберите существующего клиента или создайте нового.</p>
                  </div>
                  {selectedCustomer && (
                    <span className="rounded-full bg-white px-2 py-1 text-xs font-bold text-amber-700 shadow-sm dark:bg-gray-800">
                      {selectedCustomer.name}
                    </span>
                  )}
                </div>

                {creditCustomers.length > 0 && (
                  <div className="mb-3 grid max-h-28 gap-2 overflow-y-auto">
                    {creditCustomers.map((customer) => {
                      const selected = selectedCustomer?.id === customer.id;
                      return (
                        <button
                          key={customer.id}
                          type="button"
                          onClick={() => setSelectedCustomer(customer)}
                          className={`rounded-xl border px-3 py-2 text-left text-sm transition-colors ${
                            selected
                              ? 'border-amber-500 bg-white text-amber-800 shadow-sm dark:bg-gray-800'
                              : 'border-amber-100 bg-white/70 text-gray-700 hover:border-amber-300 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200'
                          }`}
                        >
                          <span className="font-semibold">{customer.name}</span>
                          {customer.phone && <span className="ml-2 text-xs text-gray-500">{customer.phone}</span>}
                          {Number(customer.balance || 0) > 0 && (
                            <span className="float-right text-xs font-bold text-red-600">{formatCurrency(customer.balance || '0')}</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}

                <div className="grid gap-2 sm:grid-cols-2">
                  <label className="text-xs font-medium text-gray-600 dark:text-gray-300">
                    ФИО клиента
                    <input
                      type="text"
                      value={quickCustomerName}
                      onChange={(event) => setQuickCustomerName(event.target.value)}
                      className="mt-1 h-10 w-full rounded-xl border border-amber-200 bg-white px-3 text-sm outline-none focus:outline focus:outline-2 focus:outline-offset-1 focus:outline-[var(--erp-accent)] dark:border-gray-600 dark:bg-gray-900"
                    />
                  </label>
                  <label className="text-xs font-medium text-gray-600 dark:text-gray-300">
                    Телефон клиента
                    <input
                      type="text"
                      value={quickCustomerPhone}
                      onChange={(event) => setQuickCustomerPhone(event.target.value)}
                      className="mt-1 h-10 w-full rounded-xl border border-amber-200 bg-white px-3 text-sm outline-none focus:outline focus:outline-2 focus:outline-offset-1 focus:outline-[var(--erp-accent)] dark:border-gray-600 dark:bg-gray-900"
                    />
                  </label>
                  <label className="text-xs font-medium text-gray-600 dark:text-gray-300 sm:col-span-2">
                    Описание клиента
                    <input
                      type="text"
                      value={quickCustomerDescription}
                      onChange={(event) => setQuickCustomerDescription(event.target.value)}
                      className="mt-1 h-10 w-full rounded-xl border border-amber-200 bg-white px-3 text-sm outline-none focus:outline focus:outline-2 focus:outline-offset-1 focus:outline-[var(--erp-accent)] dark:border-gray-600 dark:bg-gray-900"
                    />
                  </label>
                </div>
                <button
                  type="button"
                  onClick={createQuickCustomer}
                  disabled={creatingCustomer}
                  className="mt-3 w-full rounded-xl bg-amber-500 px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-amber-600 disabled:cursor-not-allowed disabled:bg-gray-400"
                >
                  {creatingCustomer ? 'Создание...' : 'Создать клиента'}
                </button>

                <div className="mt-4 border-t border-amber-200 pt-4 dark:border-amber-900/40">
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-300">
                    Оплачено сейчас
                    <input
                      type="text"
                      inputMode="decimal"
                      value={creditPaidAmount}
                      onChange={(event) => setCreditPaidAmount(event.target.value)}
                      className={`mt-1 h-11 w-full rounded-xl border bg-white px-3 text-right text-lg font-extrabold tabular-nums text-gray-900 outline-none transition focus:ring-2 dark:bg-gray-950 dark:text-white ${
                        creditInitialPayment.exceedsTotal
                          ? 'border-red-300 focus:border-red-500 focus:ring-red-100 dark:border-red-700 dark:focus:ring-red-900/30'
                          : 'border-amber-200 focus:border-amber-500 focus:ring-amber-100 dark:border-gray-700 dark:focus:ring-amber-900/30'
                      }`}
                    />
                  </label>

                  <div className="mt-3">
                    <p className="mb-2 text-xs font-medium text-gray-600 dark:text-gray-300">Способ первого платежа</p>
                    <div className="grid grid-cols-3 gap-2">
                      {CREDIT_INITIAL_PAYMENT_METHODS.map(({ id, label, Icon }) => {
                        const selected = creditPaymentMethod === id;
                        return (
                          <button
                            key={id}
                            type="button"
                            aria-label={`Первый платеж: ${label}`}
                            aria-pressed={selected}
                            onClick={() => setCreditPaymentMethod(id)}
                            className={`relative flex min-h-[42px] items-center justify-center gap-1.5 rounded-xl border px-2 text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2 ${
                              selected
                                ? 'border-amber-500 bg-amber-50 text-amber-800 dark:bg-amber-900/30 dark:text-amber-100'
                                : 'border-gray-200 text-gray-600 hover:border-amber-300 dark:border-gray-700 dark:text-gray-300'
                            }`}
                          >
                            <Icon className="h-4 w-4" />
                            <span>{label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div
                    className={`mt-3 flex items-center justify-between rounded-xl px-3 py-2 text-sm font-bold ${
                      creditInitialPayment.exceedsTotal
                        ? 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300'
                        : 'bg-amber-50 text-amber-800 dark:bg-amber-900/20 dark:text-amber-200'
                    }`}
                  >
                    <span>Останется долг</span>
                    <span className="text-lg tabular-nums">{formatCurrency(creditInitialPayment.remaining)}</span>
                  </div>
                  {creditInitialPayment.exceedsTotal && (
                    <p className="mt-2 text-xs font-medium text-red-600 dark:text-red-300">
                      Первый платеж не может быть больше суммы продажи
                    </p>
                  )}
                </div>
              </div>
            )}

            <button
              onClick={completeSale}
              disabled={loading || hasOverStock || (paymentMethod === 'cash' && !cashPayment.isSufficient) || (paymentMethod === 'credit' && (!selectedCustomer || !creditInitialPayment.isValid))}
              className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-[#15803d] py-3 text-base font-bold text-white transition-colors hover:bg-[#166534] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-gray-400 sm:py-4 sm:text-xl"
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
  );
}

export default function POSPage() {
  return (
    <ModuleGuard module="register">
      <POS />
    </ModuleGuard>
  );
}
