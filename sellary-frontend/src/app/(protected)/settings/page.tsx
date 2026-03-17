'use client';


import { useSettingsStore, CURRENCIES, CurrencyCode } from '@/store/settingsStore';
import { CheckCircleIcon } from '@heroicons/react/24/solid';
import { BanknotesIcon, Cog6ToothIcon, CloudArrowUpIcon } from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import { useOfflineSync } from '@/hooks/useOfflineSync';
import SyncControls from '@/components/settings/SyncControls';

export default function SettingsPage() {
    const { currency, setCurrency } = useSettingsStore();
    const { processQueue, queueLength, isSyncing } = useOfflineSync();

    const handleCurrencyChange = (code: CurrencyCode) => {
        setCurrency(code);
        toast.success(`Валюта изменена на ${CURRENCIES[code].name}`);
    };

    return (

        <div className="max-w-4xl mx-auto pb-20">
            <div className="flex items-center gap-3 mb-6">
                <div className="p-2 bg-blue-100 rounded-lg">
                    <Cog6ToothIcon className="w-6 h-6 text-blue-600" />
                </div>
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">Настройки</h1>
                    <p className="text-sm text-gray-500">Управление параметрами системы</p>
                </div>
            </div>

            <section className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                <div className="p-4 sm:p-6 border-b border-gray-100">
                    <div className="flex items-center gap-2">
                        <BanknotesIcon className="w-5 h-5 text-gray-500" />
                        <h2 className="text-lg font-semibold text-gray-900">Валюта</h2>
                    </div>
                    <p className="text-sm text-gray-500 mt-1">
                        Выберите основную валюту для отображения цен и отчетов
                    </p>
                </div>

                <div className="p-4 sm:p-6">
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                        {(Object.values(CURRENCIES) as any[]).map((curr) => {
                            const isSelected = currency === curr.code;
                            return (
                                <button
                                    key={curr.code}
                                    onClick={() => handleCurrencyChange(curr.code)}
                                    className={`
                      relative flex flex-col items-start p-4 rounded-xl border-2 transition-all
                      ${isSelected
                                            ? 'border-blue-500 bg-blue-50'
                                            : 'border-gray-200 bg-white hover:border-blue-200 hover:bg-gray-50'
                                        }
                    `}
                                >
                                    {isSelected && (
                                        <div className="absolute top-2 right-2">
                                            <CheckCircleIcon className="w-5 h-5 text-blue-500" />
                                        </div>
                                    )}

                                    <span className={`text-2xl mb-2 ${isSelected ? 'text-blue-600' : 'text-gray-400'}`}>
                                        {curr.symbol}
                                    </span>

                                    <span className="font-semibold text-gray-900 text-sm">
                                        {curr.code}
                                    </span>

                                    <span className="text-xs text-gray-500 mt-1 text-left">
                                        {curr.name}
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                </div>
            </section>

            <div className="mt-6">
                <SyncControls />
            </div>

            {/* Future settings sections can go here */}
            <div className="mt-8 bg-blue-50 rounded-xl p-4 sm:p-6 border border-blue-100">
                <p className="text-sm text-blue-800 text-center">
                    💡 Выбранная валюта будет применена ко всем ценам, отчетам и чекам в системе.
                </p>
            </div>
        </div >

    );
}
