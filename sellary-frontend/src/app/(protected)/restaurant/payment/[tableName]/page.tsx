'use client';

import { useRouter, useParams } from 'next/navigation';
import { useRestaurantStore } from '@/lib/restaurant-store';
import { useState, useEffect } from 'react';

type PaymentMethod = 'cash' | 'card' | 'mobile';
type CardType = 'alif' | 'eskhata' | 'dc' | null;

export default function PaymentPage() {
    const router = useRouter();
    const params = useParams();
    const tableName = decodeURIComponent(params.tableName as string);

    const { activeOrders, completePayment } = useRestaurantStore();

    const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | null>(null);
    const [cardType, setCardType] = useState<CardType>(null);
    const [receivedAmount, setReceivedAmount] = useState('');
    const [isProcessing, setIsProcessing] = useState(false);
    const [showSuccessModal, setShowSuccessModal] = useState(false);
    const [isLoading, setIsLoading] = useState(true);

    const order = activeOrders[tableName];

    useEffect(() => {
        setTimeout(() => setIsLoading(false), 300);
    }, []);

    if (isLoading) {
        return (
            <div className="flex items-center justify-center min-h-[60vh]">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
            </div>
        );
    }

    if (!order) {
        return (
            <div className="text-center py-12 px-4">
                <h2 className="text-lg sm:text-xl font-semibold text-gray-900 mb-2">Заказ не найден</h2>
                <p className="text-sm sm:text-base text-gray-600 mb-4">У этого стола нет активного заказа</p>
                <button
                    onClick={() => router.push('/restaurant')}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm sm:text-base"
                >
                    Вернуться к столам
                </button>
            </div>
        );
    }

    const totalAmount = order.totalAmount;
    const received = parseFloat(receivedAmount) || 0;
    const change = received - totalAmount;

    const handlePayment = async () => {
        if (!paymentMethod) return;
        if (paymentMethod === 'cash' && received < totalAmount) return;

        setIsProcessing(true);

        try {
            await new Promise(resolve => setTimeout(resolve, 1000));
            completePayment(tableName, paymentMethod, cardType || undefined);
            setShowSuccessModal(true);
        } catch (error) {
            console.error('Payment failed:', error);
        } finally {
            setIsProcessing(false);
        }
    };

    const quickAmounts = [
        Math.ceil(totalAmount / 10000) * 10000,
        Math.ceil(totalAmount / 50000) * 50000,
        Math.ceil(totalAmount / 100000) * 100000,
    ].filter((v, i, a) => a.indexOf(v) === i && v >= totalAmount).slice(0, 4);

    return (
        <div className="pb-20 sm:pb-24">
            {/* Header */}
            <header className="mb-4 sm:mb-6">
                <div className="flex items-center gap-3 sm:gap-4">
                    <button
                        onClick={() => router.push(`/restaurant/table/${encodeURIComponent(tableName)}`)}
                        className="p-1.5 sm:p-2 -ml-1 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
                    >
                        <svg className="w-5 h-5 sm:w-6 sm:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                        </svg>
                    </button>
                    <div>
                        <h1 className="text-lg sm:text-2xl font-bold text-gray-900">Оплата</h1>
                        <p className="text-xs sm:text-sm text-gray-600">{tableName}</p>
                    </div>
                </div>
            </header>

            {/* Order Summary */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 sm:p-6 mb-4 sm:mb-6">
                <h2 className="text-sm sm:text-lg font-semibold text-gray-900 mb-3 sm:mb-4">Детали заказа</h2>

                <div className="space-y-2 sm:space-y-3 mb-3 sm:mb-4 max-h-32 sm:max-h-48 overflow-y-auto">
                    {order.items.map((item) => (
                        <div key={item.id} className="flex justify-between items-center text-xs sm:text-base">
                            <span className="text-gray-700 truncate flex-1 mr-2">
                                {item.quantity}× {item.product.name}
                            </span>
                            <span className="font-medium text-gray-900 flex-shrink-0">
                                {(Number(item.product.sell_price) * item.quantity).toLocaleString()}
                            </span>
                        </div>
                    ))}
                </div>

                <div className="border-t border-gray-200 pt-3 sm:pt-4">
                    <div className="flex justify-between items-center text-lg sm:text-xl font-bold">
                        <span className="text-gray-900">Итого:</span>
                        <span className="text-blue-600">{totalAmount.toLocaleString()} с.</span>
                    </div>
                </div>
            </div>

            {/* Payment Method Selection */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 sm:p-6 mb-4 sm:mb-6">
                <h2 className="text-sm sm:text-lg font-semibold text-gray-900 mb-3 sm:mb-4">Способ оплаты</h2>

                <div className="grid grid-cols-3 gap-2 sm:gap-3">
                    <button
                        onClick={() => { setPaymentMethod('cash'); setCardType(null); }}
                        className={`p-3 sm:p-4 rounded-xl border-2 flex flex-col items-center gap-1 sm:gap-2 transition-all ${paymentMethod === 'cash'
                                ? 'border-green-500 bg-green-50'
                                : 'border-gray-200 hover:border-gray-300'
                            }`}
                    >
                        <div className={`w-10 h-10 sm:w-12 sm:h-12 rounded-full flex items-center justify-center ${paymentMethod === 'cash' ? 'bg-green-100' : 'bg-gray-100'
                            }`}>
                            <svg className={`w-5 h-5 sm:w-6 sm:h-6 ${paymentMethod === 'cash' ? 'text-green-600' : 'text-gray-600'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
                            </svg>
                        </div>
                        <span className={`font-medium text-xs sm:text-base ${paymentMethod === 'cash' ? 'text-green-700' : 'text-gray-700'}`}>
                            Нал
                        </span>
                    </button>

                    <button
                        onClick={() => setPaymentMethod('card')}
                        className={`p-3 sm:p-4 rounded-xl border-2 flex flex-col items-center gap-1 sm:gap-2 transition-all ${paymentMethod === 'card'
                                ? 'border-blue-500 bg-blue-50'
                                : 'border-gray-200 hover:border-gray-300'
                            }`}
                    >
                        <div className={`w-10 h-10 sm:w-12 sm:h-12 rounded-full flex items-center justify-center ${paymentMethod === 'card' ? 'bg-blue-100' : 'bg-gray-100'
                            }`}>
                            <svg className={`w-5 h-5 sm:w-6 sm:h-6 ${paymentMethod === 'card' ? 'text-blue-600' : 'text-gray-600'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                            </svg>
                        </div>
                        <span className={`font-medium text-xs sm:text-base ${paymentMethod === 'card' ? 'text-blue-700' : 'text-gray-700'}`}>
                            Карта
                        </span>
                    </button>

                    <button
                        onClick={() => { setPaymentMethod('mobile'); setCardType(null); }}
                        className={`p-3 sm:p-4 rounded-xl border-2 flex flex-col items-center gap-1 sm:gap-2 transition-all ${paymentMethod === 'mobile'
                                ? 'border-purple-500 bg-purple-50'
                                : 'border-gray-200 hover:border-gray-300'
                            }`}
                    >
                        <div className={`w-10 h-10 sm:w-12 sm:h-12 rounded-full flex items-center justify-center ${paymentMethod === 'mobile' ? 'bg-purple-100' : 'bg-gray-100'
                            }`}>
                            <svg className={`w-5 h-5 sm:w-6 sm:h-6 ${paymentMethod === 'mobile' ? 'text-purple-600' : 'text-gray-600'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
                            </svg>
                        </div>
                        <span className={`font-medium text-xs sm:text-base ${paymentMethod === 'mobile' ? 'text-purple-700' : 'text-gray-700'}`}>
                            QR
                        </span>
                    </button>
                </div>

                {/* Card Type Selection */}
                {paymentMethod === 'card' && (
                    <div className="mt-3 sm:mt-4 pt-3 sm:pt-4 border-t border-gray-200">
                        <p className="text-xs sm:text-sm text-gray-600 mb-2 sm:mb-3">Выберите карту:</p>
                        <div className="flex gap-2 sm:gap-3">
                            {(['alif', 'eskhata', 'dc'] as CardType[]).map((type) => (
                                <button
                                    key={type}
                                    onClick={() => setCardType(type)}
                                    className={`flex-1 py-2 sm:py-3 rounded-lg font-medium transition-all text-xs sm:text-base ${cardType === type
                                            ? 'bg-blue-600 text-white'
                                            : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                                        }`}
                                >
                                    {type?.toUpperCase()}
                                </button>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            {/* Cash Amount Input */}
            {paymentMethod === 'cash' && (
                <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 sm:p-6 mb-4 sm:mb-6">
                    <h2 className="text-sm sm:text-lg font-semibold text-gray-900 mb-3 sm:mb-4">Наличные</h2>

                    <div className="mb-3 sm:mb-4">
                        <label className="block text-xs sm:text-sm text-gray-600 mb-2">Получено</label>
                        <input
                            type="number"
                            value={receivedAmount}
                            onChange={(e) => setReceivedAmount(e.target.value)}
                            placeholder={totalAmount.toString()}
                            className="w-full h-12 sm:h-14 text-xl sm:text-2xl text-center font-bold border-2 border-gray-200 rounded-xl focus:border-blue-500 focus:ring-0"
                        />
                    </div>

                    {/* Quick Amount Buttons */}
                    {quickAmounts.length > 0 && (
                        <div className="grid grid-cols-3 gap-2 mb-3 sm:mb-4">
                            {quickAmounts.map((amount) => (
                                <button
                                    key={amount}
                                    onClick={() => setReceivedAmount(amount.toString())}
                                    className={`py-2 sm:py-3 rounded-lg font-medium transition-all text-xs sm:text-base ${receivedAmount === amount.toString()
                                            ? 'bg-green-600 text-white'
                                            : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                                        }`}
                                >
                                    {(amount / 1000).toFixed(0)}k
                                </button>
                            ))}
                        </div>
                    )}

                    {/* Change Display */}
                    {received >= totalAmount && (
                        <div className="p-3 sm:p-4 bg-green-50 border border-green-200 rounded-xl">
                            <div className="flex justify-between items-center">
                                <span className="text-green-700 font-medium text-sm sm:text-base">Сдача:</span>
                                <span className="text-xl sm:text-2xl font-bold text-green-700">
                                    {change.toLocaleString()} с.
                                </span>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* Action Buttons */}
            <div className="fixed bottom-0 right-0 left-0 md:left-64 bg-white border-t border-gray-200 p-3 sm:p-4 z-40 safe-area-bottom">
                <div className="max-w-4xl mx-auto">
                    <button
                        onClick={handlePayment}
                        disabled={
                            !paymentMethod ||
                            (paymentMethod === 'card' && !cardType) ||
                            (paymentMethod === 'cash' && received < totalAmount) ||
                            isProcessing
                        }
                        className={`w-full h-12 sm:h-14 rounded-xl font-semibold text-base sm:text-lg transition-all ${!paymentMethod ||
                                (paymentMethod === 'card' && !cardType) ||
                                (paymentMethod === 'cash' && received < totalAmount)
                                ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                                : 'bg-green-600 text-white hover:bg-green-700 active:scale-98'
                            }`}
                    >
                        {isProcessing ? (
                            <div className="flex items-center justify-center gap-2 sm:gap-3">
                                <div className="w-4 h-4 sm:w-5 sm:h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                                Обработка...
                            </div>
                        ) : (
                            `Оплатить ${totalAmount.toLocaleString()} с.`
                        )}
                    </button>
                </div>
            </div>

            {/* Success Modal */}
            {showSuccessModal && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-3 sm:p-4">
                    <div className="bg-white w-full max-w-sm sm:max-w-md rounded-2xl p-4 sm:p-6 text-center animate-scale-in">
                        <div className="w-16 h-16 sm:w-20 sm:h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4 sm:mb-6">
                            <svg className="w-8 h-8 sm:w-10 sm:h-10 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                        </div>

                        <h2 className="text-xl sm:text-2xl font-bold text-gray-900 mb-2">Оплата принята!</h2>
                        <p className="text-sm sm:text-base text-gray-600 mb-4 sm:mb-6">
                            Оплата {totalAmount.toLocaleString()} с. за {tableName} прошла успешно.
                        </p>

                        {paymentMethod === 'cash' && change > 0 && (
                            <div className="p-3 sm:p-4 bg-yellow-50 border border-yellow-200 rounded-xl mb-4 sm:mb-6">
                                <p className="text-yellow-800 font-medium text-sm sm:text-base">
                                    Сдача: {change.toLocaleString()} с.
                                </p>
                            </div>
                        )}

                        <button
                            onClick={() => router.push('/restaurant')}
                            className="w-full h-12 sm:h-14 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 transition-colors text-sm sm:text-base"
                        >
                            Вернуться к столам
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
