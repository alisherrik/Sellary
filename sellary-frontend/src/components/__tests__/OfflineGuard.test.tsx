import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import OfflineGuard from '../OfflineGuard';
import { ServerHealthProvider } from '@/providers/ServerHealthProvider';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

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
 * UNIT TESTS FOR OFFLINEGUARD COMPONENT
 *
 * Tests offline guard behavior, fallback UI rendering,
 * and child component visibility based on server health.
 */

const createWrapper = () => {
    const queryClient = new QueryClient({
        defaultOptions: {
            queries: { retry: false },
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

describe('OfflineGuard - Loading State', () => {
    it('should show loading indicator while checking server health', async () => {
        global.fetch = vi.fn(() =>
            Promise.resolve({
                ok: true,
                status: 200,
            } as Response)
        );

        render(
            <OfflineGuard>
                <div>Protected Content</div>
            </OfflineGuard>,
            { wrapper: createWrapper() }
        );

        // Should show loading initially
        expect(screen.getByText(/подключение к серверу/i)).toBeInTheDocument();
    });

    it('should hide loading after health check completes', async () => {
        global.fetch = vi.fn(() =>
            Promise.resolve({
                ok: true,
                status: 200,
            } as Response)
        );

        render(
            <OfflineGuard>
                <div>Protected Content</div>
            </OfflineGuard>,
            { wrapper: createWrapper() }
        );

        // Wait for health check to complete
        await waitFor(() => {
            expect(screen.queryByText(/подключение к серверу/i)).not.toBeInTheDocument();
        });
    });
});

describe('OfflineGuard - Online Mode', () => {
    it('should render children when server is reachable', async () => {
        global.fetch = vi.fn(() =>
            Promise.resolve({
                ok: true,
                status: 200,
            } as Response)
        );

        render(
            <OfflineGuard>
                <div>Protected Content</div>
            </OfflineGuard>,
            { wrapper: createWrapper() }
        );

        // Wait for health check to complete
        await waitFor(() => {
            expect(screen.getByText('Protected Content')).toBeInTheDocument();
        });
    });

    it('should NOT show offline message when server is reachable', async () => {
        global.fetch = vi.fn(() =>
            Promise.resolve({
                ok: true,
                status: 200,
            } as Response)
        );

        render(
            <OfflineGuard>
                <div>Protected Content</div>
            </OfflineGuard>,
            { wrapper: createWrapper() }
        );

        await waitFor(() => {
            expect(screen.queryByText(/офлайн режим/i)).not.toBeInTheDocument();
        });
    });

    it('should render multiple children when online', async () => {
        global.fetch = vi.fn(() =>
            Promise.resolve({
                ok: true,
                status: 200,
            } as Response)
        );

        render(
            <OfflineGuard>
                <div>First Child</div>
                <div>Second Child</div>
                <div>Third Child</div>
            </OfflineGuard>,
            { wrapper: createWrapper() }
        );

        await waitFor(() => {
            expect(screen.getByText('First Child')).toBeInTheDocument();
            expect(screen.getByText('Second Child')).toBeInTheDocument();
            expect(screen.getByText('Third Child')).toBeInTheDocument();
        });
    });
});

describe('OfflineGuard - Offline Mode', () => {
    it('should show fallback UI when server is unreachable', async () => {
        global.fetch = vi.fn(() =>
            Promise.reject(new Error('Network error'))
        );

        render(
            <OfflineGuard>
                <div>Protected Content</div>
            </OfflineGuard>,
            { wrapper: createWrapper() }
        );

        await waitFor(() => {
            expect(screen.getByText(/офлайн режим/i)).toBeInTheDocument();
        });
    });

    it('should NOT render children when server is unreachable', async () => {
        global.fetch = vi.fn(() =>
            Promise.reject(new Error('Network error'))
        );

        render(
            <OfflineGuard>
                <div>Protected Content</div>
            </OfflineGuard>,
            { wrapper: createWrapper() }
        );

        await waitFor(() => {
            expect(screen.queryByText('Protected Content')).not.toBeInTheDocument();
        });
    });

    it('should show waiting message when offline', async () => {
        global.fetch = vi.fn(() =>
            Promise.reject(new Error('Network error'))
        );

        render(
            <OfflineGuard>
                <div>Protected Content</div>
            </OfflineGuard>,
            { wrapper: createWrapper() }
        );

        await waitFor(() => {
            expect(screen.getByText(/ожидание сервера/i)).toBeInTheDocument();
        });
    });

    it('should display appropriate offline message', async () => {
        global.fetch = vi.fn(() =>
            Promise.reject(new Error('Network error'))
        );

        render(
            <OfflineGuard>
                <div>Protected Content</div>
            </OfflineGuard>,
            { wrapper: createWrapper() }
        );

        await waitFor(() => {
            expect(screen.getByText(/информация на этой странице/i)).toBeInTheDocument();
        });
    });
});

describe('OfflineGuard - Component Structure', () => {
    it('should render as a div', async () => {
        global.fetch = vi.fn(() =>
            Promise.resolve({
                ok: true,
                status: 200,
            } as Response)
        );

        const { container } = render(
            <OfflineGuard>
                <div>Protected Content</div>
            </OfflineGuard>,
            { wrapper: createWrapper() }
        );

        await waitFor(() => {
            expect(container.querySelector('div')).toBeInTheDocument();
        });
    });

    it('should pass through props to children when online', async () => {
        global.fetch = vi.fn(() =>
            Promise.resolve({
                ok: true,
                status: 200,
            } as Response)
        );

        const TestChild = ({ message }: { message: string }) => (
            <div>{message}</div>
        );

        render(
            <OfflineGuard>
                <TestChild message="Hello World" />
            </OfflineGuard>,
            { wrapper: createWrapper() }
        );

        await waitFor(() => {
            expect(screen.getByText('Hello World')).toBeInTheDocument();
        });
    });
});

describe('OfflineGuard - Edge Cases', () => {
    it('should handle null children gracefully', async () => {
        global.fetch = vi.fn(() =>
            Promise.resolve({
                ok: true,
                status: 200,
            } as Response)
        );

        expect(() => {
            render(
                <OfflineGuard>{null}</OfflineGuard>,
                { wrapper: createWrapper() }
            );
        }).not.toThrow();
    });

    it('should handle multiple children of different types', async () => {
        global.fetch = vi.fn(() =>
            Promise.resolve({
                ok: true,
                status: 200,
            } as Response)
        );

        render(
            <OfflineGuard>
                <div>First</div>
                <span>Second</span>
                <>Third Fragment</>
                {null}
                {false}
            </OfflineGuard>,
            { wrapper: createWrapper() }
        );

        await waitFor(() => {
            expect(screen.getByText('First')).toBeInTheDocument();
            expect(screen.getByText('Second')).toBeInTheDocument();
            expect(screen.getByText('Third Fragment')).toBeInTheDocument();
        });
    });

    it('should handle empty children', async () => {
        global.fetch = vi.fn(() =>
            Promise.resolve({
                ok: true,
                status: 200,
            } as Response)
        );

        expect(() => {
            render(<OfflineGuard>{[]}</OfflineGuard>, {
                wrapper: createWrapper(),
            });
        }).not.toThrow();
    });
});
