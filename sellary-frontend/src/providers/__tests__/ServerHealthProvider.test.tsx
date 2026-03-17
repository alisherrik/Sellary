import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useServerHealth, ServerHealthProvider } from '../ServerHealthProvider';

// Mock syncQueue to prevent IndexedDB calls in tests
vi.mock('@/lib/syncQueue', () => ({
    addToSyncQueue: vi.fn(),
    getSyncQueue: vi.fn(() => Promise.resolve([])),
    removeFromSyncQueue: vi.fn(),
    updateSyncItem: vi.fn(),
    clearSyncQueue: vi.fn(),
    getQueueStatus: vi.fn(() => Promise.resolve({ total: 0, pending: 0, syncing: 0, failed: 0 })),
    getSyncConfig: vi.fn(() => Promise.resolve({ autoSync: true, maxRetries: 5 })),
    setSyncConfig: vi.fn(),
    processQueue: vi.fn(() => Promise.resolve({ processed: 0, failed: 0, skipped: false })),
}));

/**
 * UNIT TESTS FOR SERVER HEALTH PROVIDER
 *
 * Tests health checking, state transitions, and offline detection.
 */

const createWrapper = () => {
    const queryClient = new QueryClient({
        defaultOptions: {
            queries: { retry: false },
            mutations: { retry: false },
        },
    });

    const Wrapper = ({ children }: { children: React.ReactNode }) => (
        <QueryClientProvider client={queryClient}>
            <ServerHealthProvider>{children}</ServerHealthProvider>
        </QueryClientProvider>
    );
    Wrapper.displayName = 'TestWrapper';
    return Wrapper;
};

describe('ServerHealthProvider - Initial State', () => {
    it('should start with checking state true and server unreachable (offline-first)', async () => {
        global.fetch = vi.fn(() =>
            Promise.resolve({
                ok: true,
                status: 200,
            } as Response)
        );

        const { result } = renderHook(() => useServerHealth(), {
            wrapper: createWrapper(),
        });

        // Initial state should have checking true and server as unreachable
        expect(result.current.isChecking).toBe(true);
        expect(result.current.isServerReachable).toBe(false);
        expect(result.current.isNavigatorOnline).toBe(true);
    });

    it('should complete health check and set server as reachable', async () => {
        const mockFetch = vi.fn(() =>
            Promise.resolve({
                ok: true,
                status: 200,
            } as Response)
        );
        global.fetch = mockFetch;

        const { result } = renderHook(() => useServerHealth(), {
            wrapper: createWrapper(),
        });

        // Wait for health check to complete
        await waitFor(() => {
            expect(result.current.isChecking).toBe(false);
        });

        expect(mockFetch).toHaveBeenCalled();
        expect(result.current.isServerReachable).toBe(true);
    });
});

describe('ServerHealthProvider - Health Check Logic', () => {
    it('should set server as reachable when health check succeeds', async () => {
        const mockFetch = vi.fn(() =>
            Promise.resolve({
                ok: true,
                status: 200,
            } as Response)
        );
        global.fetch = mockFetch;

        const { result } = renderHook(() => useServerHealth(), {
            wrapper: createWrapper(),
        });

        // Wait for health check to complete
        await waitFor(() => {
            expect(result.current.isChecking).toBe(false);
        });

        expect(result.current.isServerReachable).toBe(true);
    });

    it('should set server as unreachable when health check fails', async () => {
        const mockFetch = vi.fn(() =>
            Promise.reject(new Error('Network error'))
        );
        global.fetch = mockFetch;

        const { result } = renderHook(() => useServerHealth(), {
            wrapper: createWrapper(),
        });

        // Wait for health check to complete
        await waitFor(() => {
            expect(result.current.isChecking).toBe(false);
        });

        expect(result.current.isServerReachable).toBe(false);
    });

    it('should set server as unreachable when server returns 500', async () => {
        const mockFetch = vi.fn(() =>
            Promise.resolve({
                ok: false,
                status: 500,
            } as Response)
        );
        global.fetch = mockFetch;

        const { result } = renderHook(() => useServerHealth(), {
            wrapper: createWrapper(),
        });

        await waitFor(() => {
            expect(result.current.isChecking).toBe(false);
        });

        expect(result.current.isServerReachable).toBe(false);
    });

    it('should set server as UNREACHABLE when server returns 401 (ZERO TRUST: only 200 OK = online)', async () => {
        const mockFetch = vi.fn(() =>
            Promise.resolve({
                ok: false,
                status: 401,
            } as Response)
        );
        global.fetch = mockFetch;

        const { result } = renderHook(() => useServerHealth(), {
            wrapper: createWrapper(),
        });

        await waitFor(() => {
            expect(result.current.isChecking).toBe(false);
        });

        // ZERO TRUST: 401 is NOT reachable (only 200 OK is reachable)
        expect(result.current.isServerReachable).toBe(false);
    });
});

