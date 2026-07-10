import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
    queryKeys,
    useDashboard,
    useProducts,
    useSales,
    useInfiniteSales,
    useSaleSearchSuggestions,
    useSuppliers,
    usePurchaseOrders,
    usePurchaseOrder,
    useDailySales,
    useProfit,
    useTopProducts
} from '../useQueries';
import * as api from '@/lib/api';
import { useAuthStore } from '@/lib/store';

/**
 * UNIT TESTS FOR USEQUERIES HOOK
 *
 * Tests dual-source query behavior, enabled/disabled states,
 * and prevention of request loops.
 */

// Mock the API
vi.mock('@/lib/api', () => ({
    reportsApi: {
        getDashboard: vi.fn(),
        getDailySales: vi.fn(),
        getProfit: vi.fn(),
        getTopProducts: vi.fn(),
    },
    productsApi: {
        getAll: vi.fn(),
    },
    salesApi: {
        getAll: vi.fn(),
        getSearchSuggestions: vi.fn(),
    },
    suppliersApi: {
        getAll: vi.fn(),
    },
    purchaseOrdersApi: {
        getAll: vi.fn(),
        getById: vi.fn(),
    },
}));

// Helper to create a mock Axios response
const createMockAxiosResponse = <T,>(data: T) => ({
    data,
    status: 200,
    statusText: 'OK',
    headers: {},
    config: {} as any,
});

import { ReactNode } from 'react';

// Mock the actual ServerHealthProvider hook
// Use a module-level variable to control the mock return value
let mockServerReachable = true;
const TEST_COMPANY_ID = 101;
const TEST_COMPANY = {
    id: TEST_COMPANY_ID,
    name: 'Acme Retail',
    slug: 'acme-retail',
    is_active: true,
    role: 'admin' as const,
    is_default: true,
};
const TEST_USER = {
    id: 1,
    username: 'owner',
    email: 'owner@example.com',
    is_active: true,
    created_at: '2026-03-18T00:00:00Z',
};

const mockUseServerHealth = vi.fn(() => ({
    isServerReachable: mockServerReachable,
    isNavigatorOnline: true,
    isChecking: false,
}));

vi.mock('@/providers/ServerHealthProvider', () => ({
    useServerHealth: () => mockUseServerHealth(),
    ServerHealthProvider: ({ children }: { children: any }) => children,
}));

const resetAuthState = () => {
    if (typeof window !== 'undefined') {
        window.localStorage.clear();
    }

    useAuthStore.setState({
        user: null,
        companies: [],
        currentCompany: null,
        loginToken: null,
        accessToken: null,
        isAuthenticated: false,
    });
};

const seedAuthState = (companyId: number | null = TEST_COMPANY_ID) => {
    if (companyId === null) {
        resetAuthState();
        return;
    }

    const currentCompany = {
        ...TEST_COMPANY,
        id: companyId,
        slug: `company-${companyId}`,
    };

    useAuthStore.setState({
        user: TEST_USER,
        companies: [currentCompany],
        currentCompany,
        loginToken: null,
        accessToken: 'test-access-token',
        isAuthenticated: true,
    });
};

const createWrapper = (isServerReachable: boolean = true, companyId: number | null = TEST_COMPANY_ID) => {
    // Update the module-level variable and set mock implementation
    mockServerReachable = isServerReachable;
    seedAuthState(companyId);

    // Use mockImplementation instead of mockReturnValue for more dynamic behavior
    mockUseServerHealth.mockImplementation(() => ({
        isServerReachable: mockServerReachable,
        isNavigatorOnline: true,
        isChecking: false,
    }));

    const queryClient = new QueryClient({
        defaultOptions: {
            queries: {
                retry: false,
                staleTime: 1000,
            },
        },
    });

    const Wrapper = ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>
            {children}
        </QueryClientProvider>
    );
    Wrapper.displayName = 'TestWrapper';
    return Wrapper;
};

beforeEach(() => {
    vi.clearAllMocks();
    resetAuthState();
});

