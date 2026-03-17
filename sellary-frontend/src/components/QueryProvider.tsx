'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { persistQueryClient } from '@tanstack/react-query-persist-client';
import { createIDBPersister } from '@/lib/persister';
import { useState, useEffect } from 'react';
import { isOfflineModeEnabled } from '@/lib/features';

export default function QueryProvider({ children }: { children: React.ReactNode }) {
    const networkMode: 'offlineFirst' | 'online' = isOfflineModeEnabled ? 'offlineFirst' : 'online';
    const [queryClient] = useState(
        () =>
            new QueryClient({
                defaultOptions: {
                    queries: {
                        staleTime: 1000 * 60 * 5,
                        gcTime: 1000 * 60 * 60 * 24,
                        refetchOnWindowFocus: false,
                        retry: 1,
                        networkMode,
                    },
                    mutations: {
                        retry: 0,
                        networkMode,
                    },
                },
            })
    );

    useEffect(() => {
        if (!isOfflineModeEnabled) {
            return;
        }

        // Initialize persistence
        const persister = createIDBPersister();

        persistQueryClient({
            queryClient,
            persister,
            maxAge: 1000 * 60 * 60 * 24, // 24 hours
            dehydrateOptions: {
                shouldDehydrateQuery: (query) => {
                    const queryKey = query.queryKey;
                    if (!Array.isArray(queryKey) || queryKey.length === 0) return false;

                    const firstKey = queryKey[0] as string;
                    // Whitelist: Save ONLY these keys to IndexedDB
                    // Products/Categories/Customers needed for making sales
                    // Settings/User needed for app config
                    const ALLOWED_KEYS = ['products', 'categories', 'customers', 'suppliers', 'settings', 'user', 'auth'];

                    return ALLOWED_KEYS.includes(firstKey);
                }
            }
        });
    }, [queryClient]);

    return (
        <QueryClientProvider client={queryClient}>
            {children}
        </QueryClientProvider>
    );
}
