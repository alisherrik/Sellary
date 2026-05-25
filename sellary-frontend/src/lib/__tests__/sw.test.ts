import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { registerSW, onSWUpdate } from '../sw';

function flushPromises() {
    return new Promise(resolve => setTimeout(resolve, 0));
}

describe('sw - Service Worker Registration', () => {
    let mockRegister: ReturnType<typeof vi.fn>;
    let mockRegistration: { addEventListener: ReturnType<typeof vi.fn>; installing: any };
    let mockInstallingWorker: { addEventListener: ReturnType<typeof vi.fn>; state: string };
    let loadCallbacks: Array<() => void>;
    let controllerChangeCallbacks: Array<() => void>;
    let reloadMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        mockRegister = vi.fn();
        mockRegistration = {
            addEventListener: vi.fn(),
            installing: null,
        };
        mockInstallingWorker = {
            addEventListener: vi.fn(),
            state: 'installing',
        };

        loadCallbacks = [];
        controllerChangeCallbacks = [];

        vi.spyOn(window, 'addEventListener').mockImplementation((event: string, cb: any) => {
            if (event === 'load') loadCallbacks.push(cb);
        });

        const swAddEventListener = vi.fn().mockImplementation((event: string, cb: any) => {
            if (event === 'controllerchange') controllerChangeCallbacks.push(cb);
        });

        Object.defineProperty(navigator, 'serviceWorker', {
            value: {
                register: mockRegister,
                addEventListener: swAddEventListener,
                controller: null,
            },
            configurable: true,
            writable: true,
        });

        reloadMock = vi.fn();
        vi.spyOn(window.location, 'reload').mockImplementation(reloadMock);
        vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
        loadCallbacks = [];
        controllerChangeCallbacks = [];
    });

    it('should register service worker on load', () => {
        mockRegister.mockResolvedValue(mockRegistration);
        registerSW();

        expect(loadCallbacks.length).toBe(1);
        loadCallbacks[0]();

        expect(mockRegister).toHaveBeenCalledWith('/sw.js');
    });

    it('should handle registration failure gracefully', async () => {
        const error = new Error('SW registration failed');
        mockRegister.mockRejectedValue(error);

        registerSW();
        loadCallbacks[0]();

        await flushPromises();

        expect(console.error).toHaveBeenCalledWith('SW registration failed:', error);
    });

    it('should skip waiting and reload on controller change', () => {
        mockRegister.mockResolvedValue(mockRegistration);

        registerSW();
        loadCallbacks[0]();

        expect(controllerChangeCallbacks.length).toBe(1);

        controllerChangeCallbacks[0]();

        expect(reloadMock).toHaveBeenCalled();
    });

    it('should not reload twice on controller change (refreshing guard)', () => {
        mockRegister.mockResolvedValue(mockRegistration);

        registerSW();
        loadCallbacks[0]();

        controllerChangeCallbacks[0]();
        controllerChangeCallbacks[0]();

        expect(reloadMock).toHaveBeenCalledTimes(1);
    });

    it('should return early when serviceWorker is not available (SSR guard)', () => {
        delete (navigator as any).serviceWorker;

        registerSW();

        expect(loadCallbacks.length).toBe(0);
    });
});

describe('sw - Update Callback', () => {
    let mockRegister: ReturnType<typeof vi.fn>;
    let mockRegistration: { addEventListener: ReturnType<typeof vi.fn>; installing: any };
    let mockInstallingWorker: { addEventListener: ReturnType<typeof vi.fn>; state: string };
    let loadCallbacks: Array<() => void>;

    beforeEach(() => {
        mockRegister = vi.fn();
        mockRegistration = {
            addEventListener: vi.fn(),
            installing: null,
        };
        mockInstallingWorker = {
            addEventListener: vi.fn(),
            state: 'installing',
        };

        loadCallbacks = [];

        vi.spyOn(window, 'addEventListener').mockImplementation((event: string, cb: any) => {
            if (event === 'load') loadCallbacks.push(cb);
        });

        Object.defineProperty(navigator, 'serviceWorker', {
            value: {
                register: mockRegister,
                addEventListener: vi.fn(),
                controller: null,
            },
            configurable: true,
            writable: true,
        });

        vi.spyOn(window.location, 'reload').mockImplementation(() => {});
        vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
        loadCallbacks = [];
    });

    function getUpdateFoundCallback() {
        const calls = mockRegistration.addEventListener.mock.calls;
        const found = calls.find((call: any) => call[0] === 'updatefound');
        return found ? found[1] : null;
    }

    function getStateChangeCallback() {
        const calls = mockInstallingWorker.addEventListener.mock.calls;
        const found = calls.find((call: any) => call[0] === 'statechange');
        return found ? found[1] : null;
    }

    it('should not crash when callback is not set', async () => {
        mockRegister.mockResolvedValue(mockRegistration);

        registerSW();
        loadCallbacks[0]();

        await flushPromises();

        const updateFoundCb = getUpdateFoundCallback();
        expect(updateFoundCb).toBeDefined();

        mockRegistration.installing = mockInstallingWorker;
        updateFoundCb();

        const stateChangeCb = getStateChangeCallback();
        expect(stateChangeCb).toBeDefined();

        mockInstallingWorker.state = 'installed';
        Object.defineProperty(navigator, 'serviceWorker', {
            value: {
                ...navigator.serviceWorker,
                controller: {} as any,
            },
            configurable: true,
            writable: true,
        });

        expect(() => stateChangeCb()).not.toThrow();
    });

    it('should call update callback on SW update found', async () => {
        mockRegister.mockResolvedValue(mockRegistration);

        const updateCallback = vi.fn();
        onSWUpdate(updateCallback);

        registerSW();
        loadCallbacks[0]();

        await flushPromises();

        const updateFoundCb = getUpdateFoundCallback();
        expect(updateFoundCb).toBeDefined();

        mockRegistration.installing = mockInstallingWorker;
        updateFoundCb();

        const stateChangeCb = getStateChangeCallback();
        expect(stateChangeCb).toBeDefined();

        mockInstallingWorker.state = 'installed';
        Object.defineProperty(navigator, 'serviceWorker', {
            value: {
                ...navigator.serviceWorker,
                controller: {} as any,
            },
            configurable: true,
            writable: true,
        });

        stateChangeCb();

        expect(updateCallback).toHaveBeenCalled();
    });
});
