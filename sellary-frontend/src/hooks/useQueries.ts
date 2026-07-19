import { useQuery, useInfiniteQuery, keepPreviousData, useQueryClient, UseQueryOptions } from '@tanstack/react-query';
import { reportsApi, productsApi, salesApi, shiftsApi, suppliersApi, purchaseOrdersApi, customersApi, companyApi } from '@/lib/api';
import { useServerHealth } from '@/providers/ServerHealthProvider';
import { useAuthStore } from '@/lib/store';
import {
    Product, Sale, SaleSearchSuggestion, SalesSummary, Supplier, PurchaseOrder, Customer,
    CustomerLedgerResponse, DailySalesReport, ProfitReport, TopProductsReport,
    CashShift, CashShiftDetail, MarketplaceSettings
} from '@/lib/types';

const tenantKey = (companyId: number | null) => companyId ?? 'no-company';

// Query Keys
export const queryKeys = {
    dashboard: (companyId: number | null) => ['dashboard', tenantKey(companyId)] as const,
    products: (companyId: number | null, params?: any) => ['products', tenantKey(companyId), params] as const,
    sales: (companyId: number | null, params?: any) => ['sales', tenantKey(companyId), params] as const,
    // Nested under 'sales' on purpose: invalidateQueries({queryKey: ['sales']})
    // after a void or a return must refresh the totals too, or the cards would
    // keep showing figures for a sale that no longer counts.
    salesSummary: (companyId: number | null, params?: any) =>
        ['sales', tenantKey(companyId), 'summary', params] as const,
    saleSearchSuggestions: (companyId: number | null, query: string) =>
        ['saleSearchSuggestions', tenantKey(companyId), query] as const,
    suppliers: (companyId: number | null, params?: any) => ['suppliers', tenantKey(companyId), params] as const,
    purchaseOrders: (companyId: number | null, params?: any) => ['purchaseOrders', tenantKey(companyId), params] as const,
    purchaseOrder: (companyId: number | null, id: number) => ['purchaseOrder', tenantKey(companyId), id] as const,
    customers: (companyId: number | null, params?: any) => ['customers', tenantKey(companyId), params] as const,
    customerLedger: (companyId: number | null, id: number | null) => ['customerLedger', tenantKey(companyId), id] as const,
    currentShift: (companyId: number | null) => ['currentShift', tenantKey(companyId)] as const,
    shifts: (companyId: number | null, params?: any) => ['shifts', tenantKey(companyId), params] as const,
    shift: (companyId: number | null, id: number) => ['shift', tenantKey(companyId), id] as const,
    dailySales: (companyId: number | null, days: number) => ['dailySales', tenantKey(companyId), days] as const,
    profit: (companyId: number | null, days: number) => ['profit', tenantKey(companyId), days] as const,
    topProducts: (companyId: number | null, days: number, limit: number) => ['topProducts', tenantKey(companyId), days, limit] as const,
    marketplaceSettings: (companyId: number | null) => ['marketplaceSettings', tenantKey(companyId)] as const,
};

// --- Cash shifts ---

/** The company's open shift with live totals, or null. Drives the POS gate. */
export function useCurrentShift() {
    const { isServerReachable } = useServerHealth();
    const companyId = useAuthStore((state) => state.currentCompany?.id ?? null);
    return useQuery<CashShift | null>({
        queryKey: queryKeys.currentShift(companyId),
        queryFn: async () => {
            const response = await shiftsApi.getCurrent();
            return response.data;
        },
        enabled: isServerReachable && companyId !== null,
        staleTime: 15 * 1000,
    });
}

export function useShifts(params?: any) {
    const { isServerReachable } = useServerHealth();
    const companyId = useAuthStore((state) => state.currentCompany?.id ?? null);
    return useQuery<CashShift[]>({
        queryKey: queryKeys.shifts(companyId, params),
        queryFn: async () => {
            const response = await shiftsApi.getAll(params);
            return response.data;
        },
        placeholderData: keepPreviousData,
        enabled: isServerReachable && companyId !== null,
    });
}

export function useShift(id: number) {
    const { isServerReachable } = useServerHealth();
    const companyId = useAuthStore((state) => state.currentCompany?.id ?? null);
    return useQuery<CashShiftDetail>({
        queryKey: queryKeys.shift(companyId, id),
        queryFn: async () => {
            const response = await shiftsApi.getById(id);
            return response.data;
        },
        enabled: isServerReachable && companyId !== null && Number.isFinite(id),
    });
}

