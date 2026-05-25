import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getStorageEstimate, isStorageAvailable, getStorageErrorMessage } from '../storage';

describe('storage - getStorageEstimate', () => {
    it('should return storage estimate in MB', async () => {
        vi.mocked(navigator.storage.estimate).mockResolvedValue({
            usage: 50 * 1024 * 1024,
            quota: 200 * 1024 * 1024,
        });

        const result = await getStorageEstimate();

        expect(result.usage).toBe(50);
        expect(result.quota).toBe(200);
        expect(result.percentUsed).toBe(25);
    });

    it('should handle zero usage gracefully', async () => {
        vi.mocked(navigator.storage.estimate).mockResolvedValue({
            usage: 0,
            quota: 200 * 1024 * 1024,
        });

        const result = await getStorageEstimate();

        expect(result.usage).toBe(0);
        expect(result.quota).toBe(200);
        expect(result.percentUsed).toBe(0);
    });

    it('should handle undefined usage/quota gracefully', async () => {
        vi.mocked(navigator.storage.estimate).mockResolvedValue({
            usage: undefined as any,
            quota: undefined as any,
        });

        const result = await getStorageEstimate();

        expect(result.usage).toBe(0);
        expect(result.quota).toBe(0);
        expect(result.percentUsed).toBeNaN();
    });

    it('should handle null usage/quota gracefully', async () => {
        vi.mocked(navigator.storage.estimate).mockResolvedValue({
            usage: null as any,
            quota: null as any,
        });

        const result = await getStorageEstimate();

        expect(result.usage).toBe(0);
        expect(result.quota).toBe(0);
    });

    it('should return correct percentUsed for half quota', async () => {
        vi.mocked(navigator.storage.estimate).mockResolvedValue({
            usage: 50 * 1024 * 1024,
            quota: 100 * 1024 * 1024,
        });

        const result = await getStorageEstimate();

        expect(result.percentUsed).toBe(50);
    });
});

describe('storage - isStorageAvailable', () => {
    beforeEach(async () => {
        vi.mocked(navigator.storage.estimate).mockResolvedValue({
            usage: 10 * 1024 * 1024,
            quota: 100 * 1024 * 1024,
        });
        await isStorageAvailable();
        vi.clearAllMocks();
    });

    it('should return true when usage is below 50MB', async () => {
        vi.mocked(navigator.storage.estimate).mockResolvedValue({
            usage: 30 * 1024 * 1024,
            quota: 100 * 1024 * 1024,
        });

        const result = await isStorageAvailable();

        expect(result).toBe(true);
    });

    it('should return false when usage exceeds 50MB', async () => {
        vi.mocked(navigator.storage.estimate).mockResolvedValue({
            usage: 55 * 1024 * 1024,
            quota: 100 * 1024 * 1024,
        });

        const result = await isStorageAvailable();

        expect(result).toBe(false);
    });

    it('should return false when usage equals 50MB exactly', async () => {
        vi.mocked(navigator.storage.estimate).mockResolvedValue({
            usage: 50 * 1024 * 1024,
            quota: 100 * 1024 * 1024,
        });

        const result = await isStorageAvailable();

        expect(result).toBe(false);
    });

    it('should warn when usage exceeds 40MB', async () => {
        vi.mocked(navigator.storage.estimate).mockResolvedValue({
            usage: 45 * 1024 * 1024,
            quota: 100 * 1024 * 1024,
        });

        const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

        const result = await isStorageAvailable();

        expect(result).toBe(true);
        expect(consoleSpy).toHaveBeenCalledWith(
            expect.stringContaining('Storage usage high')
        );

        consoleSpy.mockRestore();
    });

    it('should not warn twice for consecutive high usage calls', async () => {
        vi.mocked(navigator.storage.estimate).mockResolvedValue({
            usage: 45 * 1024 * 1024,
            quota: 100 * 1024 * 1024,
        });

        const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

        await isStorageAvailable();
        await isStorageAvailable();

        expect(consoleSpy).toHaveBeenCalledTimes(1);

        consoleSpy.mockRestore();
    });
});

describe('storage - getStorageErrorMessage', () => {
    it('should return non-empty error message', () => {
        const message = getStorageErrorMessage();

        expect(message).toBeTruthy();
        expect(message.length).toBeGreaterThan(0);
    });

    it('should return Russian language message', () => {
        const message = getStorageErrorMessage();

        expect(message).toContain('Недостаточно места');
        expect(message).toContain('Очистите');
    });
});
