import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ProductGrid } from '../ProductGrid';
import type { LocalProduct } from '../../../lib/db';

const p = (over: Partial<LocalProduct> = {}): LocalProduct => ({
  id: 1, barcode: null, name: 'Кола', uom: 'шт', category_id: null,
  sell_price: 5000, tax_percent: 0, stock_quantity: 5, is_active: true,
  updated_at: '2026-01-01', ...over,
});

describe('ProductGrid', () => {
  it('renders skeletons while loading', () => {
    const { container } = render(
      <ProductGrid products={[]} loading cartBaseByProduct={new Map()} onAdd={() => {}} />,
    );
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
  });

  it('renders an empty state', () => {
    render(<ProductGrid products={[]} loading={false} cartBaseByProduct={new Map()} onAdd={() => {}} />);
    expect(screen.getByText('Товары не найдены')).toBeInTheDocument();
  });

  it('shows emerald, amber, and red badges for the three stock states', () => {
    render(
      <ProductGrid
        loading={false}
        cartBaseByProduct={new Map()}
        onAdd={() => {}}
        products={[
          p({ id: 1, name: 'В наличии', stock_quantity: 5 }),
          p({ id: 2, name: 'Нет', stock_quantity: 0 }),
          p({ id: 3, name: 'Перерасход', stock_quantity: -2 }),
        ]}
      />,
    );
    expect(screen.getByText('5 шт').className).toContain('emerald');
    expect(screen.getByText('нет').className).toContain('amber');
    expect(screen.getByText('-2 шт').className).toContain('red');
  });

  it('calls onAdd when a tile is clicked (even at zero stock)', () => {
    const onAdd = vi.fn();
    render(
      <ProductGrid loading={false} cartBaseByProduct={new Map()} onAdd={onAdd}
        products={[p({ id: 2, name: 'Нет', stock_quantity: 0 })]} />,
    );
    fireEvent.click(screen.getByText('Нет'));
    expect(onAdd).toHaveBeenCalledTimes(1);
  });
});