describe('ServerHealthProvider - Manual Health Check', () => {
    it('should allow manual health check invocation', async () => {
        const mockFetch = vi.fn(() =>
            Promise.resolve({
                ok: true,
                status: 200,
            } as Response)
        );
        global.fetch = mockFetch;

        const { result } = renderHook(() => useServerHealth(), {
            wrapper: createWrapper(),
        });

        // Wait for initial check
        await waitFor(() => {
            expect(result.current.isChecking).toBe(false);
        });

        const initialCallCount = mockFetch.mock.calls.length;

        // Trigger manual health check
        await act(async () => {
            await result.current.checkHealth();
        });

        // Should have made another call
        expect(mockFetch.mock.calls.length).toBeGreaterThan(initialCallCount);
    });
});

describe('ServerHealthProvider - State Transitions', () => {
    it('should transition from checking to reachable when server is up', async () => {
        global.fetch = vi.fn(() =>
            Promise.resolve({
                ok: true,
                status: 200,
            } as Response)
        );

        const { result } = renderHook(() => useServerHealth(), {
            wrapper: createWrapper(),
        });

        // Initially checking
        expect(result.current.isChecking).toBe(true);

        // Then completes
        await waitFor(() => {
            expect(result.current.isChecking).toBe(false);
            expect(result.current.isServerReachable).toBe(true);
        });
    });

    it('should transition from checking to unreachable when server is down', async () => {
        global.fetch = vi.fn(() =>
            Promise.reject(new Error('Network error'))
        );

        const { result } = renderHook(() => useServerHealth(), {
            wrapper: createWrapper(),
        });

        // Initially checking
        expect(result.current.isChecking).toBe(true);

        // Then completes with unreachable
        await waitFor(() => {
            expect(result.current.isChecking).toBe(false);
            expect(result.current.isServerReachable).toBe(false);
        });
    });
});

describe('ServerHealthProvider - Error Handling', () => {
    it('should handle network errors gracefully', async () => {
        global.fetch = vi.fn(() =>
            Promise.reject(new Error('Network error'))
        );

        const { result } = renderHook(() => useServerHealth(), {
            wrapper: createWrapper(),
        });

        // Should not throw
        await waitFor(() => {
            expect(result.current.isChecking).toBe(false);
        });

        expect(result.current.isServerReachable).toBe(false);
    });

    it('should handle timeout errors gracefully', async () => {
        global.fetch = vi.fn(() =>
            // Immediate rejection to simulate timeout
            Promise.reject(new DOMException('Aborted', 'AbortError'))
        );

        const { result } = renderHook(() => useServerHealth(), {
            wrapper: createWrapper(),
        });

        // Should handle gracefully
        await waitFor(() => {
            expect(result.current.isChecking).toBe(false);
        });

        expect(result.current.isServerReachable).toBe(false);
    });
});

describe('ServerHealthProvider - Context Value', () => {
    it('should provide checkHealth function', async () => {
        global.fetch = vi.fn(() =>
            Promise.resolve({
                ok: true,
                status: 200,
            } as Response)
        );

        const { result } = renderHook(() => useServerHealth(), {
            wrapper: createWrapper(),
        });

        expect(typeof result.current.checkHealth).toBe('function');
    });

    it('should provide isServerReachable boolean', async () => {
        global.fetch = vi.fn(() =>
            Promise.resolve({
                ok: true,
                status: 200,
            } as Response)
        );

        const { result } = renderHook(() => useServerHealth(), {
            wrapper: createWrapper(),
        });

        await waitFor(() => {
            expect(result.current.isChecking).toBe(false);
        });

        expect(typeof result.current.isServerReachable).toBe('boolean');
    });

    it('should provide isNavigatorOnline boolean', async () => {
        global.fetch = vi.fn(() =>
            Promise.resolve({
                ok: true,
                status: 200,
            } as Response)
        );

        const { result } = renderHook(() => useServerHealth(), {
            wrapper: createWrapper(),
        });

        expect(typeof result.current.isNavigatorOnline).toBe('boolean');
    });

    it('should provide isChecking boolean', async () => {
        global.fetch = vi.fn(() =>
            Promise.resolve({
                ok: true,
                status: 200,
            } as Response)
        );

        const { result } = renderHook(() => useServerHealth(), {
            wrapper: createWrapper(),
        });

        expect(typeof result.current.isChecking).toBe('boolean');
    });
});
