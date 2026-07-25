import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { BuildingOffice2Icon } from '@heroicons/react/24/outline';
import { describe, expect, it } from 'vitest';

import SettingsNav, { panelDomId, tabDomId } from '../SettingsNav';

const sections = ['company', 'marketplace', 'team', 'system'].map((id) => ({
  id,
  label: id,
  summary: `${id} summary`,
  Icon: BuildingOffice2Icon,
}));

function Harness() {
  const [activeId, setActiveId] = useState('company');
  return <SettingsNav sections={sections} activeId={activeId} onSelect={setActiveId} />;
}

describe('SettingsNav', () => {
  it('exposes every section as a tab and wires it to its panel', () => {
    render(<Harness />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(4);
    expect(tabs[0]).toHaveAttribute('id', tabDomId('company'));
    expect(tabs[0]).toHaveAttribute('aria-controls', panelDomId('company'));
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
  });

  it('selects a section in one press', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole('tab', { name: 'team' }));

    expect(screen.getByRole('tab', { name: 'team' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'company' })).toHaveAttribute('aria-selected', 'false');
  });

  it('keeps only the selected tab in the tab order and moves with the arrows', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    // Roving tabindex: one Tab press reaches the tablist, arrows do the rest.
    expect(screen.getByRole('tab', { name: 'company' })).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('tab', { name: 'team' })).toHaveAttribute('tabindex', '-1');

    screen.getByRole('tab', { name: 'company' }).focus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('tab', { name: 'marketplace' })).toHaveAttribute(
      'aria-selected',
      'true',
    );

    await user.keyboard('{End}');
    expect(screen.getByRole('tab', { name: 'system' })).toHaveAttribute('aria-selected', 'true');

    // Wraps rather than dead-ending at the last section.
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'company' })).toHaveAttribute('aria-selected', 'true');
  });
});
