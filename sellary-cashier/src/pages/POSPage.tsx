import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  getProducts, getCategories, getProductByBarcode, insertSale,
  getCustomersWithLocalBalance, insertCustomer,
} from '../lib/db';
import type { LocalProduct, LocalCategory, CustomerWithBalance } from '../lib/db';
import { useAuthStore } from '../lib/auth-store';
import { useSyncStore } from '../lib/sync-store';
import { requestSync } from '../lib/sync-engine';
import { useCartStore } from '../lib/cart-store';
import { cartLineKey } from '../lib/posUnits';
import { isOverStock } from '../lib/posStock';
import { calculatePosPricing } from '../lib/posPricing';
import {
  buildNewSaleInput, newSaleIds,
  type CashierCardType, type CashierPaymentMethod, type CashierCreditPaymentMethod,
} from '../lib/pos-payload';
import { evaluateLogout } from '../lib/logout-guard';
import { SearchBar } from './pos/SearchBar';
import { CategoryChips } from './pos/CategoryChips';
import { ProductGrid } from './pos/ProductGrid';
import { CartPanel } from './pos/CartPanel';
import { PaymentModal } from './pos/PaymentModal';

const STALE_CATALOG_DAYS = 3;

export function POSPage() {
  const navigate = useNavigate();
  const { logout, username, companyName, userId } = useAuthStore();
  const {
    online, unsyncedCount, needsAttentionCount, catalogRefreshedAt, syncNow,
  } = useSyncStore();

  const {
    items, addItem, updateQuantity, removeItem, setDiscount, clearCart, getSubtotal, getTax,
  } = useCartStore();

  const [products, setProducts] = useState<LocalProduct[]>([]);
  const [categories, setCategories] = useState<LocalCategory[]>([]);
  const [loadingCatalog, setLoadingCatalog] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<number | null>(null);
  const [barcode, setBarcode] = useState('');
  const [showPayment, setShowPayment] = useState(false);
  const [method, setMethod] = useState<CashierPaymentMethod>('cash');
  const [cardType, setCardType] = useState<CashierCardType | null>(null);
  const [cashReceived, setCashReceived] = useState('');
  const [creditCustomers, setCreditCustomers] = useState<CustomerWithBalance[]>([]);
  const [customerSearch, setCustomerSearch] = useState('');
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [qcName, setQcName] = useState('');
  const [qcPhone, setQcPhone] = useState('');
  const [qcDescription, setQcDescription] = useState('');
  const [creatingCustomer, setCreatingCustomer] = useState(false);
  const [creditPaidAmount, setCreditPaidAmount] = useState('');
  const [creditPaymentMethod, setCreditPaymentMethod] = useState<CashierCreditPaymentMethod>('cash');
  const [loading, setLoading] = useState(false);
  const [priceEdits, setPriceEdits] = useState<Record<string, string>>({});
  const [confirmLogout, setConfirmLogout] = useState<string | null>(null);
  const barcodeRef = useRef<HTMLInputElement>(null);

  const reloadProducts = useCallback(async () => {
    const list = await getProducts();
    setProducts(list);
  }, []);

  const reloadCustomers = useCallback(async () => {
    const list = await getCustomersWithLocalBalance();
    setCreditCustomers(list);
  }, []);

  useEffect(() => {
    if (showPayment && method === 'credit') void reloadCustomers();
  }, [showPayment, method, reloadCustomers]);

  const handleCreateCustomer = useCallback(async () => {
    const name = qcName.trim();
    const phone = qcPhone.trim();
    if (!name || !phone) {
      toast.error('Укажите ФИО и телефон клиента');
      return;
    }
    setCreatingCustomer(true);
    try {
      const { clientCustomerId } = await insertCustomer({
        name,
        phone,
        description: qcDescription.trim() || null,
      });
      setQcName('');
      setQcPhone('');
      setQcDescription('');
      await reloadCustomers();
      setSelectedCustomerId(clientCustomerId);
      toast.success('Клиент создан');
    } catch (err) {
      toast.error('Не удалось создать клиента');
      console.error('insertCustomer failed', err);
    } finally {
      setCreatingCustomer(false);
    }
  }, [qcName, qcPhone, qcDescription, reloadCustomers]);

  useEffect(() => {
    (async () => {
      try {
        const [p, c] = await Promise.all([getProducts(), getCategories()]);
        setProducts(p);
        setCategories(c);
      } finally {
        setLoadingCatalog(false);
      }
    })();
  }, []);

  // Base-unit demand per product across all cart lines (units share stock).
  const cartBaseByProduct = useMemo(() => {
    const map = new Map<number, number>();
    for (const line of items) {
      const base = line.quantity * (line.unit.factor ?? 1);
      map.set(line.product.id, (map.get(line.product.id) ?? 0) + base);
    }
    return map;
  }, [items]);

  const visibleProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((p) => {
      if (selectedCategory !== null && p.category_id !== selectedCategory) return false;
      if (q && !(p.name.toLowerCase().includes(q) || (p.barcode ?? '').toLowerCase().includes(q))) {
        return false;
      }
      return true;
    });
  }, [products, search, selectedCategory]);

  const subtotal = getSubtotal();
  const tax = getTax();
  const itemDiscounts = items.reduce((sum, line) => sum + Math.max(0, line.discount || 0), 0);
  const { finalTotal } = calculatePosPricing({ subtotal, tax, itemDiscounts, overallDiscount: 0 });

  const oversoldKeys = useMemo(() => {
    const set = new Set<string>();
    for (const line of items) {
      const base = cartBaseByProduct.get(line.product.id) ?? 0;
      if (isOverStock(Number(line.product.stock_quantity), base)) {
        set.add(cartLineKey(line.product.id, line.unit.id));
      }
    }
    return set;
  }, [items, cartBaseByProduct]);

  // `catalogRefreshedAt` comes from sync-store, which sync-engine's init hydrates
  // from meta('last_catalog_pull_at') — so this is accurate after a cold start too.
  const staleDays = useMemo(() => {
    if (!catalogRefreshedAt) return null;
    const days = Math.floor((Date.now() - new Date(catalogRefreshedAt).getTime()) / 86400000);
    return days > STALE_CATALOG_DAYS ? days : null;
  }, [catalogRefreshedAt]);

  const handleAdd = useCallback((product: LocalProduct) => {
    addItem(product, undefined, 1);
  }, [addItem]);

  const handleBarcodeSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    const code = barcode.trim();
    if (!code) return;
    const product = await getProductByBarcode(code);
    if (product) {
      handleAdd(product);
      setBarcode('');
    } else {
      toast.error('Товар не найден');
    }
    barcodeRef.current?.focus();
  }, [barcode, handleAdd]);

  const onPriceEditChange = useCallback((key: string, value: string) => {
    setPriceEdits((prev) => ({ ...prev, [key]: value }));
  }, []);
  const onPriceEditCommit = useCallback((key: string, discount: number) => {
    setDiscount(key, discount);
    setPriceEdits((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, [setDiscount]);

  const openPayment = useCallback(() => {
    if (items.length === 0) return;
    setCashReceived(String(Math.ceil(finalTotal)));
    setMethod('cash');
    setCardType(null);
    setSelectedCustomerId(null);
    setCustomerSearch('');
    setCreditPaidAmount('');
    setCreditPaymentMethod('cash');
    setQcName('');
    setQcPhone('');
    setQcDescription('');
    setShowPayment(true);
  }, [items.length, finalTotal]);

  // Optimistic completion (§7.3): all local & synchronous, then non-awaited sync.
  const handleComplete = useCallback(async () => {
    if (items.length === 0 || loading) return;
    setLoading(true);
    const { clientSaleId, idempotencyKey } = newSaleIds();
    if (method === 'credit' && !selectedCustomerId) {
      setLoading(false);
      toast.error('Выберите клиента для продажи в долг');
      return;
    }
    const input = buildNewSaleInput({
      items,
      paymentMethod: method,
      cardType,
      cashReceived,
      cashier: { userId, username },
      nowIso: new Date().toISOString(),
      clientSaleId,
      idempotencyKey,
      customerClientId: selectedCustomerId,
      creditPaidAmount,
      creditPaymentMethod,
    });
    const oversold = oversoldKeys.size > 0;
    try {
      await insertSale(input);        // atomic local row + base-unit stock decrement
      clearCart();
      setShowPayment(false);
      setCashReceived('');
      setPriceEdits({});
      setLoading(false);
      toast.success('Продажа завершена');
      if (oversold) toast('Продажа с перерасходом склада', { icon: '⚠️' });
      barcodeRef.current?.focus();
      void reloadProducts();          // show decremented stock immediately
      if (method === 'credit') void reloadCustomers();
      void requestSync('post-sale');  // fire-and-forget — never awaited on the pay path
    } catch (err) {
      setLoading(false);
      toast.error('Не удалось сохранить продажу');
      console.error('insertSale failed', err);
    }
  }, [items, loading, method, cardType, cashReceived, userId, username, oversoldKeys, clearCart, reloadProducts, selectedCustomerId, creditPaidAmount, creditPaymentMethod, reloadCustomers]);

  // Keyboard: F2 → barcode; Enter → open/confirm; Esc → close.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F2') { e.preventDefault(); barcodeRef.current?.focus(); return; }
      if (e.key === 'Escape') { if (showPayment) setShowPayment(false); return; }
      if (e.key === 'Enter') {
        const target = e.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
        if (showPayment) handleComplete();
        else if (items.length > 0) openPayment();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showPayment, items.length, handleComplete, openPayment]);

  const handleLogout = useCallback(async () => {
    const decision = evaluateLogout(unsyncedCount, needsAttentionCount);
    if (decision.action === 'blocked') {
      toast.error(decision.message);
      void syncNow();
      return;
    }
    if (decision.action === 'confirm') {
      setConfirmLogout(decision.message);
      return;
    }
    await logout();
    navigate('/login', { replace: true });
  }, [unsyncedCount, needsAttentionCount, syncNow, logout, navigate]);

  const doLogout = useCallback(async () => {
    setConfirmLogout(null);
    await logout();
    navigate('/login', { replace: true });
  }, [logout, navigate]);

  return (
    <div className="flex h-screen flex-col bg-gray-50 dark:bg-gray-900">
      <header className="flex shrink-0 items-center justify-between border-b border-gray-100 bg-white px-4 py-2 dark:border-gray-700 dark:bg-gray-800">
        <div>
          <h1 className="text-sm font-bold text-gray-900 dark:text-white">{companyName || 'Sellary Kassa'}</h1>
          <p className="text-xs text-gray-400">{username}</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className={`inline-block h-2 w-2 rounded-full ${online ? 'bg-green-500' : 'bg-red-500'}`} />
            <span className="text-xs text-gray-500">{online ? 'Online' : 'Offline'}</span>
          </div>
          {unsyncedCount > 0 && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
              Не отправлено: {unsyncedCount}
            </span>
          )}
          {staleDays !== null && (
            <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-600 dark:bg-amber-900/20 dark:text-amber-400">
              Каталог обновлён {staleDays} дн. назад
            </span>
          )}
          <button onClick={() => syncNow()} className="text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">
            Синхронизация
          </button>
          <button onClick={() => navigate('/customers')} className="text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">
            Клиенты
          </button>
          <button onClick={() => navigate('/history')} className="text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">
            История
          </button>
          <button onClick={() => navigate('/settings')} className="text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">
            Настройки
          </button>
          <button onClick={handleLogout} className="text-xs font-medium text-red-500 hover:text-red-600">
            Выход
          </button>
        </div>
      </header>

      {!online && (
        <div className="bg-amber-50 px-4 py-1.5 text-center text-sm text-amber-700 dark:bg-amber-900/20 dark:text-amber-300">
          Оффлайн — продажи сохраняются локально
        </div>
      )}

      <div className="flex min-h-0 flex-1 gap-4 p-4">
        <main className="flex min-w-0 flex-1 flex-col">
          <SearchBar
            search={search}
            onSearch={setSearch}
            barcode={barcode}
            onBarcode={setBarcode}
            onBarcodeSubmit={handleBarcodeSubmit}
            barcodeRef={barcodeRef}
          />
          <CategoryChips categories={categories} selected={selectedCategory} onSelect={setSelectedCategory} />
          <div className="min-h-0 flex-1 overflow-y-auto">
            <ProductGrid
              products={visibleProducts}
              loading={loadingCatalog}
              cartBaseByProduct={cartBaseByProduct}
              onAdd={handleAdd}
            />
          </div>
        </main>

        <aside className="hidden w-[420px] shrink-0 overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-xl dark:border-gray-700 dark:bg-gray-800 lg:block">
          <CartPanel
            items={items}
            subtotal={subtotal}
            tax={tax}
            finalTotal={finalTotal}
            oversoldKeys={oversoldKeys}
            priceEdits={priceEdits}
            onPriceEditChange={onPriceEditChange}
            onPriceEditCommit={onPriceEditCommit}
            onQuantity={updateQuantity}
            onRemove={removeItem}
            onPay={openPayment}
          />
        </aside>
      </div>

      <PaymentModal
        open={showPayment}
        total={finalTotal}
        method={method}
        onMethod={setMethod}
        cardType={cardType}
        onCardType={setCardType}
        cashReceived={cashReceived}
        onCashReceived={setCashReceived}
        loading={loading}
        onConfirm={handleComplete}
        onClose={() => setShowPayment(false)}
        credit={{
          customers: creditCustomers,
          search: customerSearch,
          onSearch: setCustomerSearch,
          selectedCustomerId,
          onSelect: setSelectedCustomerId,
          qcName,
          onQcName: setQcName,
          qcPhone,
          onQcPhone: setQcPhone,
          qcDescription,
          onQcDescription: setQcDescription,
          creatingCustomer,
          onCreateCustomer: handleCreateCustomer,
          paidAmount: creditPaidAmount,
          onPaidAmount: setCreditPaidAmount,
          paymentMethod: creditPaymentMethod,
          onPaymentMethod: setCreditPaymentMethod,
        }}
      />

      {confirmLogout && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setConfirmLogout(null)} />
          <div className="relative w-full max-w-sm rounded-3xl bg-white p-6 shadow-2xl dark:bg-gray-800">
            <p className="mb-4 text-sm font-medium text-gray-900 dark:text-gray-100">{confirmLogout}</p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setConfirmLogout(null)}
                className="h-11 flex-1 rounded-2xl border border-gray-200 font-bold text-gray-600 dark:border-gray-600 dark:text-gray-300"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={doLogout}
                className="h-11 flex-1 rounded-2xl bg-red-600 font-bold text-white hover:bg-red-700"
              >
                Выйти
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