describe('useQueries - Query Keys', () => {
    it('should have consistent query keys for dashboard', () => {
        expect(queryKeys.dashboard(TEST_COMPANY_ID)).toEqual(['dashboard', TEST_COMPANY_ID]);
    });

    it('should have consistent query keys for products with params', () => {
        expect(queryKeys.products(TEST_COMPANY_ID, { limit: 10 })).toEqual(['products', TEST_COMPANY_ID, { limit: 10 }]);
        expect(queryKeys.products(null)).toEqual(['products', 'no-company', undefined]);
    });

    it('should have consistent query keys for sales with params', () => {
        expect(queryKeys.sales(TEST_COMPANY_ID, { limit: 20 })).toEqual(['sales', TEST_COMPANY_ID, { limit: 20 }]);
    });

    it('should have consistent query keys for reports', () => {
        expect(queryKeys.dailySales(TEST_COMPANY_ID, 7)).toEqual(['dailySales', TEST_COMPANY_ID, 7]);
        expect(queryKeys.profit(TEST_COMPANY_ID, 30)).toEqual(['profit', TEST_COMPANY_ID, 30]);
        expect(queryKeys.topProducts(TEST_COMPANY_ID, 7, 10)).toEqual(['topProducts', TEST_COMPANY_ID, 7, 10]);
    });
});

describe('useDashboard', () => {
    it('should fetch dashboard data when server is reachable', async () => {
        const mockData = { totalSales: 1000, totalOrders: 50 };
        vi.mocked(api.reportsApi.getDashboard).mockResolvedValue(createMockAxiosResponse(mockData));

        const { result } = renderHook(() => useDashboard(), {
            wrapper: createWrapper(true),
        });

        await waitFor(() => {
            expect(result.current.isSuccess).toBe(true);
        });

        expect(api.reportsApi.getDashboard).toHaveBeenCalled();
        expect(result.current.data).toEqual(mockData);
    });

    it('should NOT fetch dashboard data when server is unreachable', () => {
        vi.mocked(api.reportsApi.getDashboard).mockResolvedValue(createMockAxiosResponse({}));

        renderHook(() => useDashboard(), {
            wrapper: createWrapper(false),
        });

        // Should not fetch
        expect(api.reportsApi.getDashboard).not.toHaveBeenCalled();
    });
});

describe('useProducts', () => {
    it('should fetch products when server is reachable', async () => {
        const mockProducts = [
            { id: 1, name: 'Product 1', price: 10 },
            { id: 2, name: 'Product 2', price: 20 },
        ];
        vi.mocked(api.productsApi.getAll).mockResolvedValue(createMockAxiosResponse(mockProducts));

        const { result } = renderHook(() => useProducts({ limit: 100 }), {
            wrapper: createWrapper(true),
        });

        await waitFor(() => {
            expect(result.current.isSuccess).toBe(true);
        });

        expect(api.productsApi.getAll).toHaveBeenCalledWith({ limit: 100 });
        expect(result.current.data).toEqual(mockProducts);
    });

    it('should NOT fetch products when server is unreachable', () => {
        renderHook(() => useProducts(), {
            wrapper: createWrapper(false),
        });

        expect(api.productsApi.getAll).not.toHaveBeenCalled();
    });

    it('should respect enabled option from props', () => {
        renderHook(() => useProducts({}, { enabled: false }), {
            wrapper: createWrapper(true),
        });

        expect(api.productsApi.getAll).not.toHaveBeenCalled();
    });
});

describe('useSales', () => {
    it('should fetch sales when server is reachable', async () => {
        const mockSales = [
            { id: 1, total: 100 },
            { id: 2, total: 200 },
        ];
        vi.mocked(api.salesApi.getAll).mockResolvedValue(createMockAxiosResponse(mockSales));

        const { result } = renderHook(() => useSales({ limit: 100 }), {
            wrapper: createWrapper(true),
        });

        await waitFor(() => {
            expect(result.current.isSuccess).toBe(true);
        });

        expect(api.salesApi.getAll).toHaveBeenCalledWith({ limit: 100 });
        expect(result.current.data).toEqual(mockSales);
    });

    it('CRITICAL: should NOT fetch sales when offline (prevents request loop)', () => {
        renderHook(() => useSales(), {
            wrapper: createWrapper(false),
        });

        expect(api.salesApi.getAll).not.toHaveBeenCalled();
    });
});

