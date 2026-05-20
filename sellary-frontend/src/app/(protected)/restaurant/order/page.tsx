'use client';

import { useRouter } from 'next/navigation';
import { useRestaurantStore } from '@/lib/restaurant-store';
import { useState, useEffect } from 'react';
import { Product } from '@/lib/types';
import { productsApi } from '@/lib/api';

const mockCategories = [
    { id: 1, name: 'Основные' },
    { id: 2, name: 'Супы' },
    { id: 3, name: 'Шашлыки' },
    { id: 4, name: 'Салаты' },
    { id: 5, name: 'Выпечка' },
    { id: 6, name: 'Напитки' },
    { id: 7, name: 'Десерты' },
];

export default function OrderPage() {
    const router = useRouter();

    const {
        selectedTable,
        currentOrderItems,
        selectedCategory,
        setSelectedCategory,
        addItemToOrder,
        removeItemFromOrder,
        updateItemQuantity,
        confirmOrder,
        clearSelection,
        getCurrentOrderTotal,
        getCurrentItemCount,
    } = useRestaurantStore();

    const [products, setProducts] = useState<Product[]>([]);
    const [categories] = useState(mockCategories);
    const [isLoading, setIsLoading] = useState(true);
    const [showConfirmModal, setShowConfirmModal] = useState(false);
    const [guestCount, setGuestCount] = useState(2);
    const [orderNotes, setOrderNotes] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Fetch products from API
    useEffect(() => {
        const fetchProducts = async () => {
            try {
                const response = await productsApi.getAll({
                    is_active: true,
                    product_type: 'dish'
                });
                setProducts(response.data?.items || response.data || []);
            } catch (error) {
                console.error('Failed to fetch products:', error);
                // Fallback to mock data
                setProducts([
                    { id: 1, barcode: '1001', name: 'Плов', description: 'Традиционный узбекский плов', category_id: 1, product_type: 'dish', uom: 'dona', cost_price: '15000', sell_price: '35000', tax_percent: '0', stock_quantity: 100, min_stock_level: 10, is_active: true, created_at: '2024-01-01' },
                    { id: 2, barcode: '1002', name: 'Манты', description: 'Манты с мясом', category_id: 1, product_type: 'dish', uom: 'dona', cost_price: '10000', sell_price: '25000', tax_percent: '0', stock_quantity: 80, min_stock_level: 10, is_active: true, created_at: '2024-01-01' },
                    { id: 3, barcode: '1003', name: 'Шашлык', description: 'Шашлык из баранины', category_id: 3, product_type: 'dish', uom: 'dona', cost_price: '20000', sell_price: '45000', tax_percent: '0', stock_quantity: 50, min_stock_level: 5, is_active: true, created_at: '2024-01-01' },
                    { id: 4, barcode: '1004', name: 'Лагман', description: 'Узбекский лагман', category_id: 1, product_type: 'dish', uom: 'dona', cost_price: '8000', sell_price: '20000', tax_percent: '0', stock_quantity: 60, min_stock_level: 10, is_active: true, created_at: '2024-01-01' },
                    { id: 5, barcode: '1005', name: 'Самса', description: 'Самса с мясом', category_id: 5, product_type: 'dish', uom: 'dona', cost_price: '5000', sell_price: '12000', tax_percent: '0', stock_quantity: 100, min_stock_level: 20, is_active: true, created_at: '2024-01-01' },
                    { id: 6, barcode: '1006', name: 'Зелёный чай', description: 'Чайник зелёного чая', category_id: 6, product_type: 'dish', uom: 'dona', cost_price: '1000', sell_price: '5000', tax_percent: '0', stock_quantity: 200, min_stock_level: 50, is_active: true, created_at: '2024-01-01' },
                    { id: 7, barcode: '1007', name: 'Шурпа', description: 'Суп из говядины', category_id: 2, product_type: 'dish', uom: 'dona', cost_price: '8000', sell_price: '22000', tax_percent: '0', stock_quantity: 40, min_stock_level: 10, is_active: true, created_at: '2024-01-01' },
                    { id: 8, barcode: '1008', name: 'Нарын', description: 'Блюдо нарын', category_id: 1, product_type: 'dish', uom: 'dona', cost_price: '12000', sell_price: '30000', tax_percent: '0', stock_quantity: 30, min_stock_level: 10, is_active: true, created_at: '2024-01-01' },
                    { id: 9, barcode: '1009', name: 'Ачичук', description: 'Салат из свежих овощей', category_id: 4, product_type: 'dish', uom: 'dona', cost_price: '3000', sell_price: '10000', tax_percent: '0', stock_quantity: 50, min_stock_level: 10, is_active: true, created_at: '2024-01-01' },
                    { id: 10, barcode: '1010', name: 'Чёрный чай', description: 'Чайник чёрного чая', category_id: 6, product_type: 'dish', uom: 'dona', cost_price: '1000', sell_price: '5000', tax_percent: '0', stock_quantity: 200, min_stock_level: 50, is_active: true, created_at: '2024-01-01' },
                    { id: 11, barcode: '1011', name: 'Минералка', description: '0.5л минеральная вода', category_id: 6, product_type: 'dish', uom: 'dona', cost_price: '1500', sell_price: '5000', tax_percent: '0', stock_quantity: 100, min_stock_level: 20, is_active: true, created_at: '2024-01-01' },
                    { id: 12, barcode: '1012', name: 'Тандыр-нан', description: 'Горячий тандырный хлеб', category_id: 5, product_type: 'dish', uom: 'dona', cost_price: '2000', sell_price: '5000', tax_percent: '0', stock_quantity: 50, min_stock_level: 10, is_active: true, created_at: '2024-01-01' },
                ]);
            } finally {
                setIsLoading(false);
            }
        };

        fetchProducts();
    }, []);

    // Redirect if no table selected
    useEffect(() => {
        if (!selectedTable && !isLoading) {
            router.push('/restaurant');
        }
    }, [selectedTable, isLoading, router]);

    const filteredProducts = selectedCategory
        ? products.filter(p => p.category_id === selectedCategory)
        : products;

    const handleConfirmOrder = async () => {
        if (currentOrderItems.length === 0) return;

        setIsSubmitting(true);
        try {
            const orderId = confirmOrder(guestCount, orderNotes);
            console.log('Order confirmed:', orderId);
            router.push('/restaurant');
        } catch (error) {
            console.error('Failed to confirm order:', error);
        } finally {
            setIsSubmitting(false);
            setShowConfirmModal(false);
        }
    };

    const handleBack = () => {
        clearSelection();
        router.push('/restaurant');
    };

    if (isLoading) {
        return (
            <div className="flex items-center justify-center min-h-[60vh]">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
            </div>
        );
    }

    if (!selectedTable) {
        return null;
    }

    return (
        <div className="pb-36 sm:pb-44">
            {/* Header */}
            <header className="mb-3 sm:mb-4">
                <div className="flex items-center justify-between">
                    <button
                        onClick={handleBack}
                        className="p-1.5 sm:p-2 -ml-1 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
                    >
                        <svg className="w-5 h-5 sm:w-6 sm:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                        </svg>
                    </button>
                    <div className="text-center">
                        <h1 className="text-base sm:text-xl font-bold text-gray-900">{selectedTable}</h1>
                        <p className="text-xs sm:text-sm text-gray-600">Новый заказ</p>
                    </div>
                    <div className="w-8 sm:w-10" />
                </div>
            </header>

            {/* Category Bar */}
            <div className="mb-3 sm:mb-4">
                <div className="flex gap-1.5 sm:gap-2 overflow-x-auto pb-2 scrollbar-hide -mx-1 px-1">
                    <button
                        onClick={() => setSelectedCategory(null)}
                        className={`
              px-3 sm:px-4 py-1.5 sm:py-2 rounded-full text-xs sm:text-sm font-medium whitespace-nowrap transition-colors
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
                px-3 sm:px-4 py-1.5 sm:py-2 rounded-full text-xs sm:text-sm font-medium whitespace-nowrap transition-colors
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

            {/* Product Grid - 2 cols mobile, 3-5 on larger */}
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2 sm:gap-4">
                {filteredProducts.map((product) => {
                    const orderItem = currentOrderItems.find(item => item.product.id === product.id);
                    const quantity = orderItem?.quantity || 0;

                    return (
                        <div
                            key={product.id}
                            className="bg-white rounded-xl shadow-sm overflow-hidden hover:shadow-md transition-shadow"
                        >
                            {/* Product Image Placeholder */}
                            <div className="aspect-square bg-gradient-to-br from-orange-100 to-orange-200 flex items-center justify-center relative">
                                <span className="text-3xl sm:text-5xl">🍽️</span>
                                {quantity > 0 && (
                                    <div className="absolute top-1.5 right-1.5 sm:top-2 sm:right-2 w-5 h-5 sm:w-7 sm:h-7 bg-blue-600 text-white rounded-full flex items-center justify-center font-bold text-xs sm:text-sm shadow-lg">
                                        {quantity}
                                    </div>
                                )}
                            </div>

                            {/* Product Info */}
                            <div className="p-2 sm:p-4">
                                <h3 className="font-semibold text-gray-900 text-xs sm:text-base mb-0.5 sm:mb-1 line-clamp-1">
                                    {product.name}
                                </h3>
                                <p className="text-[10px] sm:text-sm text-gray-500 mb-1.5 sm:mb-2 line-clamp-1 sm:line-clamp-2">
                                    {product.description}
                                </p>
                                <div className="flex items-center justify-between">
                                    <span className="font-bold text-blue-600 text-sm sm:text-lg">
                                        {Number(product.sell_price).toLocaleString()}
                                    </span>

                                    {/* Quantity Controls */}
                                    {quantity > 0 ? (
                                        <div className="flex items-center gap-1 sm:gap-2">
                                            <button
                                                onClick={() => {
                                                    if (quantity === 1 && orderItem) {
                                                        removeItemFromOrder(orderItem.id);
                                                    } else if (orderItem) {
                                                        updateItemQuantity(orderItem.id, quantity - 1);
                                                    }
                                                }}
                                                className="w-6 h-6 sm:w-9 sm:h-9 rounded-full bg-red-100 text-red-600 flex items-center justify-center hover:bg-red-200 active:scale-95 transition-all font-bold text-sm sm:text-base"
                                            >
                                                −
                                            </button>
                                            <span className="font-semibold text-gray-900 w-4 sm:w-6 text-center text-xs sm:text-base">
                                                {quantity}
                                            </span>
                                            <button
                                                onClick={() => orderItem && updateItemQuantity(orderItem.id, quantity + 1)}
                                                className="w-6 h-6 sm:w-9 sm:h-9 rounded-full bg-green-100 text-green-600 flex items-center justify-center hover:bg-green-200 active:scale-95 transition-all font-bold text-sm sm:text-base"
                                            >
                                                +
                                            </button>
                                        </div>
                                    ) : (
                                        <button
                                            onClick={() => addItemToOrder(product)}
                                            className="w-7 h-7 sm:w-10 sm:h-10 rounded-full bg-blue-600 text-white flex items-center justify-center hover:bg-blue-700 active:scale-95 transition-all text-base sm:text-lg font-bold"
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

            {/* Order Summary Bottom Sheet */}
            <div className="fixed bottom-0 right-0 left-0 md:left-64 bg-white border-t border-gray-200 shadow-lg z-40 safe-area-bottom">
                <div className="max-w-4xl mx-auto p-3 sm:p-4">
                    {/* Order Items Preview - Compact on mobile */}
                    {currentOrderItems.length > 0 && (
                        <div className="mb-2 sm:mb-3 max-h-16 sm:max-h-32 overflow-y-auto">
                            <div className="flex flex-wrap gap-1 sm:gap-2">
                                {currentOrderItems.slice(0, 5).map((item) => (
                                    <span
                                        key={item.id}
                                        className="inline-flex items-center px-2 py-0.5 sm:px-3 sm:py-1 bg-gray-100 rounded-full text-[10px] sm:text-xs text-gray-700"
                                    >
                                        {item.quantity}× {item.product.name}
                                    </span>
                                ))}
                                {currentOrderItems.length > 5 && (
                                    <span className="inline-flex items-center px-2 py-0.5 bg-gray-100 rounded-full text-[10px] sm:text-xs text-gray-500">
                                        +{currentOrderItems.length - 5}
                                    </span>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Total and Action */}
                    <div className="flex items-center justify-between gap-3 sm:gap-4">
                        <div>
                            <p className="text-[10px] sm:text-sm text-gray-600">
                                {getCurrentItemCount()} товаров
                            </p>
                            <p className="text-xl sm:text-3xl font-bold text-gray-900">
                                {getCurrentOrderTotal().toLocaleString()} с.
                            </p>
                        </div>
                        <button
                            onClick={() => setShowConfirmModal(true)}
                            disabled={currentOrderItems.length === 0}
                            className={`
                px-4 sm:px-10 py-2.5 sm:py-4 rounded-xl font-semibold text-white text-sm sm:text-lg
                ${currentOrderItems.length === 0
                                    ? 'bg-gray-300 cursor-not-allowed'
                                    : 'bg-green-600 hover:bg-green-700 active:scale-95'
                                }
                transition-all
              `}
                        >
                            Подтвердить
                        </button>
                    </div>
                </div>
            </div>

            {/* Confirm Order Modal */}
            {showConfirmModal && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-3 sm:p-4">
                    <div className="bg-white w-full max-w-md rounded-2xl p-4 sm:p-6 animate-scale-in max-h-[90vh] overflow-y-auto">
                        <div className="flex justify-between items-center mb-4 sm:mb-6">
                            <h2 className="text-lg sm:text-xl font-bold text-gray-900">Подтвердить заказ</h2>
                            <button
                                onClick={() => setShowConfirmModal(false)}
                                className="p-1.5 sm:p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                            >
                                <svg className="w-5 h-5 sm:w-6 sm:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>

                        {/* Order Summary */}
                        <div className="mb-4 sm:mb-6 p-3 sm:p-4 bg-gray-50 rounded-xl">
                            <div className="flex justify-between items-center mb-2 text-sm sm:text-base">
                                <span className="text-gray-600">Стол:</span>
                                <span className="font-semibold">{selectedTable}</span>
                            </div>
                            <div className="flex justify-between items-center mb-2 text-sm sm:text-base">
                                <span className="text-gray-600">Позиций:</span>
                                <span className="font-semibold">{getCurrentItemCount()} шт.</span>
                            </div>
                            <div className="flex justify-between items-center text-base sm:text-lg">
                                <span className="text-gray-600">Итого:</span>
                                <span className="font-bold text-blue-600">{getCurrentOrderTotal().toLocaleString()} с.</span>
                            </div>
                        </div>

                        {/* Guest Count */}
                        <div className="mb-3 sm:mb-4">
                            <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-2">
                                Количество гостей
                            </label>
                            <div className="flex items-center gap-3">
                                <button
                                    onClick={() => setGuestCount(Math.max(1, guestCount - 1))}
                                    className="w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-gray-100 text-gray-700 flex items-center justify-center hover:bg-gray-200"
                                >
                                    −
                                </button>
                                <span className="text-lg sm:text-xl font-bold w-8 text-center">{guestCount}</span>
                                <button
                                    onClick={() => setGuestCount(guestCount + 1)}
                                    className="w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-gray-100 text-gray-700 flex items-center justify-center hover:bg-gray-200"
                                >
                                    +
                                </button>
                            </div>
                        </div>

                        {/* Notes */}
                        <div className="mb-4 sm:mb-6">
                            <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-2">
                                Комментарий (необязательно)
                            </label>
                            <textarea
                                value={orderNotes}
                                onChange={(e) => setOrderNotes(e.target.value)}
                                placeholder="Особые пожелания..."
                                className="w-full h-16 sm:h-20 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none text-sm sm:text-base"
                            />
                        </div>

                        {/* Action Buttons */}
                        <div className="space-y-2 sm:space-y-3">
                            <button
                                onClick={handleConfirmOrder}
                                disabled={isSubmitting}
                                className="w-full h-11 sm:h-14 bg-green-600 text-white rounded-xl font-semibold hover:bg-green-700 active:scale-98 transition-all flex items-center justify-center gap-2 sm:gap-3 disabled:opacity-50 text-sm sm:text-base"
                            >
                                {isSubmitting ? (
                                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                                ) : (
                                    <>
                                        <svg className="w-5 h-5 sm:w-6 sm:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                        </svg>
                                        Отправить на кухню
                                    </>
                                )}
                            </button>
                            <button
                                onClick={() => setShowConfirmModal(false)}
                                className="w-full h-10 sm:h-12 bg-gray-100 text-gray-700 rounded-xl font-medium hover:bg-gray-200 transition-colors text-sm sm:text-base"
                            >
                                Отмена
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
