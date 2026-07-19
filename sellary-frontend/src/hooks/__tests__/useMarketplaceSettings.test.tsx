import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactNode } from 'react';

import { queryKeys, useMarketplaceSettings } from '../useQueries';
import * as api from '@/lib/api';
import { useAuthStore } from '@/lib/store';

vi.mock('@/lib/api', () => ({
  companyApi: {
    getMarketplace: vi.fn(),
  },
}));

let mockServerReachable = true;
const TEST_COMPANY_ID = 101;

vi.mock('@/providers/ServerHealthProvider', () => ({
  useServerHealth: () => ({
    isServerReachable: mockServerReachable,
    isNavigatorOnline: true,
    isChecking: false,
  }),
  ServerHealthProvider: ({ children }: { children: any }) => children,
}));

const createMockAxiosResponse = <T,>(data: T) => ({
  data,
  status: 200,
  statusText: 'OK',
  headers: {},
  config: {} as any,
});

const seedAuth = (companyId: number | null = TEST_COMPANY_ID) => {
  useAuthStore.setState({
    user: null as any,
    companies: [],
    currentCompany: companyId
      ? ({ id: companyId, name: 'Acme', slug: 'acme', is_active: true, role: 'admin', is_default: true } as any)
      : null,
    loginToken: null,
    accessToken: companyId ? 'token' : null,
    isAuthenticated: companyId !== null,
  });
};

const createWrapper = (reachable = true, companyId: number | null = TEST_COMPANY_ID) => {
  mockServerReachable = reachable;
  seedAuth(companyId);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  Wrapper.displayName = 'TestWrapper';
  return Wrapper;
};

beforeEach(() => {
  vi.clearAllMocks();
  seedAuth(null);
});

describe('useMarketplaceSettings', () => {
  it('fetches storefront settings when server is reachable', async () => {
    const settings = {
      is_marketplace_enabled: true,
      logo_url: null,
      marketplace_description: 'Магазин',
      supports_delivery: true,
      supports_pickup: false,
    };
    vi.mocked(api.companyApi.getMarketplace).mockResolvedValue(
      createMockAxiosResponse(settings),
    );

    const { result } = renderHook(() => useMarketplaceSettings(), {
      wrapper: createWrapper(true),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.companyApi.getMarketplace).toHaveBeenCalled();
    expect(result.current.data).toEqual(settings);
    expect(queryKeys.marketplaceSettings(TEST_COMPANY_ID)).toEqual([
      'marketplaceSettings',
      TEST_COMPANY_ID,
    ]);
  });

  it('does not fetch when the server is unreachable', () => {
    renderHook(() => useMarketplaceSettings(), { wrapper: createWrapper(false) });
    expect(api.companyApi.getMarketplace).not.toHaveBeenCalled();
  });
});
