import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { InstallPrompt } from '../InstallPrompt';

describe('InstallPrompt', () => {
    beforeEach(() => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    function createBeforeInstallPromptEvent(): Event & {
        prompt: ReturnType<typeof vi.fn>;
        userChoice: Promise<{ outcome: string }>;
        preventDefault: ReturnType<typeof vi.fn>;
    } {
        const promptFn = vi.fn().mockResolvedValue(undefined);
        const userChoice = Promise.resolve({ outcome: 'accepted' });

        const event = new Event('beforeinstallprompt') as any;
        event.preventDefault = vi.fn();
        event.prompt = promptFn;
        event.userChoice = userChoice;

        return event as any;
    }

    it('should not render when no deferredPrompt and not installed', () => {
        window.matchMedia = vi.fn().mockReturnValue({ matches: false });

        const { container } = render(<InstallPrompt />);

        expect(container.innerHTML).toBe('');
    });

    it('should render install button when beforeinstallprompt fires', async () => {
        window.matchMedia = vi.fn().mockReturnValue({ matches: false });

        render(<InstallPrompt />);

        const event = createBeforeInstallPromptEvent();
        await act(async () => {
            window.dispatchEvent(event);
        });

        expect(screen.getByText('Установить приложение')).toBeInTheDocument();
    });

    it('should hide when already installed (standalone mode)', () => {
        window.matchMedia = vi.fn().mockReturnValue({ matches: true });

        const { container } = render(<InstallPrompt />);

        expect(container.innerHTML).toBe('');
    });

    it('should call prompt() on button click', async () => {
        window.matchMedia = vi.fn().mockReturnValue({ matches: false });

        render(<InstallPrompt />);

        const event = createBeforeInstallPromptEvent();
        const promptFn = event.prompt;

        await act(async () => {
            window.dispatchEvent(event);
        });

        const button = screen.getByText('Установить приложение');
        await act(async () => {
            fireEvent.click(button);
        });

        expect(promptFn).toHaveBeenCalled();
    });

    it('should hide button after install accepted', async () => {
        window.matchMedia = vi.fn().mockReturnValue({ matches: false });

        render(<InstallPrompt />);

        const event = createBeforeInstallPromptEvent();

        await act(async () => {
            window.dispatchEvent(event);
        });

        const button = screen.getByText('Установить приложение');
        await act(async () => {
            fireEvent.click(button);
        });

        expect(screen.queryByText('Установить приложение')).toBeNull();
    });

    it('should hide button after appinstalled event', async () => {
        window.matchMedia = vi.fn().mockReturnValue({ matches: false });

        render(<InstallPrompt />);

        const event = createBeforeInstallPromptEvent();
        await act(async () => {
            window.dispatchEvent(event);
        });

        expect(screen.getByText('Установить приложение')).toBeInTheDocument();

        await act(async () => {
            window.dispatchEvent(new Event('appinstalled'));
        });

        expect(screen.queryByText('Установить приложение')).toBeNull();
    });

    it('should hide button after user dismisses install prompt', async () => {
        window.matchMedia = vi.fn().mockReturnValue({ matches: false });

        render(<InstallPrompt />);

        const event = new Event('beforeinstallprompt') as any;
        event.preventDefault = vi.fn();
        event.prompt = vi.fn().mockResolvedValue(undefined);
        event.userChoice = Promise.resolve({ outcome: 'dismissed' });

        await act(async () => {
            window.dispatchEvent(event);
        });

        const button = screen.getByText('Установить приложение');
        await act(async () => {
            fireEvent.click(button);
        });

        expect(screen.queryByText('Установить приложение')).toBeNull();
    });

    it('should remove event listener on unmount', () => {
        window.matchMedia = vi.fn().mockReturnValue({ matches: false });

        const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener');

        const { unmount } = render(<InstallPrompt />);

        unmount();

        expect(removeEventListenerSpy).toHaveBeenCalledWith(
            'beforeinstallprompt',
            expect.any(Function)
        );
    });

    it('should render button with Download icon', async () => {
        window.matchMedia = vi.fn().mockReturnValue({ matches: false });

        render(<InstallPrompt />);

        const event = createBeforeInstallPromptEvent();
        await act(async () => {
            window.dispatchEvent(event);
        });

        const button = screen.getByText('Установить приложение');
        expect(button.querySelector('svg')).toBeTruthy();
    });

    it('should call preventDefault on beforeinstallprompt event', async () => {
        window.matchMedia = vi.fn().mockReturnValue({ matches: false });

        render(<InstallPrompt />);

        const event = createBeforeInstallPromptEvent();

        await act(async () => {
            window.dispatchEvent(event);
        });

        expect(event.preventDefault).toHaveBeenCalled();
    });
});
