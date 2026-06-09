import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { getProducts, getProductByBarcode, addToOutbox, getPendingSales, decrementLocalStock } from '../lib/db';
import type { LocalProduct } from '../lib/db';
import { useAuthStore } from '../lib/auth-store';
import { syncPendingSales } from '../lib/sync-service';
import { checkHealth } from '../lib/api';

interface CartItem {
  product: LocalProduct;
  quantity: number;
}

type PaymentMethod = 'CASH' | 'CARD' | 'MOBILE';
type CardType = 'ALIF' | 'ESKHATA' | 'DC';

export function POSPage() {
  const navigate = useNavigate();
  const { logout, username, companyName } = useAuthStore();

  const [search, setSearch] = useState('');
  const [products, setProducts] = useState<LocalProduct[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('CASH');
  const [cardType, setCardType] = useState<CardType>('ALIF');
  const [cashReceived, setCashReceived] = useState('');
  const [pendingCount, setPendingCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [online, setOnline] = useState(false);
  const [syncMessage, setSyncMessage] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  useEffect(() => {
    checkHealth().then(setOnline);
    const interval = setInterval(() => checkHealth().then(setOnline), 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    loadPendingCount();
  }, []);

  const loadPendingCount = async () => {
    const pending = await getPendingSales();
    setPendingCount(pending.filter((s) => s.status !== 'synced').length);
  };

  const handleSearch = useCallback(async (query: string) => {
    setSearch(query);
    if (query.length >= 2) {
      const results = await getProducts(query);
      setProducts(results.slice(0, 20));
    } else if (query.length === 0) {
      setProducts([]);
    }
  }, []);

  const handleKeyDown = async (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && search.trim()) {
      e.preventDefault();
      const product = await getProductByBarcode(search.trim());
      if (product) {
        addToCart(product);
        setSearch('');
        setProducts([]);
      } else {
        const results = await getProducts(search.trim());
        if (results.length === 1) {
          addToCart(results[0]);
          setSearch('');
          setProducts([]);
        }
      }
    }
  };

  const addToCart = (product: LocalProduct) => {
    setCart((prev) => {
      const existing = prev.find((i) => i.product.id === product.id);
      if (existing) {
        return prev.map((i) =>
          i.product.id === product.id
            ? { ...i, quantity: i.quantity + 1 }
            : i
        );
      }
      return [...prev, { product, quantity: 1 }];
    });
  };

  const removeFromCart = (productId: number) => {
    setCart((prev) => prev.filter((i) => i.product.id !== productId));
  };

  const updateQuantity = (productId: number, delta: number) => {
    setCart((prev) => {
      const existing = prev.find((i) => i.product.id === productId);
      if (!existing) return prev;
      const newQty = existing.quantity + delta;
      if (newQty <= 0) {
        return prev.filter((i) => i.product.id !== productId);
      }
      return prev.map((i) =>
        i.product.id === productId ? { ...i, quantity: newQty } : i
      );
    });
  };

  const totalAmount = cart.reduce(
    (sum, item) => sum + item.product.sell_price * item.quantity,
    0
  );

  const generateId = () => {
    const ts = Date.now().toString(36);
    const rand = Math.random().toString(36).substring(2, 10);
    return `${ts}-${rand}`;
  };

  const handleCompleteSale = async () => {
    if (cart.length === 0) return;

    const clientSaleId = generateId();
    const idempotencyKey = generateId();
    const now = new Date().toISOString();

    const salePayload = {
      client_sale_id: clientSaleId,
      idempotency_key: idempotencyKey,
      created_at_client: now,
      payment_method: paymentMethod,
      card_type: paymentMethod === 'CARD' ? cardType : null,
      discount_amount: 0,
      paid_amount: paymentMethod === 'CASH' ? (parseFloat(cashReceived) || totalAmount) : totalAmount,
      change_amount: paymentMethod === 'CASH'
        ? Math.max(0, (parseFloat(cashReceived) || 0) - totalAmount)
        : 0,
      items: cart.map((item) => ({
        product_id: item.product.id,
        quantity: item.quantity,
        sell_price: item.product.sell_price,
      })),
    };

    await addToOutbox({
      client_sale_id: clientSaleId,
      idempotency_key: idempotencyKey,
      status: 'pending',
      request_json: JSON.stringify(salePayload),
      response_json: null,
      last_error: null,
      created_at_client: now,
      synced_at: null,
    });

    setCart([]);
    setCashReceived('');
    setSearch('');
    setProducts([]);
    searchRef.current?.focus();

    setSyncing(true);
    setSyncMessage('');
    try {
      const result = await syncPendingSales();
      if (result.synced > 0) {
        try {
          await decrementLocalStock(
            cart.map((item) => ({
              product_id: item.product.id,
              quantity: item.quantity,
            }))
          );
        } catch (error) {
          console.warn('Sale synced but local stock update failed', error);
        }
        setSyncMessage('Продажа синхронизирована ✓');
      } else if (result.failed > 0) {
        setSyncMessage('Ошибка синхронизации');
      } else {
        setSyncMessage('Сохранено локально (офлайн)');
      }
    } catch {
      setSyncMessage('Сохранено локально (нет связи)');
    } finally {
      setSyncing(false);
      loadPendingCount();
      setTimeout(() => setSyncMessage(''), 3000);
    }
  };

  const handleManualSync = async () => {
    if (syncing) return;
    setSyncing(true);
    setSyncMessage('');
    try {
      const result = await syncPendingSales();
      if (result.synced > 0) {
        setSyncMessage(`Синхронизировано: ${result.synced} продаж`);
      } else if (result.failed > 0) {
        setSyncMessage(`Ошибок: ${result.failed}`);
      } else {
        setSyncMessage('Нет продаж для синхронизации');
      }
      loadPendingCount();
    } catch (e: unknown) {
      setSyncMessage(e instanceof Error ? e.message : 'Ошибка синхронизации');
    } finally {
      setSyncing(false);
    }
  };

  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      <header className="bg-white border-b px-4 py-2 flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-sm font-bold">{companyName || 'Sellary Cashier'}</h1>
          <p className="text-xs text-gray-400">{username}</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className={`inline-block h-2 w-2 rounded-full ${online ? 'bg-green-500' : 'bg-red-500'}`} />
            <span className="text-xs text-gray-500">{online ? 'Online' : 'Offline'}</span>
          </div>
          <button
            onClick={handleManualSync}
            disabled={syncing}
            className="text-xs px-2 py-1 rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-50"
          >
            {syncing ? 'Sync...' : `Sync${pendingCount > 0 ? ` (${pendingCount})` : ''}`}
          </button>
          <button onClick={() => navigate('/settings')} className="text-xs text-gray-500">
            Settings
          </button>
          <button onClick={handleLogout} className="text-xs text-red-500">
            Exit
          </button>
        </div>
      </header>

      {syncMessage && (
        <div className={`px-4 py-1.5 text-center text-sm ${
          syncMessage.includes('✓') || syncMessage.includes('синхронизировано')
            ? 'bg-green-50 text-green-700'
            : syncMessage.includes('локально') || syncMessage.includes('связи')
              ? 'bg-amber-50 text-amber-700'
              : 'bg-red-50 text-red-600'
        }`}>
          {syncMessage}
        </div>
      )}

      <div className="flex-1 flex overflow-hidden">
        <div className="w-1/2 flex flex-col border-r">
          <div className="p-3">
            <input
              ref={searchRef}
              type="text"
              value={search}
              onChange={(e) => handleSearch(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Поиск по названию или штрихкоду..."
              className="w-full rounded border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="flex-1 overflow-auto px-3 pb-3">
            <div className="space-y-1">
              {products.map((p) => (
                <button
                  key={p.id}
                  onClick={() => addToCart(p)}
                  className="w-full text-left px-3 py-2 rounded border border-gray-100 hover:bg-blue-50 hover:border-blue-200 transition-colors"
                >
                  <div className="flex justify-between items-center">
                    <div>
                      <span className="text-sm font-medium">{p.name}</span>
                      {p.barcode && (
                        <span className="text-xs text-gray-400 ml-2">{p.barcode}</span>
                      )}
                    </div>
                    <span className="text-sm font-bold text-blue-600">
                      {p.sell_price.toLocaleString()} сум
                    </span>
                  </div>
                  <div className="text-xs text-gray-400">
                    Остаток: {p.stock_quantity} {p.uom}
                  </div>
                </button>
              ))}
              {search.length >= 2 && products.length === 0 && (
                <p className="text-sm text-gray-400 text-center py-4">Ничего не найдено</p>
              )}
              {search.length === 0 && (
                <p className="text-sm text-gray-400 text-center py-8">
                  Введите название или штрихкод товара
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="w-1/2 flex flex-col">
          <div className="flex-1 overflow-auto p-3">
            {cart.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-8">Корзина пуста</p>
            ) : (
              <div className="space-y-2">
                {cart.map((item) => (
                  <div key={item.product.id} className="flex items-center justify-between bg-white rounded border p-2">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{item.product.name}</div>
                      <div className="text-xs text-gray-400">
                        {item.product.sell_price.toLocaleString()} x {item.quantity}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 ml-2">
                      <button
                        onClick={() => updateQuantity(item.product.id, -1)}
                        className="w-7 h-7 rounded border text-sm hover:bg-gray-50"
                      >
                        -
                      </button>
                      <span className="text-sm font-medium w-6 text-center">{item.quantity}</span>
                      <button
                        onClick={() => updateQuantity(item.product.id, 1)}
                        className="w-7 h-7 rounded border text-sm hover:bg-gray-50"
                      >
                        +
                      </button>
                      <button
                        onClick={() => removeFromCart(item.product.id)}
                        className="w-7 h-7 rounded border text-sm text-red-500 hover:bg-red-50 ml-1"
                      >
                        ×
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="border-t bg-white p-3 shrink-0">
            <div className="flex justify-between items-center mb-2">
              <span className="text-sm text-gray-500">Итого:</span>
              <span className="text-lg font-bold">{totalAmount.toLocaleString()} сум</span>
            </div>

            {cart.length > 0 && (
              <>
                <div className="flex gap-1 mb-2">
                  {(['CASH', 'CARD', 'MOBILE'] as PaymentMethod[]).map((m) => (
                    <button
                      key={m}
                      onClick={() => setPaymentMethod(m)}
                      className={`flex-1 py-1.5 text-xs rounded border ${
                        paymentMethod === m
                          ? 'bg-blue-600 text-white border-blue-600'
                          : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                      }`}
                    >
                      {m === 'CASH' ? 'Наличные' : m === 'CARD' ? 'Карта' : 'Мобильный'}
                    </button>
                  ))}
                </div>

                {paymentMethod === 'CARD' && (
                  <div className="flex gap-1 mb-2">
                    {(['ALIF', 'ESKHATA', 'DC'] as CardType[]).map((c) => (
                      <button
                        key={c}
                        onClick={() => setCardType(c)}
                        className={`flex-1 py-1 text-xs rounded border ${
                          cardType === c
                            ? 'bg-blue-600 text-white border-blue-600'
                            : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                        }`}
                      >
                        {c === 'ALIF' ? 'Alif' : c === 'ESKHATA' ? 'Eskhata' : 'DC'}
                      </button>
                    ))}
                  </div>
                )}

                {paymentMethod === 'CASH' && (
                  <div className="mb-2">
                    <div className="flex gap-1 mb-1">
                      {[totalAmount, totalAmount + 1000, totalAmount + 5000, totalAmount + 10000].map((amount) => (
                        <button
                          key={amount}
                          onClick={() => setCashReceived(Math.ceil(amount).toString())}
                          className="flex-1 py-1 text-xs rounded border border-gray-200 hover:bg-gray-50"
                        >
                          {Math.ceil(amount).toLocaleString()}
                        </button>
                      ))}
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        value={cashReceived}
                        onChange={(e) => setCashReceived(e.target.value)}
                        placeholder="Получено"
                        className="flex-1 rounded border px-2 py-1.5 text-sm"
                      />
                      {cashReceived && parseFloat(cashReceived) >= totalAmount && (
                        <span className="text-sm text-green-600 font-medium">
                          Сдача: {(parseFloat(cashReceived) - totalAmount).toLocaleString()}
                        </span>
                      )}
                    </div>
                  </div>
                )}

                <button
                  onClick={handleCompleteSale}
                  disabled={syncing || (paymentMethod === 'CASH' && !cashReceived)}
                  className="w-full py-3 rounded bg-green-600 text-white font-bold text-lg disabled:opacity-50 hover:bg-green-700"
                >
                  {syncing ? 'Сохранение...' : `Продажа (${totalAmount.toLocaleString()} сум)`}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
