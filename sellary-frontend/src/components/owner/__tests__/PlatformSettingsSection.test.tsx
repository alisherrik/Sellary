import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import PlatformSettingsSection from '../PlatformSettingsSection';

const settings = {
  telegram_bot_token: { is_set: true, masked: '••••1234', source: 'db' as const },
  telegram_webhook_secret: { is_set: false, masked: '', source: 'unset' as const },
  cloudinary_url: { is_set: true, masked: '••••abcd', source: 'env' as const },
};

describe('PlatformSettingsSection', () => {
  it('shows masked hints and never renders plaintext', () => {
    render(<PlatformSettingsSection settings={settings} onSave={vi.fn()} />);
    expect(screen.getByText(/••••1234/)).toBeInTheDocument();
    expect(screen.getByText(/Не задано/)).toBeInTheDocument();
  });

  it('omits blank fields from the save payload (blank preserves)', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<PlatformSettingsSection settings={settings} onSave={onSave} />);
    fireEvent.change(screen.getByLabelText(/Токен бота/i), { target: { value: 'newTOKEN' } });
    fireEvent.click(screen.getByRole('button', { name: /Сохранить/i }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ telegram_bot_token: 'newTOKEN' }));
  });
});
