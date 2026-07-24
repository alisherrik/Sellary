import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useSuppliers } from '@/hooks/useQueries';
import Suppliers from '../page';

const suppliers = [
  {
    id: 1,
    name: 'ООО Север Трейд',
    contact_person: 'Рустам',
    email: 'north@example.com',
    phone: '+992900001111',
    payment_terms: '50% предоплата',
    address: 'Душанбе',
    is_active: true,
    created_at: '2026-07-01T00:00:00Z',
  },
  {
    id: 2,
    name: 'Юг Маркет',
    contact_person: '',
    email: '',
    phone: '+992900002222',
    payment_terms: '',
    address: '',
    is_active: true,
    created_at: '2026-07-01T00:00:00Z',
  },
];

vi.mock('@/hooks/useQueries', () => ({
  useSuppliers: vi.fn(),
}));

vi.mock('@/lib/store', () => ({
  useModules: () => ({ purchasing: 'user' }),
}));

vi.mock('@/lib/api', () => ({
  suppliersApi: {
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('react-hot-toast', () => ({
  default: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

const renderPage = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <Suppliers />
    </QueryClientProvider>,
  );
};

describe('Suppliers filters', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useSuppliers).mockReturnValue({
      data: suppliers,
      isLoading: false,
    } as any);
  });

  it('filters suppliers by server search and local payment terms', async () => {
    const user = userEvent.setup();
    renderPage();

    expect(screen.queryByRole('button', { name: 'С условиями' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Фильтры' }));

    await user.click(screen.getByRole('button', { name: 'С условиями' }));
    expect(screen.getAllByText('ООО Север Трейд').length).toBeGreaterThan(0);
    expect(screen.queryByText('Юг Маркет')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Фильтры' }));
    await user.click(screen.getByRole('button', { name: 'Без условий' }));
    expect(screen.getAllByText('Юг Маркет').length).toBeGreaterThan(0);
    expect(screen.queryByText('ООО Север Трейд')).not.toBeInTheDocument();

    await user.type(screen.getByRole('searchbox', { name: 'Поиск поставщиков' }), 'Север');

    await waitFor(
      () =>
        expect(useSuppliers).toHaveBeenLastCalledWith(
          expect.objectContaining({ limit: 100, search: 'Север' }),
        ),
      { timeout: 1500 },
    );
  });
});
