'use client';

import { useRouter, useParams } from 'next/navigation';
import { useRestaurantStore } from '@/lib/restaurant-store';
import { useState, useEffect } from 'react';
import { Product } from '@/lib/types';
import { formatCurrency } from '@/lib/utils';

// Mock products data - replace with API call
const mockProducts: Product[] = [
  { id: 1, barcode: '1001', name: 'Плов', description: 'Традиционный узбекский плов', category_id: 1, product_type: 'dish', cost_price: '15.00', sell_price: '35.00', tax_percent: '0', stock_quantity: 100, min_stock_level: 10, is_active: true, created_at: '2024-01-01' },
  { id: 2, barcode: '1002', name: 'Манты', description: 'Манты с мясом', category_id: 1, product_type: 'dish', cost_price: '10.00', sell_price: '25.00', tax_percent: '0', stock_quantity: 80, min_stock_level: 10, is_active: true, created_at: '2024-01-01' },
  { id: 3, barcode: '1003', name: 'Шашлык', description: 'Шашлык из баранины', category_id: 2, product_type: 'dish', cost_price: '20.00', sell_price: '45.00', tax_percent: '0', stock_quantity: 50, min_stock_level: 5, is_active: true, created_at: '2024-01-01' },
  { id: 4, barcode: '1004', name: 'Лагман', description: 'Узбекский лагман', category_id: 1, product_type: 'dish', cost_price: '8.00', sell_price: '20.00', tax_percent: '0', stock_quantity: 60, min_stock_level: 10, is_active: true, created_at: '2024-01-01' },
  { id: 5, barcode: '1005', name: 'Самса', description: 'Самса с мясом', category_id: 3, product_type: 'dish', cost_price: '5.00', sell_price: '12.00', tax_percent: '0', stock_quantity: 100, min_stock_level: 20, is_active: true, created_at: '2024-01-01' },
  { id: 6, barcode: '1006', name: 'Чай', description: 'Зеленый чай', category_id: 4, product_type: 'dish', cost_price: '1.00', sell_price: '3.00', tax_percent: '0', stock_quantity: 200, min_stock_level: 50, is_active: true, created_at: '2024-01-01' },
];

const mockCategories = [
  { id: 1, name: 'Основные блюда' },
  { id: 2, name: 'Шашлык' },
  { id: 3, name: 'Выпечка' },
  { id: 4, name: 'Напитки' },
];