// Dashboard Hook
export function useDashboard() {
    const { isServerReachable } = useServerHealth();
    const companyId = useAuthStore((state) => state.currentCompany?.id ?? null);
    return useQuery({
        queryKey: queryKeys.dashboard(companyId),
        queryFn: async () => {
            const response = await reportsApi.getDashboard();
            return response.data;
        },
        enabled: isServerReachable && companyId !== null,
    });
}

// Products Hook
export function useProducts(params?: any, options?: Partial<UseQueryOptions<Product[]>>) {
    const { isServerReachable } = useServerHealth();
    const companyId = useAuthStore((state) => state.currentCompany?.id ?? null);
    return useQuery<Product[]>({
        queryKey: queryKeys.products(companyId, params),
        queryFn: async () => {
            const response = await productsApi.getAll(params || { limit: 100 });
            return response.data;
        },
        ...options,
        enabled: isServerReachable && companyId !== null && (options?.enabled !== false),
    });
}

// Sales Hook
export function useSales(params?: any, options?: Partial<UseQueryOptions<Sale[]>>) {
    const { isServerReachable } = useServerHealth();
    const companyId = useAuthStore((state) => state.currentCompany?.id ?? null);
    return useQuery<Sale[]>({
        queryKey: queryKeys.sales(companyId, params),
        queryFn: async () => {
            const response = await salesApi.getAll(params || { limit: 100 });
            return response.data;
        },
        ...options,
        enabled: isServerReachable && companyId !== null && (options?.enabled !== false),
    });
}

interface SalesPage {
    items: Sale[];
    total: number;
}

/**
 * Paginated sales history.
 *
 * The list endpoint caps each response at 200 rows, so a shop with more than
 * that would lose its oldest receipts from the view. This hook walks the whole
 * history page-by-page (skip/limit) and reads the tenant-wide match count from
 * the `X-Total-Count` header, so every receipt stays reachable via "load more".
 */
export function useInfiniteSales(params?: any) {
    const { isServerReachable } = useServerHealth();
    const companyId = useAuthStore((state) => state.currentCompany?.id ?? null);
    const { limit, ...filters } = params || {};
    const pageSize: number = limit ?? 50;

    const query = useInfiniteQuery<SalesPage>({
        queryKey: queryKeys.sales(companyId, params),
        queryFn: async ({ pageParam }) => {
            const response = await salesApi.getAll({ ...filters, skip: pageParam, limit: pageSize });
            const header = response.headers?.['x-total-count'];
            const total = header !== undefined ? Number(header) : Number.NaN;
            return { items: (response.data as Sale[]) ?? [], total };
        },
        initialPageParam: 0,
        getNextPageParam: (lastPage, allPages) => {
            const loaded = allPages.reduce((sum, page) => sum + page.items.length, 0);
            if (!Number.isNaN(lastPage.total)) {
                return loaded < lastPage.total ? loaded : undefined;
            }
            // No total header: keep paging while the last page came back full.
            return lastPage.items.length === pageSize ? loaded : undefined;
        },
        placeholderData: keepPreviousData,
        enabled: isServerReachable && companyId !== null,
    });

    const pages = query.data?.pages ?? [];
    const sales = pages.flatMap((page) => page.items);
    const lastTotal = pages.length ? pages[pages.length - 1].total : Number.NaN;

    return {
        sales,
        total: Number.isNaN(lastTotal) ? undefined : lastTotal,
        isLoading: query.isLoading,
        isFetching: query.isFetching,
        isFetchingNextPage: query.isFetchingNextPage,
        hasMore: Boolean(query.hasNextPage),
        loadMore: query.fetchNextPage,
        refetch: query.refetch,
    };
}

/**
 * Turnover / receipts / average-check totals for the sales history.
 *
 * Kept separate from useInfiniteSales because the two answer different
 * questions: that hook returns the page you are looking at, this one returns
 * the whole filtered history. Summing the former is what made the turnover card
 * report a fraction of the real number until you clicked "load more" enough
 * times.
 */
export function useSalesSummary(params?: any) {
    const { isServerReachable } = useServerHealth();
    const companyId = useAuthStore((state) => state.currentCompany?.id ?? null);
    // skip/limit describe the list's paging and mean nothing to a total; drop
    // them so paging never re-fetches or re-keys the summary.
    const { limit, skip, ...filters } = params || {};

    return useQuery<SalesSummary>({
        queryKey: queryKeys.salesSummary(companyId, filters),
        queryFn: async () => {
            const response = await salesApi.getSummary(filters);
            return response.data;
        },
        placeholderData: keepPreviousData,
        enabled: isServerReachable && companyId !== null,
    });
}

