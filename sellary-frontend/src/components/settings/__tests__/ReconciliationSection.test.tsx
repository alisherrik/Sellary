import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { reconciliationApi } from '@/lib/api';
import { useReconciliation } from '@/hooks/useQueries';
import ReconciliationSection from '../ReconciliationSection';

vi.mock('@/hooks/useQueries', () => ({
  useReconciliation: vi.fn(),
  queryKeys: { reconciliation: (id: number | null) => ['reconciliation', id ?? 'no-company'] },
}));

vi.mock('@/lib/api', () => ({
  reconciliationApi: {
    create: vi.fn(),
    check: vi.fn(),
  },
}));

vi.mock('react-hot-toast', () => ({
  default: { error: vi.fn(), success: vi.fn() },
}));

const fetchSession = vi.fn();

vi.mock('@/lib/store', () => ({
  useAuthStore: vi.fn((selector: (state: any) => any) =>
    selector({ currentCompany: { id: 1 }, fetchSession }),
  ),
}));

const latest = {
  id: 3,
  effective_from: '2026-08-01',
  created_at: '2026-08-01T06:00:00Z',
  created_by_user_id: 7,
  note: 'Пересчитали склад',
};

const renderSection = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ReconciliationSection />
    </QueryClientProvider>,
  );
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useReconciliation).mockReturnValue({
    data: { latest, history: [latest] },
    isFetching: false,
    isError: false,
  } as any);
});

describe('ReconciliationSection', () => {
  it('leads with the date the open period starts at', () => {
    renderSection();
    expect(screen.getByText(/Открытый период с 01\.08\.2026/)).toBeInTheDocument();
    expect(screen.getByText('Пересчитали склад')).toBeInTheDocument();
  });

  it('posts the chosen date only after the confirmation', async () => {
    vi.mocked(reconciliationApi.create).mockResolvedValue({ data: latest } as never);
    const user = userEvent.setup();
    renderSection();

    const input = screen.getByLabelText('Открытый период начинается с');
    await user.clear(input);
    await user.type(input, '2026-08-13');
    await user.click(screen.getByRole('button', { name: 'Провести сверку' }));

    // Freezing the books is not a one-click act: nothing is sent until the
    // dialog has said what becomes uneditable.
    expect(reconciliationApi.create).not.toHaveBeenCalled();

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('станут неизменяемыми');
    await user.click(
      screen.getAllByRole('button', { name: 'Провести сверку' }).at(-1)!,
    );

    await waitFor(() =>
      expect(reconciliationApi.create).toHaveBeenCalledWith({
        effective_from: '2026-08-13',
        note: undefined,
        acknowledge_violations: false,
      }),
    );
    // The cut-off rides the session; every screen showing it has to be told.
    await waitFor(() => expect(fetchSession).toHaveBeenCalled());
  });

  it('lists what the checker found when the server refuses, behind an override', async () => {
    vi.mocked(reconciliationApi.create).mockRejectedValue({
      response: {
        status: 409,
        data: {
          detail: {
            message: 'Сверка невозможна: проверка нашла расхождения.',
            findings: [
              {
                check: 'stock_vs_layers',
                company_id: 1,
                subject: 'Товар #12 «Сахар 1кг»',
                expected: '30.000',
                actual: '28.000',
                bucket: 'drift',
                note: '',
              },
            ],
          },
        },
      },
    } as never);
    const user = userEvent.setup();
    renderSection();

    await user.click(screen.getByRole('button', { name: 'Провести сверку' }));
    await user.click(
      screen.getAllByRole('button', { name: 'Провести сверку' }).at(-1)!,
    );

    expect(await screen.findByText('stock_vs_layers')).toBeInTheDocument();
    expect(screen.getByText('Товар #12 «Сахар 1кг»')).toBeInTheDocument();
    expect(screen.getByRole('checkbox')).not.toBeChecked();
  });

  it('reports a plain Russian refusal without inventing findings', async () => {
    const toast = (await import('react-hot-toast')).default;
    vi.mocked(reconciliationApi.create).mockRejectedValue({
      response: {
        status: 409,
        data: { detail: 'Сначала закройте смену: сверка проводится между сменами.' },
      },
    } as never);
    const user = userEvent.setup();
    renderSection();

    await user.click(screen.getByRole('button', { name: 'Провести сверку' }));
    await user.click(
      screen.getAllByRole('button', { name: 'Провести сверку' }).at(-1)!,
    );

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        'Сначала закройте смену: сверка проводится между сменами.',
      ),
    );
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('runs the consistency check without writing anything', async () => {
    vi.mocked(reconciliationApi.check).mockResolvedValue({
      data: { checked_at: '2026-08-13T08:00:00Z', clean: true, findings: [] },
    } as never);
    const user = userEvent.setup();
    renderSection();

    await user.click(screen.getByRole('button', { name: 'Проверить целостность' }));

    expect(await screen.findByText('Расхождений не найдено.')).toBeInTheDocument();
    expect(reconciliationApi.create).not.toHaveBeenCalled();
  });
});
