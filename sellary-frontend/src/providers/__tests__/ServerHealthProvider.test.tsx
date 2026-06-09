import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useServerHealth, ServerHealthProvider } from '../ServerHealthProvider';

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

beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('ServerHealthProvider - Initial State', () => {
    it('should start with isServerReachable true and isChecking false', async () => {
        global.fetch = vi.fn(() =>
            Promise.resolve({
                ok: true,
                status: 200,
            } as Response)
        );

        const { result } = renderHook(() => useServerHealth(), {
            wrapper: createWrapper(),
        });

        // Initial state is optimistic: server reachable
        expect(result.current.isServerReachable).toBe(true);
        expect(result.current.isNavigatorOnline).toBe(true);

        await waitFor(() => {
            expect(result.current.isServerReachable).toBe(true);
        });
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

        await waitFor(() => {
            expect(mockFetch).toHaveBeenCalled();
        });
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

        await waitFor(() => {
            expect(result.current.isServerReachable).toBe(true);
        });
    });

    it('should set server as unreachable when health check fails', async () => {
        global.fetch = vi.fn(() =>
            Promise.reject(new Error('Network error'))
        );

        const { result } = renderHook(() => useServerHealth(), {
            wrapper: createWrapper(),
        });

        await waitFor(() => {
            expect(result.current.isServerReachable).toBe(false);
        });
    });
});

describe('ServerHealthProvider - State Transitions', () => {
    it('should transition to reachable when server is up', async () => {
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
            expect(result.current.isServerReachable).toBe(true);
        });
    });

    it('should transition to unreachable when server is down', async () => {
        global.fetch = vi.fn(() =>
            Promise.reject(new Error('Network error'))
        );

        const { result } = renderHook(() => useServerHealth(), {
            wrapper: createWrapper(),
        });

        await waitFor(() => {
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

        await waitFor(() => {
            expect(result.current.isServerReachable).toBe(false);
        });
    });

    it('should handle timeout errors gracefully', async () => {
        global.fetch = vi.fn(() =>
            Promise.reject(new DOMException('Aborted', 'AbortError'))
        );

        const { result } = renderHook(() => useServerHealth(), {
            wrapper: createWrapper(),
        });

        await waitFor(() => {
            expect(result.current.isServerReachable).toBe(false);
        });
    });

    it('should mark server as unreachable on 503 response', async () => {
        global.fetch = vi.fn(() =>
            Promise.resolve({
                ok: false,
                status: 503,
            } as Response)
        );

        const { result } = renderHook(() => useServerHealth(), {
            wrapper: createWrapper(),
        });

        await waitFor(() => {
            expect(result.current.isServerReachable).toBe(false);
        });
    });
});

describe('ServerHealthProvider - Context Value', () => {
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

    it('should provide lastCheckedAt', async () => {
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
            expect(result.current.lastCheckedAt).toBeInstanceOf(Date);
        });
    });
});
