import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import PurchaseOrderStepper from '../PurchaseOrderStepper';

describe('PurchaseOrderStepper', () => {
  it('marks supplier current and receiving unavailable for a new draft', () => {
    render(
      <PurchaseOrderStepper
        mode="editor"
        currentStep="supplier"
        status="draft"
      />,
    );

    expect(
      screen.getByRole('listitem', { name: /поставщик.*текущий/i }),
    ).toHaveAttribute('aria-current', 'step');
    expect(
      screen.getByRole('listitem', { name: /приёмка.*недоступно/i }),
    ).toBeInTheDocument();
  });

  it('makes receiving current for a partially received order', () => {
    render(
      <PurchaseOrderStepper
        mode="detail"
        currentStep="receive"
        status="partially_received"
      />,
    );

    expect(
      screen.getByRole('listitem', { name: /приёмка.*текущий/i }),
    ).toHaveAttribute('aria-current', 'step');
  });
});
