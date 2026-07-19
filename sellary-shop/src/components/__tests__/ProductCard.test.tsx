import { render, screen, fireEvent } from '@testing-library/react';
import { ProductCard } from '../ProductCard';
import type { ShopProduct } from '../../types';

const PRODUCT: ShopProduct = {
  id: 1,
  name: 'Молоко',
  description: 'Свежее молоко',
  sell_price: 12000,
  image_url: null,
  uom: 'л',
  category_id: 1,
  category_name: 'Молочные',
  company_id: 1,
  company_name: 'Магазин А',
  company_slug: 'shop-a',
  in_stock: true,
};

describe('ProductCard', () => {
  it('renders product name and price', () => {
    render(<ProductCard product={PRODUCT} onAddToCart={vi.fn()} />);
    expect(screen.getByText('Молоко')).toBeInTheDocument();
    expect(screen.getByText(/12/)).toBeInTheDocument();
  });

  it('shows shop name', () => {
    render(<ProductCard product={PRODUCT} onAddToCart={vi.fn()} />);
    expect(screen.getByText(/Магазин А/i)).toBeInTheDocument();
  });

  it('calls onAddToCart when button clicked', () => {
    const onAdd = vi.fn();
    render(<ProductCard product={PRODUCT} onAddToCart={onAdd} />);
    fireEvent.click(screen.getByRole('button', { name: /корзин/i }));
    expect(onAdd).toHaveBeenCalledWith(PRODUCT);
  });

  it('shows out-of-stock indicator', () => {
    render(<ProductCard product={{ ...PRODUCT, in_stock: false }} onAddToCart={vi.fn()} />);
    expect(screen.getByText(/нет в наличии/i)).toBeInTheDocument();
  });
});
