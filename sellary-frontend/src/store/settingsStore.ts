import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type CurrencyCode = 'USD' | 'UZS' | 'RUB' | 'TJS';

interface Currency {
    code: CurrencyCode;
    symbol: string;
    locale: string;
    name: string;
}

export const CURRENCIES: Record<CurrencyCode, Currency> = {
    USD: { code: 'USD', symbol: '$', locale: 'en-US', name: 'Доллар США ($)' },
    UZS: { code: 'UZS', symbol: 'сўм', locale: 'uz-UZ', name: 'Узбекский Сум (UZS)' },
    RUB: { code: 'RUB', symbol: '₽', locale: 'ru-RU', name: 'Российский Рубль (₽)' },
    TJS: { code: 'TJS', symbol: 'с.', locale: 'tj-TJ', name: 'Таджикский Сомони (c.)' }, // Custom locale/symbol handling might be needed if standard fails
};

interface SettingsState {
    currency: CurrencyCode;
    setCurrency: (code: CurrencyCode) => void;
}

export const useSettingsStore = create<SettingsState>()(
    persist(
        (set) => ({
            currency: 'UZS', // Default to UZS as per context (Alisher / StartUps)
            setCurrency: (code) => set({ currency: code }),
        }),
        {
            name: 'settings-storage',
        }
    )
);
