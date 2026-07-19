import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { getCart } from '../lib/cart';
import { placeOrder, type PlacedOrder } from '../lib/api';
import { splitCartIntoOrders } from '../lib/checkout';
import { getInitData } from '../telegram/initData';
import { formatPrice } from '../lib/format';

/** Coerce any error thrown by placeOrder into a readable string. */
function coerceError(err: unknown): string {
  if (!err) return 'Неизвестная ошибка';
  if (typeof err === 'string') return err;
  if (err instanceof Error) return err.message;
  // Handle FastAPI 422 detail array: [{type, loc, msg, input}, ...]
  if (typeof err === 'object') {
    const e = err as Record<string, unknown>;
    if (Array.isArray(e.detail)) {
      return (e.detail as Array<{ msg?: string }>)
        .map(d => d.msg ?? JSON.stringify(d))
        .join('; ');
    }
    if (typeof e.detail === 'string') return e.detail;
    if (typeof e.message === 'string') return e.message;
  }
  return JSON.stringify(err);
}

export function CheckoutPage() {
  const cart = getCart();
  const items = cart.getItems();
  const total = cart.getTotal();

  const initData = getInitData();
  const prefillName = initData?.user.first_name ?? '';

  const [contactName, setContactName] = useState(prefillName);
  const [contactPhone, setContactPhone] = useState('');
  const [fulfillmentType, setFulfillmentType] = useState<'delivery' | 'pickup'>('pickup');
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [placedOrders, setPlacedOrders] = useState<PlacedOrder[] | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Keep name prefill in sync if initData loads asynchronously
  useEffect(() => {
    if (prefillName && !contactName) {
      setContactName(prefillName);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefillName]);

  const phoneValid = contactPhone.trim().length >= 7;
  const nameValid = contactName.trim().length >= 1;
  const addressValid = fulfillmentType === 'pickup' || deliveryAddress.trim().length >= 1;
  const canSubmit = !submitting && phoneValid && nameValid && addressValid && items.length > 0;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;

    setSubmitting(true);
    setErrorMsg(null);

    try {
      const orders = splitCartIntoOrders(items, {
        fulfillment_type: fulfillmentType,
        delivery_address: fulfillmentType === 'delivery' ? deliveryAddress.trim() : null,
        contact_phone: contactPhone.trim(),
        contact_name: contactName.trim(),
        notes: notes.trim() || null,
      });

      const response = await placeOrder(orders);
      cart.clear();
      setPlacedOrders(response.orders);
    } catch (err) {
      // placeOrder throws an Error with `${status} ${statusText}`; the actual
      // body may have been parsed further upstream. Coerce whatever we get.
      setErrorMsg(coerceError(err));
    } finally {
      setSubmitting(false);
    }
  }

  // Success screen
  if (placedOrders) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col">
        <header className="bg-blue-600 text-white px-4 py-3">
          <h1 className="font-bold text-lg">Заказ оформлен</h1>
        </header>
        <main className="flex-1 flex flex-col items-center justify-center p-6 gap-4">
          <p className="text-5xl">✅</p>
          <h2 className="text-xl font-bold text-gray-800">Спасибо за заказ!</h2>
          {placedOrders.map(order => (
            <div
              key={order.id}
              className="w-full bg-white rounded-xl border border-gray-100 p-4 text-center"
            >
              <p className="text-gray-500 text-sm">Заказ</p>
              <p className="text-2xl font-bold text-blue-600">№{order.order_number}</p>
              <p className="text-gray-600 mt-1">{formatPrice(order.total_amount)}</p>
            </div>
          ))}
          <Link
            to="/"
            className="mt-4 w-full py-3 bg-blue-600 text-white rounded-xl font-semibold text-center block"
          >
            Вернуться в каталог
          </Link>
        </main>
      </div>
    );
  }

  // Empty cart guard
  if (items.length === 0) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col">
        <header className="bg-blue-600 text-white px-4 py-3 flex items-center gap-3">
          <Link to="/cart" className="text-white">← Корзина</Link>
          <h1 className="font-bold">Оформление заказа</h1>
        </header>
        <main className="flex-1 flex flex-col items-center justify-center p-6 gap-4">
          <p className="text-gray-500">Корзина пуста</p>
          <Link to="/" className="px-6 py-2 bg-blue-600 text-white rounded-xl">
            Перейти в каталог
          </Link>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="bg-blue-600 text-white px-4 py-3 flex items-center gap-3">
        <Link to="/cart" className="text-white">← Корзина</Link>
        <h1 className="font-bold">Оформление заказа</h1>
      </header>

      <main className="flex-1 p-4">
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Contact name */}
          <div className="bg-white rounded-xl p-4 space-y-3">
            <h2 className="font-semibold text-gray-800">Контактные данные</h2>

            <div>
              <label className="block text-sm text-gray-600 mb-1" htmlFor="contact-name">
                Имя <span className="text-red-500">*</span>
              </label>
              <input
                id="contact-name"
                type="text"
                value={contactName}
                onChange={e => setContactName(e.target.value)}
                placeholder="Ваше имя"
                required
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            </div>

            <div>
              <label className="block text-sm text-gray-600 mb-1" htmlFor="contact-phone">
                Телефон <span className="text-red-500">*</span>
              </label>
              <input
                id="contact-phone"
                type="tel"
                value={contactPhone}
                onChange={e => setContactPhone(e.target.value)}
                placeholder="+992 XX XXX XXXX"
                required
                minLength={7}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            </div>
          </div>

          {/* Fulfillment type */}
          <div className="bg-white rounded-xl p-4 space-y-3">
            <h2 className="font-semibold text-gray-800">Способ получения</h2>

            <div className="flex gap-3">
              <label className="flex-1 flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="fulfillment"
                  value="pickup"
                  checked={fulfillmentType === 'pickup'}
                  onChange={() => setFulfillmentType('pickup')}
                  className="accent-blue-600"
                />
                <span className="text-gray-800">Самовывоз</span>
              </label>
              <label className="flex-1 flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="fulfillment"
                  value="delivery"
                  checked={fulfillmentType === 'delivery'}
                  onChange={() => setFulfillmentType('delivery')}
                  className="accent-blue-600"
                />
                <span className="text-gray-800">Доставка</span>
              </label>
            </div>

            {fulfillmentType === 'delivery' && (
              <div>
                <label className="block text-sm text-gray-600 mb-1" htmlFor="delivery-address">
                  Адрес доставки <span className="text-red-500">*</span>
                </label>
                <input
                  id="delivery-address"
                  type="text"
                  value={deliveryAddress}
                  onChange={e => setDeliveryAddress(e.target.value)}
                  placeholder="Улица, дом, квартира"
                  required
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
              </div>
            )}
          </div>

          {/* Notes */}
          <div className="bg-white rounded-xl p-4">
            <label className="block text-sm text-gray-600 mb-1" htmlFor="notes">
              Примечание (необязательно)
            </label>
            <textarea
              id="notes"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Любые пожелания к заказу"
              rows={3}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-400 resize-none"
            />
          </div>

          {/* Order summary */}
          <div className="bg-white rounded-xl p-4">
            <div className="flex justify-between text-lg font-bold">
              <span>Итого:</span>
              <span className="text-blue-600">{formatPrice(total)}</span>
            </div>
          </div>

          {/* Error message */}
          {errorMsg && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-red-700 text-sm">
              {errorMsg}
            </div>
          )}

          <button
            type="submit"
            disabled={!canSubmit}
            className={`w-full py-4 rounded-xl font-semibold text-lg transition-colors ${
              canSubmit
                ? 'bg-blue-600 text-white active:bg-blue-700'
                : 'bg-gray-300 text-gray-500 cursor-not-allowed'
            }`}
          >
            {submitting ? 'Оформление...' : 'Оформить заказ'}
          </button>
        </form>
      </main>
    </div>
  );
}
