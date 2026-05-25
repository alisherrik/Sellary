import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
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

beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
    vi.restoreAllMocks();
});

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
    it('should show offline banner when server is unreachable', async () => {
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
            expect(screen.getByText(/офлайн/i)).toBeInTheDocument();
        });
    });

    it('should STILL render children when server is unreachable (softened behavior)', async () => {
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
            expect(screen.getByText('Protected Content')).toBeInTheDocument();
        });
    });

    it('should show stale data warning when offline', async () => {
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
            expect(screen.getByText(/данные могут быть неактуальны/i)).toBeInTheDocument();
        });
    });

    it('should display offline banner text', async () => {
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
            expect(screen.getByText(/Офлайн/i)).toBeInTheDocument();
        });
    });
});

describe('OfflineGuard - Banner Dismissible', () => {
    it('should dismiss banner when close button is clicked', async () => {
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
            expect(screen.getByText(/офлайн/i)).toBeInTheDocument();
        });

        const closeButton = screen.getByLabelText('Закрыть');
        fireEvent.click(closeButton);

        await waitFor(() => {
            expect(screen.queryByText(/офлайн/i)).not.toBeInTheDocument();
        });
    });

    it('should show children normally after banner dismissed', async () => {
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
            expect(screen.getByText(/офлайн/i)).toBeInTheDocument();
        });

        fireEvent.click(screen.getByLabelText('Закрыть'));

        await waitFor(() => {
            expect(screen.queryByText(/офлайн/i)).not.toBeInTheDocument();
            expect(screen.getByText('Protected Content')).toBeInTheDocument();
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
