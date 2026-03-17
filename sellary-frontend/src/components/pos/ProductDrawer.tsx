'use client';

import { useState, useEffect, useRef } from 'react';
import { productsApi, categoriesApi } from '@/lib/api';
import { Product, Category } from '@/lib/types';
import { formatCurrency } from '@/lib/utils';
import { useDebounce } from '@/hooks/useDebounce';
import {
    MagnifyingGlassIcon,
    XMarkIcon,
    QrCodeIcon
} from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import { useProducts } from '@/hooks/useQueries';
import { useQuery } from '@tanstack/react-query';

interface ProductDrawerProps {
    isOpen: boolean;
    onClose: () => void;
    onAddToCart: (product: Product) => void;
}

export default function ProductDrawer({ isOpen, onClose, onAddToCart }: ProductDrawerProps) {
    const [searchQuery, setSearchQuery] = useState('');
    const debouncedSearch = useDebounce(searchQuery, 300);
    const [selectedCategory, setSelectedCategory] = useState<number | null>(null);
    const barcodeInputRef = useRef<HTMLInputElement>(null);
    const [barcode, setBarcode] = useState('');
    const [showBarcodeInput, setShowBarcodeInput] = useState(false);

    const params: any = { limit: 100 };
    if (debouncedSearch) params.search = debouncedSearch;
    if (selectedCategory) params.category_id = selectedCategory;

    const { data: products = [], isLoading: loading } = useProducts(params, {
        enabled: isOpen || !!debouncedSearch
    });

    const { data: categories = [] } = useQuery({
        queryKey: ['categories', 'active'],
        queryFn: async () => {
            const response = await categoriesApi.getAll({ active_only: true });
            return response.data;
        },
        enabled: isOpen
    });

    useEffect(() => {
        if (isOpen) {
            setTimeout(() => barcodeInputRef.current?.focus(), 100);
        }
    }, [isOpen]);

    const handleBarcodeSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!barcode.trim()) return;

        try {
            const response = await productsApi.getByBarcode(barcode);
            const product = response.data;
            onAddToCart(product);
            setBarcode('');
            toast.success(`${product.name} добавлен`);
        } catch (error: any) {
            toast.error(error.response?.data?.detail || 'Товар не найден');
        }
        barcodeInputRef.current?.focus();
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex justify-end sm:justify-end">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-gray-900/50 backdrop-blur-sm transition-opacity"
                onClick={onClose}
            />

            {/* Drawer Panel - Full screen on mobile, side drawer on desktop */}
            <div className="relative w-full sm:max-w-2xl bg-white dark:bg-gray-800 shadow-2xl h-full flex flex-col animate-in slide-in-from-bottom sm:slide-in-from-right duration-300">

                {/* Header */}
                <div className="p-2 sm:p-4 border-b border-gray-100 dark:border-gray-700 flex items-center gap-2 sm:gap-4 bg-white dark:bg-gray-800 z-10 safe-area-top">
                    <button onClick={onClose} className="p-1.5 sm:p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full transition-colors">
                        <XMarkIcon className="w-5 h-5 sm:w-6 sm:h-6 text-gray-500" />
                    </button>
                    <div className="flex-1 relative">
                        <MagnifyingGlassIcon className="absolute left-2 sm:left-3 top-1/2 -translate-y-1/2 w-4 h-4 sm:w-5 sm:h-5 text-gray-400" />
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="Поиск..."
                            className="w-full pl-8 sm:pl-10 pr-3 py-2 sm:py-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 text-sm sm:text-base focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
                            autoFocus
                        />
                    </div>

                    {/* Barcode button for mobile */}
                    <button
                        onClick={() => setShowBarcodeInput(!showBarcodeInput)}
                        className={`sm:hidden p-2 rounded-xl border transition-colors ${showBarcodeInput ? 'bg-blue-50 border-blue-500 text-blue-600' : 'border-gray-200 text-gray-500'}`}
                    >
                        <QrCodeIcon className="w-5 h-5" />
                    </button>

                    {/* Barcode input for desktop */}
                    <form onSubmit={handleBarcodeSubmit} className="w-40 sm:w-48 relative hidden sm:block">
                        <QrCodeIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 sm:w-5 sm:h-5 text-gray-400" />
                        <input
                            ref={barcodeInputRef}
                            type="text"
                            value={barcode}
                            onChange={(e) => setBarcode(e.target.value)}
                            placeholder="Штрихкод"
                            className="w-full pl-9 sm:pl-10 py-2 sm:py-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all font-mono"
                        />
                    </form>
                </div>

                {/* Mobile Barcode Input */}
                {showBarcodeInput && (
                    <form onSubmit={handleBarcodeSubmit} className="sm:hidden px-3 py-2 border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
                        <div className="relative">
                            <QrCodeIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                            <input
                                ref={barcodeInputRef}
                                type="text"
                                value={barcode}
                                onChange={(e) => setBarcode(e.target.value)}
                                placeholder="Сканируйте штрихкод..."
                                className="w-full pl-9 pr-16 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm font-mono"
                            />
                            <button type="submit" className="absolute right-2 top-1/2 -translate-y-1/2 px-3 py-1 bg-blue-600 text-white text-xs rounded-md">
                                OK
                            </button>
                        </div>
                    </form>
                )}

                {/* Categories */}
                <div className="px-2 sm:px-4 py-2 sm:py-3 border-b border-gray-100 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/50 overflow-x-auto whitespace-nowrap scrollbar-hide">
                    <button
                        onClick={() => setSelectedCategory(null)}
                        className={`px-3 sm:px-4 py-1 sm:py-1.5 rounded-full text-xs sm:text-sm font-medium transition-all mr-1 sm:mr-2 ${selectedCategory === null
                            ? 'bg-blue-600 text-white shadow-md'
                            : 'bg-white dark:bg-gray-700 text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-600'
                            }`}
                    >
                        Все
                    </button>
                    {categories.map((cat: Category) => (
                        <button
                            key={cat.id}
                            onClick={() => setSelectedCategory(cat.id === selectedCategory ? null : cat.id)}
                            className={`px-3 sm:px-4 py-1 sm:py-1.5 rounded-full text-xs sm:text-sm font-medium transition-all mr-1 sm:mr-2 ${selectedCategory === cat.id
                                ? 'bg-blue-600 text-white shadow-md'
                                : 'bg-white dark:bg-gray-700 text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-600 hover:bg-gray-50'
                                }`}
                        >
                            {cat.name}
                        </button>
                    ))}
                </div>

                {/* Grid */}
                <div className="flex-1 overflow-y-auto p-2 sm:p-4 bg-gray-50 dark:bg-gray-900 safe-area-bottom">
                    <div className="grid grid-cols-3 sm:grid-cols-3 gap-2 sm:gap-3">
                        {loading ? (
                            Array.from({ length: 9 }).map((_, i) => (
                                <div key={i} className="bg-white dark:bg-gray-800 p-2 sm:p-3 rounded-xl border border-gray-200 dark:border-gray-700 h-24 sm:h-32 animate-pulse">
                                    <div className="h-3 sm:h-4 bg-gray-200 dark:bg-gray-700 rounded w-3/4 mb-2"></div>
                                    <div className="h-2 sm:h-3 bg-gray-200 dark:bg-gray-700 rounded w-1/2"></div>
                                    <div className="mt-auto flex justify-between items-end pt-4">
                                        <div className="h-3 sm:h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/3"></div>
                                        <div className="h-3 sm:h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/4"></div>
                                    </div>
                                </div>
                            ))
                        ) : (
                            products.map((product: Product) => (
                                <button
                                    key={product.id}
                                    onClick={() => onAddToCart(product)}
                                    disabled={product.stock_quantity <= 0}
                                    className={`group bg-white dark:bg-gray-800 p-2 sm:p-3 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm hover:border-blue-500 hover:shadow-md transition-all text-left flex flex-col h-24 sm:h-32 ${product.stock_quantity <= 0 ? 'opacity-60 grayscale' : 'active:scale-95'
                                        }`}
                                >
                                    <div className="flex-1 min-w-0">
                                        <h3 className="font-semibold text-gray-900 dark:text-gray-100 text-[10px] sm:text-sm line-clamp-2 leading-tight">
                                            {product.name}
                                        </h3>
                                    </div>
                                    <div className="mt-1 sm:mt-2 flex justify-between items-end">
                                        <span className="font-bold text-blue-600 dark:text-blue-400 text-xs sm:text-sm">
                                            {formatCurrency(product.sell_price)}
                                        </span>
                                        <span className={`text-[8px] sm:text-[10px] px-1 sm:px-1.5 py-0.5 rounded font-medium ${product.stock_quantity > 0
                                            ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                                            : 'bg-red-100 text-red-700'
                                            }`}>
                                            {product.stock_quantity}
                                        </span>
                                    </div>
                                </button>
                            ))
                        )}
                        {!loading && products.length === 0 && (
                            <div className="col-span-full py-10 text-center text-gray-400 text-sm">
                                Товары не найдены
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
