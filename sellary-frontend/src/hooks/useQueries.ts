import { useQuery, useQueryClient, UseQueryOptions } from '@tanstack/react-query';
import { reportsApi, productsApi, salesApi, suppliersApi, purchaseOrdersApi } from '@/lib/api';
import { useServerHealth } from '@/providers/ServerHealthProvider';
import {
    Product, Sale, Supplier, PurchaseOrder,
    DailySalesReport, ProfitReport, TopProductsReport
} from '@/lib/types';


// Query Keys
export const queryKeys = {
    dashboard: ['dashboard'] as const,
    products: (params?: any) => ['products', params] as const,
    sales: (params?: any) => ['sales', params] as const,
    suppliers: (params?: any) => ['suppliers', params] as const,
    purchaseOrders: (params?: any) => ['purchaseOrders', params] as const,
    dailySales: (days: number) => ['dailySales', days] as const,
    profit: (days: number) => ['profit', days] as const,
    topProducts: (days: number, limit: number) => ['topProducts', days, limit] as const,
};

// Dashboard Hook
export function useDashboard() {
    const { isServerReachable } = useServerHealth();
    return useQuery({
        queryKey: queryKeys.dashboard,
        queryFn: async () => {
            const response = await reportsApi.getDashboard();
            return response.data;
        },
        enabled: isServerReachable,
    });
}

// Products Hook
export function useProducts(params?: any, options?: Partial<UseQueryOptions<Product[]>>) {
    const { isServerReachable } = useServerHealth();
    return useQuery<Product[]>({
        queryKey: queryKeys.products(params),
        queryFn: async () => {
            const response = await productsApi.getAll(params || { limit: 100 });
            return response.data;
        },
        ...options,
        enabled: isServerReachable && (options?.enabled !== false),
    });
}

// Sales Hook
export function useSales(params?: any, options?: Partial<UseQueryOptions<Sale[]>>) {
    const { isServerReachable } = useServerHealth();
    return useQuery<Sale[]>({
        queryKey: queryKeys.sales(params),
        queryFn: async () => {
            const response = await salesApi.getAll(params || { limit: 100 });
            return response.data;
        },
        ...options,
        enabled: isServerReachable && (options?.enabled !== false),
    });
}

// Suppliers Hook
export function useSuppliers(params?: any, options?: Partial<UseQueryOptions<Supplier[]>>) {
    const { isServerReachable } = useServerHealth();
    return useQuery<Supplier[]>({
        queryKey: queryKeys.suppliers(params),
        queryFn: async () => {
            const response = await suppliersApi.getAll(params || { limit: 100 });
            return response.data;
        },
        ...options,
        enabled: isServerReachable && (options?.enabled !== false),
    });
}

// Purchase Orders Hook
export function usePurchaseOrders(params?: any, options?: Partial<UseQueryOptions<PurchaseOrder[]>>) {
    const { isServerReachable } = useServerHealth();
    return useQuery<PurchaseOrder[]>({
        queryKey: queryKeys.purchaseOrders(params),
        queryFn: async () => {
            const response = await purchaseOrdersApi.getAll(params || { limit: 100 });
            return response.data;
        },
        ...options,
        enabled: isServerReachable && (options?.enabled !== false),
    });
}

// Reports Hooks
export function useDailySales(days: number, options?: Partial<UseQueryOptions<DailySalesReport>>) {
    const { isServerReachable } = useServerHealth();
    return useQuery<DailySalesReport>({
        queryKey: queryKeys.dailySales(days),
        queryFn: async () => {
            const response = await reportsApi.getDailySales({ days });
            return response.data;
        },
        ...options,
        enabled: isServerReachable && (options?.enabled !== false),
    });
}

export function useProfit(days: number, options?: Partial<UseQueryOptions<ProfitReport>>) {
    const { isServerReachable } = useServerHealth();
    return useQuery<ProfitReport>({
        queryKey: queryKeys.profit(days),
        queryFn: async () => {
            const response = await reportsApi.getProfit({ days });
            return response.data;
        },
        ...options,
        enabled: isServerReachable && (options?.enabled !== false),
    });
}

export function useTopProducts(days: number, limit: number = 10, options?: Partial<UseQueryOptions<TopProductsReport>>) {
    const { isServerReachable } = useServerHealth();
    return useQuery<TopProductsReport>({
        queryKey: queryKeys.topProducts(days, limit),
        queryFn: async () => {
            const response = await reportsApi.getTopProducts({ days, limit });
            return response.data;
        },
        ...options,
        enabled: isServerReachable && (options?.enabled !== false),
    });
}


// Prefetch Hook for Navigation
export function usePrefetchOnHover() {
    const queryClient = useQueryClient();
    const { isServerReachable } = useServerHealth();

    const prefetchDashboard = () => {
        if (!isServerReachable) return;
        queryClient.prefetchQuery({
            queryKey: queryKeys.dashboard,
            queryFn: async () => {
                const response = await reportsApi.getDashboard();
                return response.data;
            },
            staleTime: 30 * 1000,
        });
    };

    const prefetchProducts = () => {
        if (!isServerReachable) return;
        queryClient.prefetchQuery({
            queryKey: queryKeys.products({ limit: 100 }),
            queryFn: async () => {
                const response = await productsApi.getAll({ limit: 100 });
                return response.data;
            },
            staleTime: 30 * 1000,
        });
    };

    const prefetchSales = () => {
        if (!isServerReachable) return;
        queryClient.prefetchQuery({
            queryKey: queryKeys.sales({ limit: 100 }),
            queryFn: async () => {
                const response = await salesApi.getAll({ limit: 100 });
                return response.data;
            },
            staleTime: 30 * 1000,
        });
    };

    const prefetchSuppliers = () => {
        if (!isServerReachable) return;
        queryClient.prefetchQuery({
            queryKey: queryKeys.suppliers({ limit: 100 }),
            queryFn: async () => {
                const response = await suppliersApi.getAll({ limit: 100 });
                return response.data;
            },
            staleTime: 30 * 1000,
        });
    };

    const prefetchPurchaseOrders = () => {
        if (!isServerReachable) return;
        queryClient.prefetchQuery({
            queryKey: queryKeys.purchaseOrders({ limit: 100 }),
            queryFn: async () => {
                const response = await purchaseOrdersApi.getAll({ limit: 100 });
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
    };
}
