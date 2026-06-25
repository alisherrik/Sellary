import { beforeEach, describe, expect, it } from 'vitest';

import { useSettingsStore } from '@/store/settingsStore';

describe('settingsStore receipt printing', () => {
  beforeEach(() => {
    localStorage.clear();
    // Reset to the store's documented defaults between tests.
    useSettingsStore.setState({ currency: 'UZS', receiptPrintEnabled: false });
  });

  it('defaults receipt printing to off', () => {
    expect(useSettingsStore.getState().receiptPrintEnabled).toBe(false);
  });

  it('enables and disables receipt printing', () => {
    useSettingsStore.getState().setReceiptPrintEnabled(true);
    expect(useSettingsStore.getState().receiptPrintEnabled).toBe(true);

    useSettingsStore.getState().setReceiptPrintEnabled(false);
    expect(useSettingsStore.getState().receiptPrintEnabled).toBe(false);
  });

  it('persists the flag to localStorage', () => {
    useSettingsStore.getState().setReceiptPrintEnabled(true);
    const persisted = JSON.parse(localStorage.getItem('settings-storage') ?? '{}');
    expect(persisted.state.receiptPrintEnabled).toBe(true);
  });
});