describe('useInfiniteSales', () => {
    const pageResponse = (data: any[], total: number) => ({
        data,
        status: 200,
        statusText: 'OK',
        headers: { 'x-total-count': String(total) },
        config: {} as any,
    });

    it('accumulates pages and exposes the full total so older sales stay reachable', async () => {
        const all = [{ id: 1 }, { id: 2 }, { id: 3 }];
        vi.mocked(api.salesApi.getAll).mockImplementation((params?: any) => {
            const skip = params?.skip ?? 0;
            return Promise.resolve(pageResponse(all.slice(skip, skip + 2), all.length)) as any;
        });

        const { result } = renderHook(() => useInfiniteSales({ limit: 2 }), {
            wrapper: createWrapper(true),
        });

        await waitFor(() => expect(result.current.isLoading).toBe(false));

        expect(result.current.sales).toEqual([{ id: 1 }, { id: 2 }]);
        expect(result.current.total).toBe(3);
        expect(result.current.hasMore).toBe(true);

        result.current.loadMore();

        await waitFor(() =>
            expect(result.current.sales).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]),
        );
        expect(result.current.hasMore).toBe(false);
        expect(api.salesApi.getAll).toHaveBeenLastCalledWith(
            expect.objectContaining({ skip: 2, limit: 2 }),
        );
    });

    it('CRITICAL: does not fetch when the server is unreachable', () => {
        renderHook(() => useInfiniteSales(), { wrapper: createWrapper(false) });
        expect(api.salesApi.getAll).not.toHaveBeenCalled();
    });
});

describe('useSaleSearchSuggestions', () => {
    it('fetches tenant-scoped suggestions for two or more characters', async () => {
        const suggestions = [
            { kind: 'product', label: 'Кола', value: 'Кола', score: 89 },
        ];
        vi.mocked(api.salesApi.getSearchSuggestions).mockResolvedValue(
            createMockAxiosResponse(suggestions),
        );

        const { result } = renderHook(() => useSaleSearchSuggestions('колаа'), {
            wrapper: createWrapper(true),
        });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(api.salesApi.getSearchSuggestions).toHaveBeenCalledWith('колаа', 8);
        expect(result.current.data).toEqual(suggestions);
        expect(queryKeys.saleSearchSuggestions(TEST_COMPANY_ID, 'колаа')).toEqual([
            'saleSearchSuggestions',
            TEST_COMPANY_ID,
            'колаа',
        ]);
    });

    it('does not fetch suggestions below two characters', () => {
        renderHook(() => useSaleSearchSuggestions('к'), {
            wrapper: createWrapper(true),
        });

        expect(api.salesApi.getSearchSuggestions).not.toHaveBeenCalled();
    });

    it('does not fetch suggestions while offline', () => {
        renderHook(() => useSaleSearchSuggestions('колаа'), {
            wrapper: createWrapper(false),
        });

        expect(api.salesApi.getSearchSuggestions).not.toHaveBeenCalled();
    });
});

describe('useSuppliers', () => {
    it('should fetch suppliers when server is reachable', async () => {
        const mockSuppliers = [{ id: 1, name: 'Supplier 1' }];
        vi.mocked(api.suppliersApi.getAll).mockResolvedValue(createMockAxiosResponse(mockSuppliers));

        const { result } = renderHook(() => useSuppliers(), {
            wrapper: createWrapper(true),
        });

        await waitFor(() => {
            expect(result.current.isSuccess).toBe(true);
        });

        expect(api.suppliersApi.getAll).toHaveBeenCalled();
    });

    it('should NOT fetch suppliers when server is unreachable', () => {
        renderHook(() => useSuppliers(), {
            wrapper: createWrapper(false),
        });

        expect(api.suppliersApi.getAll).not.toHaveBeenCalled();
    });
});

describe('usePurchaseOrders', () => {
    it('should fetch purchase orders when server is reachable', async () => {
        const mockOrders = [{ id: 1, supplierId: 1 }];
        vi.mocked(api.purchaseOrdersApi.getAll).mockResolvedValue(createMockAxiosResponse(mockOrders));

        const { result } = renderHook(() => usePurchaseOrders(), {
            wrapper: createWrapper(true),
        });

        await waitFor(() => {
            expect(result.current.isSuccess).toBe(true);
        });

        expect(api.purchaseOrdersApi.getAll).toHaveBeenCalled();
    });

    it('should NOT fetch purchase orders when server is unreachable', () => {
        renderHook(() => usePurchaseOrders(), {
            wrapper: createWrapper(false),
        });

        expect(api.purchaseOrdersApi.getAll).not.toHaveBeenCalled();
    });
});

describe('usePurchaseOrder', () => {
    it('loads a company-scoped purchase order detail', async () => {
        const purchaseOrder = { id: 42, supplier_id: 7, items: [] };
        vi.mocked(api.purchaseOrdersApi.getById).mockResolvedValue(
            createMockAxiosResponse(purchaseOrder),
        );

        const { result } = renderHook(() => usePurchaseOrder(42), {
            wrapper: createWrapper(true),
        });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        expect(queryKeys.purchaseOrder(TEST_COMPANY_ID, 42)).toEqual([
            'purchaseOrder',
            TEST_COMPANY_ID,
            42,
        ]);
        expect(api.purchaseOrdersApi.getById).toHaveBeenCalledWith(42);
        expect(result.current.data).toEqual(purchaseOrder);
    });
});