export default function OrderPage() {
  const router = useRouter();
  const params = useParams();
  const saleId = params.saleId as string;

  const {
    selectedTable,
    currentOrderItems: orderItems,
    selectedCategory,
    setSelectedCategory,
    addItemToOrder: addItem,
    updateItemQuantity: updateQuantity,
    removeItemFromOrder: removeItem,
    getCurrentOrderTotal: getTotal,
    clearSelection,
  } = useRestaurantStore();

  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [products] = useState<Product[]>(mockProducts);
  const [categories] = useState(mockCategories);

  const filteredProducts = selectedCategory
    ? products.filter(p => p.category_id === selectedCategory)
    : products;

  const handleAddItem = (product: Product) => {
    addItem(product);
  };

  const handleQuantityChange = (itemId: string, newQuantity: number) => {
    if (newQuantity <= 0) {
      removeItem(itemId);
    } else {
      updateQuantity(itemId, newQuantity);
    }
  };

  const handleProceedToPayment = () => {
    if (orderItems.length === 0) return;
    setShowPaymentModal(true);
  };

  const handleBack = () => {
    clearSelection();
    router.push('/restaurant');
  };

  return (
    <div className="pb-52 lg:pb-40">
      {/* Header */}
      <header className="mb-4">
        <div className="flex items-center justify-between">
          <button
            onClick={handleBack}
            className="p-2 -ml-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div className="text-center">
            <h1 className="text-xl font-bold text-gray-900">{selectedTable || 'Стол'}</h1>
            <p className="text-sm text-gray-600">{orderItems.length} позиций</p>
          </div>
          <div className="w-10" /> {/* Spacer */}
        </div>
      </header>

      {/* Category Bar */}
      <div className="mb-4">
        <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
          <button
            onClick={() => setSelectedCategory(null)}
            className={`
              px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-colors
              ${selectedCategory === null
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }
            `}
          >
            Все
          </button>
          {categories.map((category) => (
            <button
              key={category.id}
              onClick={() => setSelectedCategory(category.id)}
              className={`
                px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-colors
                ${selectedCategory === category.id
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }
              `}
            >
              {category.name}
            </button>
          ))}
        </div>
      </div>

      {/* Dish Grid - Responsive: 2 cols mobile, 3 cols tablet, 4-5 cols desktop */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
        {filteredProducts.map((product) => {
          const orderItem = orderItems.find(item => item.product.id === product.id);
          const quantity = orderItem?.quantity || 0;

          return (
            <div
              key={product.id}
              className="bg-white rounded-xl shadow-sm overflow-hidden hover:shadow-md transition-shadow"
            >
              {/* Dish Image Placeholder */}
              <div className="aspect-square bg-gradient-to-br from-orange-100 to-orange-200 flex items-center justify-center">
                <span className="text-4xl lg:text-5xl">🍽️</span>
              </div>

              {/* Dish Info */}
              <div className="p-3 lg:p-4">
                <h3 className="font-semibold text-gray-900 text-sm lg:text-base mb-1">
                  {product.name}
                </h3>
                <p className="text-xs lg:text-sm text-gray-500 mb-2 line-clamp-2">
                  {product.description}
                </p>
                <div className="flex items-center justify-between">
                  <span className="font-bold text-blue-600 text-lg">
                    {formatCurrency(product.sell_price)}
                  </span>

                  {/* Quantity Controls */}
                  {quantity > 0 && orderItem ? (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleQuantityChange(orderItem.id, quantity - 1)}
                        className="w-8 h-8 lg:w-9 lg:h-9 rounded-full bg-red-100 text-red-600 flex items-center justify-center hover:bg-red-200 active:scale-95 transition-all"
                      >
                        −
                      </button>
                      <span className="font-semibold text-gray-900 w-6 text-center">
                        {quantity}
                      </span>
                      <button
                        onClick={() => handleQuantityChange(orderItem.id, quantity + 1)}
                        className="w-8 h-8 lg:w-9 lg:h-9 rounded-full bg-green-100 text-green-600 flex items-center justify-center hover:bg-green-200 active:scale-95 transition-all"
                      >
                        +
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => handleAddItem(product)}
                      className="w-8 h-8 lg:w-10 lg:h-10 rounded-full bg-blue-600 text-white flex items-center justify-center hover:bg-blue-700 active:scale-95 transition-all"
                    >
                      +
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Order Summary Bottom Sheet - Fixed but respects sidebar */}
      <div className="fixed bottom-0 right-0 left-0 md:left-64 bg-white border-t border-gray-200 shadow-lg z-40">
        <div className="max-w-4xl mx-auto p-4">
          {/* Order Items Preview - Collapsed on mobile, expanded on desktop */}
          {orderItems.length > 0 && (
            <div className="mb-3 max-h-24 lg:max-h-32 overflow-y-auto">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-1">
                {orderItems.map((item) => (
                  <div
                    key={item.product.id}
                    className="flex justify-between items-center py-1 text-sm"
                  >
                    <span className="text-gray-700">
                      {item.quantity}x {item.product.name}
                    </span>
                    <span className="font-semibold text-gray-900">
                      {(Number(item.product.sell_price) * item.quantity).toFixed(2)} с.
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Total and Action */}
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm text-gray-600">Итого:</p>
              <p className="text-2xl lg:text-3xl font-bold text-gray-900">
                {getTotal().toFixed(2)} с.
              </p>
            </div>
            <button
              onClick={handleProceedToPayment}
              disabled={orderItems.length === 0}
              className={`
                px-8 lg:px-12 py-3 lg:py-4 rounded-xl font-semibold text-white text-lg
                ${orderItems.length === 0
                  ? 'bg-gray-300 cursor-not-allowed'
                  : 'bg-green-600 hover:bg-green-700 active:scale-95'
                }
                transition-all min-w-[140px] lg:min-w-[180px]
              `}
            >
              Оплата
            </button>
          </div>
        </div>
      </div>

      {/* Payment Modal */}
      {showPaymentModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white w-full max-w-md rounded-2xl p-6 animate-scale-in">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-bold text-gray-900">Оплата</h2>
              <button
                onClick={() => setShowPaymentModal(false)}
                className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="mb-6 p-4 bg-gray-50 rounded-xl">
              <p className="text-sm text-gray-600">К оплате:</p>
              <p className="text-3xl font-bold text-gray-900">{getTotal().toFixed(2)} с.</p>
            </div>

            <div className="space-y-3 mb-6">
              <button className="w-full h-14 bg-green-600 text-white rounded-xl font-semibold hover:bg-green-700 active:scale-98 transition-all flex items-center justify-center gap-3">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
                Наличные
              </button>
              <button className="w-full h-14 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 active:scale-98 transition-all flex items-center justify-center gap-3">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                </svg>
                Карта
              </button>
              <button className="w-full h-14 bg-purple-600 text-white rounded-xl font-semibold hover:bg-purple-700 active:scale-98 transition-all flex items-center justify-center gap-3">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
                </svg>
                Мобильный
              </button>
            </div>

            <button
              onClick={() => setShowPaymentModal(false)}
              className="w-full h-12 bg-gray-100 text-gray-700 rounded-xl font-medium hover:bg-gray-200 transition-colors"
            >
              Отмена
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
