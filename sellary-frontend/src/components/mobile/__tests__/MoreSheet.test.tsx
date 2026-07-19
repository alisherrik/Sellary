import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MoreSheet from '../MoreSheet';

const { mockPush } = vi.hoisted(() => ({
  mockPush: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

describe('MoreSheet', () => {
  it('renders nothing when closed', () => {
    const { container } = render(<MoreSheet isOpen={false} onClose={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nav items when open', () => {
    render(<MoreSheet isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByText('Поставщики')).toBeInTheDocument();
    expect(screen.getByText('Закупки')).toBeInTheDocument();
    expect(screen.getByText('Отчеты')).toBeInTheDocument();
    expect(screen.getByText('Настройки')).toBeInTheDocument();
  });

  it('navigates and closes on item click', async () => {
    const onClose = vi.fn();
    render(<MoreSheet isOpen={true} onClose={onClose} />);
    await userEvent.click(screen.getByText('Поставщики'));
    expect(mockPush).toHaveBeenCalledWith('/suppliers');
    expect(onClose).toHaveBeenCalled();
  });

  it('closes on backdrop click', async () => {
    const onClose = vi.fn();
    render(<MoreSheet isOpen={true} onClose={onClose} />);
    const backdrop = document.querySelector('.bg-black\\/50');
    expect(backdrop).not.toBeNull();
    await userEvent.click(backdrop!);
    expect(onClose).toHaveBeenCalled();
  });

  it('links to the merchant orders page', () => {
    render(<MoreSheet isOpen onClose={() => {}} />);
    expect(screen.getByRole('button', { name: /Заказы/ })).toBeInTheDocument();
  });
});