describe('Report Hooks (useDailySales, useProfit, useTopProducts)', () => {
    it('should fetch daily sales when server is reachable', async () => {
        const mockData = { dates: ['2024-01-01'], totals: [1000] };
        vi.mocked(api.reportsApi.getDailySales).mockResolvedValue(createMockAxiosResponse(mockData));

        const { result } = renderHook(() => useDailySales(7), {
            wrapper: createWrapper(true),
        });

        await waitFor(() => {
            expect(result.current.isSuccess).toBe(true);
        });

        expect(api.reportsApi.getDailySales).toHaveBeenCalledWith({ days: 7 });
    });

    it('should fetch profit report when server is reachable', async () => {
        const mockData = { totalProfit: 5000 };
        vi.mocked(api.reportsApi.getProfit).mockResolvedValue(createMockAxiosResponse(mockData));

        const { result } = renderHook(() => useProfit(30), {
            wrapper: createWrapper(true),
        });

        await waitFor(() => {
            expect(result.current.isSuccess).toBe(true);
        });

        expect(api.reportsApi.getProfit).toHaveBeenCalledWith({ days: 30 });
    });

    it('should fetch top products when server is reachable', async () => {
        const mockData = { products: [{ id: 1, name: 'Product 1', quantity: 10 }] };
        vi.mocked(api.reportsApi.getTopProducts).mockResolvedValue(createMockAxiosResponse(mockData));

        const { result } = renderHook(() => useTopProducts(7, 10), {
            wrapper: createWrapper(true),
        });

        await waitFor(() => {
            expect(result.current.isSuccess).toBe(true);
        });

        expect(api.reportsApi.getTopProducts).toHaveBeenCalledWith({ days: 7, limit: 10 });
    });

    it('should NOT fetch reports when server is unreachable', () => {
        renderHook(() => useDailySales(7), { wrapper: createWrapper(false) });
        renderHook(() => useProfit(30), { wrapper: createWrapper(false) });
        renderHook(() => useTopProducts(7, 10), { wrapper: createWrapper(false) });

        expect(api.reportsApi.getDailySales).not.toHaveBeenCalled();
        expect(api.reportsApi.getProfit).not.toHaveBeenCalled();
        expect(api.reportsApi.getTopProducts).not.toHaveBeenCalled();
    });
});

describe('Request Loop Prevention', () => {
    it('CRITICAL: should prevent all API requests when offline', () => {
        renderHook(() => useDashboard(), { wrapper: createWrapper(false) });
        renderHook(() => useProducts(), { wrapper: createWrapper(false) });
        renderHook(() => useSales(), { wrapper: createWrapper(false) });
        renderHook(() => useSuppliers(), { wrapper: createWrapper(false) });
        renderHook(() => usePurchaseOrders(), { wrapper: createWrapper(false) });
        renderHook(() => useDailySales(7), { wrapper: createWrapper(false) });
        renderHook(() => useProfit(30), { wrapper: createWrapper(false) });
        renderHook(() => useTopProducts(7, 10), { wrapper: createWrapper(false) });

        expect(api.reportsApi.getDashboard).not.toHaveBeenCalled();
        expect(api.productsApi.getAll).not.toHaveBeenCalled();
        expect(api.salesApi.getAll).not.toHaveBeenCalled();
        expect(api.suppliersApi.getAll).not.toHaveBeenCalled();
        expect(api.purchaseOrdersApi.getAll).not.toHaveBeenCalled();
        expect(api.reportsApi.getDailySales).not.toHaveBeenCalled();
        expect(api.reportsApi.getProfit).not.toHaveBeenCalled();
        expect(api.reportsApi.getTopProducts).not.toHaveBeenCalled();
    });

    it('should make exactly ONE request per query when online', async () => {
        const mockSales: any[] = [];
        vi.mocked(api.salesApi.getAll).mockResolvedValue(createMockAxiosResponse(mockSales));

        const { result } = renderHook(() => useSales(), {
            wrapper: createWrapper(true),
        });

        await waitFor(() => {
            expect(api.salesApi.getAll).toHaveBeenCalledTimes(1);
        });
    });
});
