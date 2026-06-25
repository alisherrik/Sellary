import { create } from 'zustand';
import { createJSONStorage, persist, StateStorage } from 'zustand/middleware';

export type CurrencyCode = 'USD' | 'UZS' | 'RUB' | 'TJS';

interface Currency {
    code: CurrencyCode;
    symbol: string;
    locale: string;
    name: string;
}

export const CURRENCIES: Record<CurrencyCode, Currency> = {
    USD: { code: 'USD', symbol: '$', locale: 'en-US', name: 'Доллар США ($)' },
    UZS: { code: 'UZS', symbol: 'сум', locale: 'uz-UZ', name: 'Узбекский сум (UZS)' },
    RUB: { code: 'RUB', symbol: '₽', locale: 'ru-RU', name: 'Российский рубль (₽)' },
    TJS: { code: 'TJS', symbol: 'с.', locale: 'tj-TJ', name: 'Таджикский сомони (с.)' },
};

interface SettingsState {
    currency: CurrencyCode;
    setCurrency: (code: CurrencyCode) => void;
    // Whether to print a receipt after each completed sale. Default off: the
    // browser can't silently target a chosen printer, so receipts (and the
    // unwanted "Save as PDF" dialog) are suppressed until the shop explicitly
    // enables printing in Settings. See settings page helper text for the
    // one-time Windows-default-printer + Chrome --kiosk-printing setup.
    receiptPrintEnabled: boolean;
    setReceiptPrintEnabled: (enabled: boolean) => void;
}

const noopStorage: StateStorage = {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
};

export const useSettingsStore = create<SettingsState>()(
    persist(
        (set) => ({
            currency: 'UZS',
            setCurrency: (code) => set({ currency: code }),
            receiptPrintEnabled: false,
            setReceiptPrintEnabled: (enabled) => set({ receiptPrintEnabled: enabled }),
        }),
        {
            name: 'settings-storage',
            storage: createJSONStorage(() => (typeof window !== 'undefined' ? localStorage : noopStorage)),
        }
    )
);
