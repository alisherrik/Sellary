import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import CategoryPicker from '../CategoryPicker';

const { create } = vi.hoisted(() => ({ create: vi.fn() }));

vi.mock('@/lib/api', () => ({ categoriesApi: { create } }));
vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

const categories = [
  { id: 1, name: 'Напитки' },
  { id: 2, name: 'Хлеб' },
] as any;

describe('CategoryPicker', () => {
  it('lists the categories it was given', () => {
    render(<CategoryPicker value="" categories={categories} onChange={vi.fn()} />);
    expect(screen.getByRole('option', { name: 'Напитки' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Без категории' })).toBeInTheDocument();
  });

  it('creates a category in place and selects it', async () => {
    create.mockResolvedValue({ data: { id: 7, name: 'Молочка' } });
    const onChange = vi.fn();
    const onCreated = vi.fn();
    render(
      <CategoryPicker
        value=""
        categories={categories}
        onChange={onChange}
        onCreated={onCreated}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: '+ Новая' }));
    await userEvent.type(screen.getByLabelText('Новая категория'), 'Молочка');
    await userEvent.click(screen.getByRole('button', { name: 'Создать' }));

    await waitFor(() => expect(create).toHaveBeenCalledWith({ name: 'Молочка' }));
    // The point of the control: the user continues in the form they were in,
    // with the new category already chosen.
    expect(onChange).toHaveBeenCalledWith('7');
    expect(onCreated).toHaveBeenCalledWith({ id: 7, name: 'Молочка' });
    expect(await screen.findByRole('combobox')).toBeInTheDocument();
  });

  it('cancels back to the select without creating anything', async () => {
    render(<CategoryPicker value="" categories={categories} onChange={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: '+ Новая' }));
    await userEvent.click(screen.getByRole('button', { name: 'Отмена' }));

    expect(screen.getByRole('combobox')).toBeInTheDocument();
    expect(create).not.toHaveBeenCalledWith(expect.objectContaining({ name: '' }));
  });

  it('will not submit an empty name', async () => {
    render(<CategoryPicker value="" categories={categories} onChange={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: '+ Новая' }));
    expect(screen.getByRole('button', { name: 'Создать' })).toBeDisabled();
  });
});
