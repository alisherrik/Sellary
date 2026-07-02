import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { SaleSearchSuggestion } from '@/lib/types';
import SalesSearch from '../SalesSearch';

const suggestions: SaleSearchSuggestion[] = [
  { kind: 'product', label: 'Кола', value: 'Кола', score: 89 },
  { kind: 'cashier', label: 'Мадина', value: 'Мадина', score: 76 },
];

const renderSearch = (overrides: Partial<React.ComponentProps<typeof SalesSearch>> = {}) => {
  const props = {
    value: 'колаа',
    onChange: vi.fn(),
    onSelect: vi.fn(),
    suggestions,
    isLoading: false,
    ...overrides,
  };
  render(<SalesSearch {...props} />);
  return props;
};

describe('SalesSearch', () => {
  it('renders the smart-search placeholder and forwards typing', async () => {
    const user = userEvent.setup();
    const props = renderSearch({ value: '' });

    const input = screen.getByPlaceholderText('Поиск по чеку, товару, кассиру, сумме...');
    await user.type(input, 'кола');

    expect(props.onChange).toHaveBeenCalled();
  });

  it('shows typed suggestions with a helpful heading', () => {
    renderSearch();

    expect(screen.getByText('Возможно, вы искали')).toBeInTheDocument();
    expect(screen.getByText('Кола')).toBeInTheDocument();
    expect(screen.getByText('Товар')).toBeInTheDocument();
    expect(screen.getByText('Кассир')).toBeInTheDocument();
  });

  it('selects a suggestion with the mouse', async () => {
    const user = userEvent.setup();
    const props = renderSearch();

    await user.click(screen.getByRole('option', { name: /Кола/ }));

    expect(props.onSelect).toHaveBeenCalledWith('Кола');
  });

  it('supports arrow navigation and enter selection', () => {
    const props = renderSearch();
    const input = screen.getByRole('combobox');

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(props.onSelect).toHaveBeenCalledWith('Кола');
  });

  it('closes suggestions with escape', () => {
    renderSearch();

    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Escape' });

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('clears the current query', async () => {
    const user = userEvent.setup();
    const props = renderSearch();

    await user.click(screen.getByRole('button', { name: 'Очистить поиск' }));

    expect(props.onChange).toHaveBeenCalledWith('');
  });

  it('shows suggestion loading state', () => {
    renderSearch({ suggestions: [], isLoading: true });

    expect(screen.getByText('Ищем похожие варианты...')).toBeInTheDocument();
  });
});
