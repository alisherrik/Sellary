import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CompanyModulesEditor from '../CompanyModulesEditor';

describe('CompanyModulesEditor', () => {
  const noop = vi.fn();

  it('fills the checkboxes from the business-type preset', async () => {
    render(
      <CompanyModulesEditor
        companyId={1}
        initialBusinessType={null}
        initialModules={[]}
        onSave={noop}
      />,
    );

    await userEvent.selectOptions(screen.getByLabelText('Тип бизнеса'), 'online');

    expect(screen.getByRole('checkbox', { name: 'Магазин' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Касса' })).not.toBeChecked();
  });

  it('lets the owner edit the set after choosing a type', async () => {
    render(
      <CompanyModulesEditor
        companyId={1}
        initialBusinessType={null}
        initialModules={[]}
        onSave={noop}
      />,
    );

    await userEvent.selectOptions(screen.getByLabelText('Тип бизнеса'), 'online');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Касса' }));

    expect(screen.getByRole('checkbox', { name: 'Касса' })).toBeChecked();
  });

  it('saves the selected set in registry order', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <CompanyModulesEditor
        companyId={1}
        initialBusinessType="warehouse"
        initialModules={['inventory', 'purchasing']}
        onSave={onSave}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Сохранить модули' }));

    expect(onSave).toHaveBeenCalledWith({
      business_type: 'warehouse',
      modules: ['inventory', 'purchasing'],
    });
  });
});
