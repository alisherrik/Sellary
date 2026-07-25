import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import QuickProductCreate from '../QuickProductCreate';

const { create } = vi.hoisted(() => ({ create: vi.fn() }));

vi.mock('@/lib/api', () => ({ productsApi: { create } }));

describe('QuickProductCreate', () => {
  it('prefills the name with what the buyer could not find', () => {
    render(
      <QuickProductCreate initialName="Сахар 1кг" onCancel={vi.fn()} onCreated={vi.fn()} />,
    );
    expect(screen.getByLabelText('Название')).toHaveValue('Сахар 1кг');
  });

  it('creates the product at zero stock and hands it back', async () => {
    create.mockResolvedValue({ data: { id: 12, name: 'Сахар 1кг' } });
    const onCreated = vi.fn();
    render(
      <QuickProductCreate initialName="Сахар 1кг" onCancel={vi.fn()} onCreated={onCreated} />,
    );

    await userEvent.type(screen.getByLabelText('Себестоимость'), '8000');
    await userEvent.type(screen.getByLabelText('Цена продажи'), '9500');
    await userEvent.click(screen.getByRole('button', { name: 'Создать и выбрать' }));

    await waitFor(() =>
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Сахар 1кг',
          cost_price: '8000',
          sell_price: '9500',
          // The receipt puts the stock there, not this form.
          stock_quantity: '0',
        }),
      ),
    );
    expect(onCreated).toHaveBeenCalledWith({ id: 12, name: 'Сахар 1кг' });
  });

  it('omits an empty barcode rather than sending a blank one', async () => {
    create.mockResolvedValue({ data: { id: 13, name: 'Соль' } });
    render(<QuickProductCreate initialName="Соль" onCancel={vi.fn()} onCreated={vi.fn()} />);

    await userEvent.type(screen.getByLabelText('Себестоимость'), '1000');
    await userEvent.type(screen.getByLabelText('Цена продажи'), '1500');
    await userEvent.click(screen.getByRole('button', { name: 'Создать и выбрать' }));

    await waitFor(() => expect(create).toHaveBeenCalled());
    expect(create.mock.calls.at(-1)?.[0]).not.toHaveProperty('barcode');
  });

  it('asks for the prices before it will submit', async () => {
    render(<QuickProductCreate initialName="Соль" onCancel={vi.fn()} onCreated={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Создать и выбрать' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('себестоимость');
  });

  it('surfaces the server’s reason for refusing', async () => {
    create.mockRejectedValue({ response: { data: { detail: 'Штрихкод уже занят' } } });
    render(<QuickProductCreate initialName="Соль" onCancel={vi.fn()} onCreated={vi.fn()} />);

    await userEvent.type(screen.getByLabelText('Себестоимость'), '1000');
    await userEvent.type(screen.getByLabelText('Цена продажи'), '1500');
    await userEvent.click(screen.getByRole('button', { name: 'Создать и выбрать' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Штрихкод уже занят');
  });
});
