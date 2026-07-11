import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FilterMenu } from '../FilterMenu';

describe('FilterMenu', () => {
  it('shows the active-filter count and opens the panel', () => {
    render(
      <FilterMenu
        paymentMethod="card"
        startDate=""
        endDate=""
        onPaymentMethodChange={() => {}}
        onStartDateChange={() => {}}
        onEndDateChange={() => {}}
        onReset={() => {}}
      />,
    );
    expect(screen.getByText('1')).toBeInTheDocument(); // one active filter (payment)
    fireEvent.click(screen.getByRole('button', { name: /Фильтры/ }));
    expect(screen.getByLabelText('Способ оплаты')).toBeInTheDocument();
  });
  it('emits payment-method changes', () => {
    const onPaymentMethodChange = vi.fn();
    render(
      <FilterMenu
        paymentMethod="all"
        startDate=""
        endDate=""
        onPaymentMethodChange={onPaymentMethodChange}
        onStartDateChange={() => {}}
        onEndDateChange={() => {}}
        onReset={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Фильтры/ }));
    fireEvent.change(screen.getByLabelText('Способ оплаты'), { target: { value: 'mobile' } });
    expect(onPaymentMethodChange).toHaveBeenCalledWith('mobile');
  });
});
