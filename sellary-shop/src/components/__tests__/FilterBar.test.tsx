import { render, screen, fireEvent } from '@testing-library/react';
import { FilterBar } from '../FilterBar';
import type { ShopSummary, ShopCategory } from '../../types';

const SHOPS: ShopSummary[] = [
  { company_id: 1, slug: 'shop-a', name: 'Магазин А', logo_url: null, marketplace_description: null, supports_delivery: true, supports_pickup: true },
  { company_id: 2, slug: 'shop-b', name: 'Магазин Б', logo_url: null, marketplace_description: null, supports_delivery: true, supports_pickup: false },
];
const CATEGORIES: ShopCategory[] = [
  { id: 1, name: 'Молочные' },
  { id: 2, name: 'Хлеб' },
];

describe('FilterBar', () => {
  it('renders search input', () => {
    render(
      <FilterBar shops={SHOPS} categories={CATEGORIES} search='' selectedShop={null} selectedCategory={null}
        onSearch={vi.fn()} onShopChange={vi.fn()} onCategoryChange={vi.fn()} />
    );
    expect(screen.getByPlaceholderText(/поиск/i)).toBeInTheDocument();
  });

  it('calls onSearch when input changes', () => {
    const onSearch = vi.fn();
    render(
      <FilterBar shops={SHOPS} categories={CATEGORIES} search='' selectedShop={null} selectedCategory={null}
        onSearch={onSearch} onShopChange={vi.fn()} onCategoryChange={vi.fn()} />
    );
    fireEvent.change(screen.getByPlaceholderText(/поиск/i), { target: { value: 'молоко' } });
    expect(onSearch).toHaveBeenCalledWith('молоко');
  });

  it('renders shop options', () => {
    render(
      <FilterBar shops={SHOPS} categories={CATEGORIES} search='' selectedShop={null} selectedCategory={null}
        onSearch={vi.fn()} onShopChange={vi.fn()} onCategoryChange={vi.fn()} />
    );
    expect(screen.getByText('Магазин А')).toBeInTheDocument();
    expect(screen.getByText('Магазин Б')).toBeInTheDocument();
  });
});