export function useSaleSearchSuggestions(query: string, limit = 8) {
    const { isServerReachable } = useServerHealth();
    const companyId = useAuthStore((state) => state.currentCompany?.id ?? null);
    const normalizedQuery = query.trim();
    return useQuery<SaleSearchSuggestion[]>({
        queryKey: queryKeys.saleSearchSuggestions(companyId, normalizedQuery),
        queryFn: async () => {
            const response = await salesApi.getSearchSuggestions(normalizedQuery, limit);
            return response.data;
        },
        enabled: isServerReachable && companyId !== null && normalizedQuery.length >= 2,
        staleTime: 30_000,
    });
}

// Suppliers Hook
export function useSuppliers(params?: any, options?: Partial<UseQueryOptions<Supplier[]>>) {
    const { isServerReachable } = useServerHealth();
    const companyId = useAuthStore((state) => state.currentCompany?.id ?? null);
    return useQuery<Supplier[]>({
        queryKey: queryKeys.suppliers(companyId, params),
        queryFn: async () => {
            const response = await suppliersApi.getAll(params || { limit: 100 });
            return response.data;
        },
        ...options,
        enabled: isServerReachable && companyId !== null && (options?.enabled !== false),
    });
}

// Purchase Orders Hook
export function usePurchaseOrders(params?: any, options?: Partial<UseQueryOptions<PurchaseOrder[]>>) {
    const { isServerReachable } = useServerHealth();
    const companyId = useAuthStore((state) => state.currentCompany?.id ?? null);
    return useQuery<PurchaseOrder[]>({
        queryKey: queryKeys.purchaseOrders(companyId, params),
        queryFn: async () => {
            const response = await purchaseOrdersApi.getAll(params || { limit: 100 });
            return response.data;
        },
        ...options,
        enabled: isServerReachable && companyId !== null && (options?.enabled !== false),
    });
}

export function usePurchaseOrder(
    id: number,
    options?: Partial<UseQueryOptions<PurchaseOrder>>,
) {
    const { isServerReachable } = useServerHealth();
    const companyId = useAuthStore((state) => state.currentCompany?.id ?? null);
    return useQuery<PurchaseOrder>({
        queryKey: queryKeys.purchaseOrder(companyId, id),
        queryFn: async () => {
            const response = await purchaseOrdersApi.getById(id);
            return response.data;
        },
        ...options,
        enabled:
            isServerReachable &&
            companyId !== null &&
            Number.isFinite(id) &&
            (options?.enabled !== false),
    });
}

export function useCustomers(params?: any, options?: Partial<UseQueryOptions<Customer[]>>) {
    const { isServerReachable } = useServerHealth();
    const companyId = useAuthStore((state) => state.currentCompany?.id ?? null);
    return useQuery<Customer[]>({
        queryKey: queryKeys.customers(companyId, params),
        queryFn: async () => {
            const response = await customersApi.getAll(params || { limit: 100 });
            return response.data;
        },
        ...options,
        enabled: isServerReachable && companyId !== null && (options?.enabled !== false),
    });
}

export function useCustomerLedger(
    customerId: number | null,
    options?: Partial<UseQueryOptions<CustomerLedgerResponse>>,
) {
    const { isServerReachable } = useServerHealth();
    const companyId = useAuthStore((state) => state.currentCompany?.id ?? null);
    return useQuery<CustomerLedgerResponse>({
        queryKey: queryKeys.customerLedger(companyId, customerId),
        queryFn: async () => {
            const response = await customersApi.getLedger(customerId!);
            return response.data;
        },
        ...options,
        enabled:
            isServerReachable &&
            companyId !== null &&
            customerId !== null &&
            (options?.enabled !== false),
    });
}

// Reports Hooks
export function useDailySales(days: number, options?: Partial<UseQueryOptions<DailySalesReport>>) {
    const { isServerReachable } = useServerHealth();
    const companyId = useAuthStore((state) => state.currentCompany?.id ?? null);
    return useQuery<DailySalesReport>({
        queryKey: queryKeys.dailySales(companyId, days),
        queryFn: async () => {
            const response = await reportsApi.getDailySales({ days });
            return response.data;
        },
        ...options,
        enabled: isServerReachable && companyId !== null && (options?.enabled !== false),
    });
}

