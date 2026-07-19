import { render, screen, fireEvent } from '@testing-library/react';
import { CartItem } from '../CartItem';

const ITEM = {
  productId: 1,
  name: 'Молоко',
  price: 12000,
  companyId: 1,
  quantity: 2,
};

describe('CartItem', () => {
  it('renders item name and total price', () => {
    render(<CartItem item={ITEM} onRemove={vi.fn()} onSetQuantity={vi.fn()} />);
    expect(screen.getByText('Молоко')).toBeInTheDocument();
    expect(screen.getByText(/24/)).toBeInTheDocument();
  });

  it('calls onRemove when remove button clicked', () => {
    const onRemove = vi.fn();
    render(<CartItem item={ITEM} onRemove={onRemove} onSetQuantity={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /удалить|remove|×/i }));
    expect(onRemove).toHaveBeenCalledWith(1);
  });

  it('calls onSetQuantity with incremented value', () => {
    const onSet = vi.fn();
    render(<CartItem item={ITEM} onRemove={vi.fn()} onSetQuantity={onSet} />);
    fireEvent.click(screen.getByRole('button', { name: /\+/ }));
    expect(onSet).toHaveBeenCalledWith(1, 3);
  });

  it('calls onSetQuantity with decremented value', () => {
    const onSet = vi.fn();
    render(<CartItem item={ITEM} onRemove={vi.fn()} onSetQuantity={onSet} />);
    fireEvent.click(screen.getByRole('button', { name: /−|–|-/ }));
    expect(onSet).toHaveBeenCalledWith(1, 1);
  });
});
