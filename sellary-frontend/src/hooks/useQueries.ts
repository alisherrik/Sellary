import { useQuery, useQueryClient, UseQueryOptions } from '@tanstack/react-query';
import { reportsApi, productsApi, salesApi, suppliersApi, purchaseOrdersApi, customersApi } from '@/lib/api';
import { useServerHealth } from '@/providers/ServerHealthProvider';
import { useAuthStore } from '@/lib/store';
import {
    Product, Sale, SaleSearchSuggestion, Supplier, PurchaseOrder, Customer, CustomerLedgerResponse,
    DailySalesReport, ProfitReport, TopProductsReport
} from '@/lib/types';

const tenantKey = (companyId: number | null) => companyId ?? 'no-company';

// Query Keys
export const queryKeys = {
    dashboard: (companyId: number | null) => ['dashboard', tenantKey(companyId)] as const,
    products: (companyId: number | null, params?: any) => ['products', tenantKey(companyId), params] as const,
    sales: (companyId: number | null, params?: any) => ['sales', tenantKey(companyId), params] as const,
    saleSearchSuggestions: (companyId: number | null, query: string) =>
        ['saleSearchSuggestions', tenantKey(companyId), query] as const,
    suppliers: (companyId: number | null, params?: any) => ['suppliers', tenantKey(companyId), params] as const,
    purchaseOrders: (companyId: number | null, params?: any) => ['purchaseOrders', tenantKey(companyId), params] as const,
    purchaseOrder: (companyId: number | null, id: number) => ['purchaseOrder', tenantKey(companyId), id] as const,
    customers: (companyId: number | null, params?: any) => ['customers', tenantKey(companyId), params] as const,
    customerLedger: (companyId: number | null, id: number | null) => ['customerLedger', tenantKey(companyId), id] as const,
    dailySales: (companyId: number | null, days: number) => ['dailySales', tenantKey(companyId), days] as const,
    profit: (companyId: number | null, days: number) => ['profit', tenantKey(companyId), days] as const,
    topProducts: (companyId: number | null, days: number, limit: number) => ['topProducts', tenantKey(companyId), days, limit] as const,
};

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
