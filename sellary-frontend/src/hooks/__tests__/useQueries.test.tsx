import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { QueryCacheNotifyEvent } from '@tanstack/react-query';
import {
    queryKeys,
    useDashboard,
    useProducts,
    useSales,
    useSuppliers,
    usePurchaseOrders,
    useDailySales,
    useProfit,
    useTopProducts
} from '../useQueries';
import * as api from '@/lib/api';

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
    },
    suppliersApi: {
        getAll: vi.fn(),
    },
    purchaseOrdersApi: {
        getAll: vi.fn(),
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

// Mock ServerHealthProvider with a test provider that can control the state
import { ReactNode } from 'react';
import { createContext, useContext } from 'react';

interface TestHealthContextType {
    isServerReachable: boolean;
    isNavigatorOnline: boolean;
    isChecking: boolean;
}

const TestHealthContext = createContext<TestHealthContextType>({
    isServerReachable: false,
    isNavigatorOnline: true,
    isChecking: false,
});

// Export for use in mock
export { TestHealthContext };

// Use useContext to get the actual context value
const useTestServerHealth = () => useContext(TestHealthContext);

function TestServerHealthProvider({
    children,
    isServerReachable = true,
}: {
    children: ReactNode;
    isServerReachable?: boolean;
}) {
    return (
        <TestHealthContext.Provider
            value={{
                isServerReachable: isServerReachable ?? true,
                isNavigatorOnline: true,
                isChecking: false,
            }}
        >
            {children}
        </TestHealthContext.Provider>
    );
}

// Mock the actual ServerHealthProvider hook
// Use a module-level variable to control the mock return value
let mockServerReachable = true;

const mockUseServerHealth = vi.fn(() => ({
    isServerReachable: mockServerReachable,
    isNavigatorOnline: true,
    isChecking: false,
}));

vi.mock('@/providers/ServerHealthProvider', () => ({
    useServerHealth: () => mockUseServerHealth(),
    ServerHealthProvider: ({ children }: { children: any }) => children,
}));

const createWrapper = (isServerReachable: boolean = true) => {
    // Update the module-level variable and set mock implementation
    mockServerReachable = isServerReachable;

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
            <TestServerHealthProvider isServerReachable={isServerReachable}>
                {children}
            </TestServerHealthProvider>
        </QueryClientProvider>
    );
    Wrapper.displayName = 'TestWrapper';
    return Wrapper;
};

beforeEach(() => {
    vi.clearAllMocks();
    mockServerReachable = true;
    mockUseServerHealth.mockImplementation(() => ({
        isServerReachable: mockServerReachable,
        isNavigatorOnline: true,
        isChecking: false,
    }));
});

describe('useQueries - Query Keys', () => {
    it('should have consistent query keys for dashboard', () => {
        expect(queryKeys.dashboard).toEqual(['dashboard']);
    });

    it('should have consistent query keys for products with params', () => {
        expect(queryKeys.products({ limit: 10 })).toEqual(['products', { limit: 10 }]);
        expect(queryKeys.products()).toEqual(['products', undefined]);
    });

    it('should have consistent query keys for sales with params', () => {
        expect(queryKeys.sales({ limit: 20 })).toEqual(['sales', { limit: 20 }]);
    });

    it('should have consistent query keys for reports', () => {
        expect(queryKeys.dailySales(7)).toEqual(['dailySales', 7]);
        expect(queryKeys.profit(30)).toEqual(['profit', 30]);
        expect(queryKeys.topProducts(7, 10)).toEqual(['topProducts', 7, 10]);
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
