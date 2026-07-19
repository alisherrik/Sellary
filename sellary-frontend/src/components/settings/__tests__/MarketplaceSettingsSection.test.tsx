import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { companyApi } from '@/lib/api';
import { useMarketplaceSettings } from '@/hooks/useQueries';
import MarketplaceSettingsSection from '../MarketplaceSettingsSection';

vi.mock('@/hooks/useQueries', () => ({
  useMarketplaceSettings: vi.fn(),
  queryKeys: { marketplaceSettings: (id: number | null) => ['marketplaceSettings', id ?? 'no-company'] },
}));

vi.mock('@/lib/api', () => ({
  companyApi: {
    updateMarketplace: vi.fn().mockResolvedValue({ data: {} }),
  },
}));

vi.mock('react-hot-toast', () => ({
  default: { error: vi.fn(), success: vi.fn() },
}));

vi.mock('@/lib/store', () => ({
  useAuthStore: vi.fn((selector: (state: any) => any) =>
    selector({ currentCompany: { id: 1 } }),
  ),
}));

const settings = {
  is_marketplace_enabled: false,
  logo_url: null,
  marketplace_description: null,
  supports_delivery: true,
  supports_pickup: true,
};

const renderSection = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MarketplaceSettingsSection />
    </QueryClientProvider>,
  );
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useMarketplaceSettings).mockReturnValue({
    data: settings,
    isLoading: false,
  } as any);
});

describe('MarketplaceSettingsSection', () => {
  it('hydrates the form from the loaded settings', () => {
    renderSection();
    expect(
      screen.getByRole('switch', { name: 'Включить маркетплейс' }),
    ).toHaveAttribute('aria-checked', 'false');
    expect(
      screen.getByRole('switch', { name: 'Доставка' }),
    ).toHaveAttribute('aria-checked', 'true');
  });

  it('saves only the changed fields', async () => {
    const user = userEvent.setup();
    renderSection();

    await user.click(screen.getByRole('switch', { name: 'Включить маркетплейс' }));
    await user.type(
      screen.getByLabelText('Описание магазина'),
      'Лучший магазин',
    );
    await user.click(screen.getByRole('switch', { name: 'Самовывоз' }));

    await user.click(screen.getByRole('button', { name: 'Сохранить' }));

    await waitFor(() => {
      expect(companyApi.updateMarketplace).toHaveBeenCalledWith({
        is_marketplace_enabled: true,
        marketplace_description: 'Лучший магазин',
        supports_pickup: false,
      });
    });
  });
});
