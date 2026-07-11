import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./pages/LoginPage', () => ({
  LoginPage: () => <div>login-page</div>,
}));
vi.mock('./pages/CashierShell', () => ({
  CashierShell: () => <div>cashier-shell</div>,
}));
vi.mock('./pages/PinSetupPage', () => ({ PinSetupPage: () => null }));
vi.mock('./pages/PinUnlockPage', () => ({ PinUnlockPage: () => null }));
vi.mock('./pages/HistoryPage', () => ({ HistoryPage: () => null }));
vi.mock('./pages/CustomersPage', () => ({ CustomersPage: () => null }));
vi.mock('./pages/SettingsPage', () => ({ SettingsPage: () => null }));
vi.mock('./components/UpdateBanner', () => ({ UpdateBanner: () => null }));

import App from './App';

describe('startup routing', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/');
  });

  it('enters CashierShell from the Tauri root URL so persisted PIN state is restored', async () => {
    render(<App />);

    expect(await screen.findByText('cashier-shell')).toBeInTheDocument();
    expect(screen.queryByText('login-page')).not.toBeInTheDocument();
  });
});