export function useProfit(days: number, options?: Partial<UseQueryOptions<ProfitReport>>) {
    const { isServerReachable } = useServerHealth();
    const companyId = useAuthStore((state) => state.currentCompany?.id ?? null);
    return useQuery<ProfitReport>({
        queryKey: queryKeys.profit(companyId, days),
        queryFn: async () => {
            const response = await reportsApi.getProfit({ days });
            return response.data;
        },
        ...options,
        enabled: isServerReachable && companyId !== null && (options?.enabled !== false),
    });
}

export function useTopProducts(days: number, limit: number = 10, options?: Partial<UseQueryOptions<TopProductsReport>>) {
    const { isServerReachable } = useServerHealth();
    const companyId = useAuthStore((state) => state.currentCompany?.id ?? null);
    return useQuery<TopProductsReport>({
        queryKey: queryKeys.topProducts(companyId, days, limit),
        queryFn: async () => {
            const response = await reportsApi.getTopProducts({ days, limit });
            return response.data;
        },
        ...options,
        enabled: isServerReachable && companyId !== null && (options?.enabled !== false),
    });
}


// Company storefront settings for the Telegram marketplace. Tenant-gated like
// every other read here so it never fires while offline or company-less.
export function useMarketplaceSettings(
    options?: Partial<UseQueryOptions<MarketplaceSettings>>,
) {
    const { isServerReachable } = useServerHealth();
    const companyId = useAuthStore((state) => state.currentCompany?.id ?? null);
    return useQuery<MarketplaceSettings>({
        queryKey: queryKeys.marketplaceSettings(companyId),
        queryFn: async () => {
            const response = await companyApi.getMarketplace();
            return response.data;
        },
        ...options,
        enabled: isServerReachable && companyId !== null && (options?.enabled !== false),
    });
}

// Prefetch Hook for Navigation
export function usePrefetchOnHover() {
    const queryClient = useQueryClient();
    const { isServerReachable } = useServerHealth();
    const companyId = useAuthStore((state) => state.currentCompany?.id ?? null);

    const prefetchDashboard = () => {
        if (!isServerReachable || companyId === null) return;
        queryClient.prefetchQuery({
            queryKey: queryKeys.dashboard(companyId),
            queryFn: async () => {
                const response = await reportsApi.getDashboard();
                return response.data;
            },
            staleTime: 30 * 1000,
        });
    };

    const prefetchProducts = () => {
        if (!isServerReachable || companyId === null) return;
        queryClient.prefetchQuery({
            queryKey: queryKeys.products(companyId, { limit: 100 }),
            queryFn: async () => {
                const response = await productsApi.getAll({ limit: 100 });
                return response.data;
            },
            staleTime: 30 * 1000,
        });
    };

    const prefetchSales = () => {
        if (!isServerReachable || companyId === null) return;
        queryClient.prefetchQuery({
            queryKey: queryKeys.sales(companyId, { limit: 100 }),
            queryFn: async () => {
                const response = await salesApi.getAll({ limit: 100 });
                return response.data;
            },
            staleTime: 30 * 1000,
        });
    };

    const prefetchSuppliers = () => {
        if (!isServerReachable || companyId === null) return;
        queryClient.prefetchQuery({
            queryKey: queryKeys.suppliers(companyId, { limit: 100 }),
            queryFn: async () => {
                const response = await suppliersApi.getAll({ limit: 100 });
                return response.data;
            },
            staleTime: 30 * 1000,
        });
    };

    const prefetchPurchaseOrders = () => {
        if (!isServerReachable || companyId === null) return;
        queryClient.prefetchQuery({
            queryKey: queryKeys.purchaseOrders(companyId, { limit: 100 }),
            queryFn: async () => {
                const response = await purchaseOrdersApi.getAll({ limit: 100 });
                return response.data;
            },
            staleTime: 30 * 1000,
        });
    };

    const prefetchCustomers = () => {
        if (!isServerReachable || companyId === null) return;
        queryClient.prefetchQuery({
            queryKey: queryKeys.customers(companyId, { limit: 100 }),
            queryFn: async () => {
                const response = await customersApi.getAll({ limit: 100 });
                return response.data;
            },
            staleTime: 30 * 1000,
        });
    };

    return {
        prefetchDashboard,
        prefetchProducts,
        prefetchSales,
        prefetchSuppliers,
        prefetchPurchaseOrders,
        prefetchCustomers,
    };
}
