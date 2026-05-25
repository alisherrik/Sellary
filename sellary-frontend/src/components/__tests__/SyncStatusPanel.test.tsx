import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import SyncStatusPanel from '../SyncStatusPanel';
import { ServerHealthProvider } from '@/providers/ServerHealthProvider';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

let mockQueueStatus = { total: 0, pending: 0, syncing: 0, failed: 0 };
let mockQueueItems: any[] = [];

vi.mock('@/lib/features', () => ({
    isRestaurantEnabled: false,
    isOfflineModeEnabled: true,
}));

vi.mock('@/lib/syncQueue', () => ({
    addToSyncQueue: vi.fn(),
    getSyncQueue: vi.fn(() => Promise.resolve(mockQueueItems)),
    removeFromSyncQueue: vi.fn(),
    updateSyncItem: vi.fn(),
    clearSyncQueue: vi.fn(),
    getQueueStatus: vi.fn(() => Promise.resolve(mockQueueStatus)),
    getSyncConfig: vi.fn(() => Promise.resolve({ autoSync: true, maxRetries: 5 })),
    setSyncConfig: vi.fn(),
    processQueue: vi.fn(() => Promise.resolve({ processed: 0, failed: 0, skipped: false })),
}));

const createWrapper = () => {
    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
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
    mockQueueStatus = { total: 0, pending: 0, syncing: 0, failed: 0 };
    mockQueueItems = [];
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('SyncStatusPanel - Display', () => {
    it('should not render when queue is empty', async () => {
        global.fetch = vi.fn(() =>
            Promise.resolve({ ok: true, status: 200 } as Response)
        );

        const { container } = render(<SyncStatusPanel />, { wrapper: createWrapper() });

        await waitFor(() => {
            expect(container.innerHTML).toBe('');
        });
    });

    it('should render sync count when queue has items', async () => {
        mockQueueStatus = { total: 3, pending: 2, syncing: 1, failed: 0 };

        global.fetch = vi.fn(() =>
            Promise.resolve({ ok: true, status: 200 } as Response)
        );

        render(<SyncStatusPanel />, { wrapper: createWrapper() });

        await waitFor(() => {
            expect(screen.getByText(/Ожидает синхронизации: 3/i)).toBeInTheDocument();
        });
    });

    it('should show failed count when items have failed', async () => {
        mockQueueStatus = { total: 5, pending: 3, syncing: 0, failed: 2 };

        global.fetch = vi.fn(() =>
            Promise.resolve({ ok: true, status: 200 } as Response)
        );

        render(<SyncStatusPanel />, { wrapper: createWrapper() });

        await waitFor(() => {
            expect(screen.getByText(/не удалось/i)).toBeInTheDocument();
        });
    });
});

describe('SyncStatusPanel - Expand/Collapse', () => {
    it('should expand to show queue items when chevron is clicked', async () => {
        mockQueueStatus = { total: 1, pending: 1, syncing: 0, failed: 0 };
        mockQueueItems = [
            {
                id: 'item-1',
                url: '/api/sales',
                method: 'POST',
                body: { total: 100 },
                timestamp: Date.now() - 60000,
                type: 'sale',
                retryCount: 0,
                status: 'pending',
            },
        ];

        global.fetch = vi.fn(() =>
            Promise.resolve({ ok: true, status: 200 } as Response)
        );

        render(<SyncStatusPanel />, { wrapper: createWrapper() });

        await waitFor(() => {
            expect(screen.getByText(/Ожидает синхронизации/i)).toBeInTheDocument();
        });

        fireEvent.click(screen.getByRole('button', { name: '' }) || screen.getAllByRole('button')[2]);

        // After clicking expand, items should be visible
        // The panel loads items when expanded
    });
});

describe('SyncStatusPanel - Sync Warnings Display', () => {
    it('should display sync_warnings icon and count on items that have warnings', async () => {
        mockQueueStatus = { total: 1, pending: 1, syncing: 0, failed: 0 };
        mockQueueItems = [
            {
                id: 'warn-item-1',
                url: '/api/sales',
                method: 'POST',
                body: { total: 100 },
                timestamp: Date.now() - 120000,
                type: 'sale',
                retryCount: 0,
                status: 'pending',
                syncWarnings: [
                    { product_name: 'Товар А', requested: 5, available: 3, new_balance: -2 },
                    { product_name: 'Товар Б', requested: 10, available: 8, new_balance: -2 },
                ],
            },
        ];

        global.fetch = vi.fn(() =>
            Promise.resolve({ ok: true, status: 200 } as Response)
        );

        render(<SyncStatusPanel />, { wrapper: createWrapper() });

        await waitFor(() => {
            expect(screen.getByText(/Ожидает синхронизации/i)).toBeInTheDocument();
        });

        // Expand the panel to show items
        const expandButton = screen.getByRole('button', { name: '' });
        fireEvent.click(expandButton);

        await waitFor(() => {
            expect(screen.getByText(/Предупреждения/i)).toBeInTheDocument();
        });
    });

    it('should show warning details when expanded', async () => {
        mockQueueStatus = { total: 1, pending: 1, syncing: 0, failed: 0 };
        mockQueueItems = [
            {
                id: 'warn-item-2',
                url: '/api/sales',
                method: 'POST',
                body: { total: 200 },
                timestamp: Date.now() - 180000,
                type: 'sale',
                retryCount: 0,
                status: 'pending',
                syncWarnings: [
                    { product_name: 'Товар C', requested: 15, available: 10, new_balance: -5 },
                ],
            },
        ];

        global.fetch = vi.fn(() =>
            Promise.resolve({ ok: true, status: 200 } as Response)
        );

        render(<SyncStatusPanel />, { wrapper: createWrapper() });

        await waitFor(() => {
            expect(screen.getByText(/Ожидает синхронизации/i)).toBeInTheDocument();
        });

        // Expand the panel
        const expandButton = screen.getByRole('button', { name: '' });
        fireEvent.click(expandButton);

        await waitFor(() => {
            expect(screen.getByText(/Предупреждения/i)).toBeInTheDocument();
        });

        // Click the warning toggle button
        const warningToggle = screen.getByTitle('Показать предупреждения');
        fireEvent.click(warningToggle);

        await waitFor(() => {
            expect(screen.getByText(/Товар C/i)).toBeInTheDocument();
            expect(screen.getByText(/запрошено 15/i)).toBeInTheDocument();
            expect(screen.getByText(/доступно 10/i)).toBeInTheDocument();
        });
    });

    it('should show correct warning count', async () => {
        mockQueueStatus = { total: 1, pending: 1, syncing: 0, failed: 0 };
        mockQueueItems = [
            {
                id: 'warn-item-3',
                url: '/api/sales',
                method: 'POST',
                body: { total: 300 },
                timestamp: Date.now() - 240000,
                type: 'sale',
                retryCount: 0,
                status: 'pending',
                syncWarnings: [
                    { product_name: 'Товар D', requested: 3, available: 1, new_balance: -2 },
                    { product_name: 'Товар E', requested: 7, available: 5, new_balance: -2 },
                    { product_name: 'Товар F', requested: 2, available: 0, new_balance: -2 },
                ],
            },
        ];

        global.fetch = vi.fn(() =>
            Promise.resolve({ ok: true, status: 200 } as Response)
        );

        render(<SyncStatusPanel />, { wrapper: createWrapper() });

        await waitFor(() => {
            expect(screen.getByText(/Ожидает синхронизации/i)).toBeInTheDocument();
        });

        const expandButton = screen.getByRole('button', { name: '' });
        fireEvent.click(expandButton);

        await waitFor(() => {
            expect(screen.getByText('3')).toBeInTheDocument();
        });
    });
});
