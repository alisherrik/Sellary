import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCheck = vi.hoisted(() => vi.fn());
const mockRelaunch = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/plugin-updater', () => ({ check: mockCheck }));
vi.mock('@tauri-apps/plugin-process', () => ({ relaunch: mockRelaunch }));

import { checkForUpdate, applyUpdate } from '../updater';

describe('updater', () => {
  beforeEach(() => {
    mockCheck.mockReset();
    mockRelaunch.mockReset();
  });

  it('returns the update when one is available', async () => {
    const update = { version: '0.2.0', currentVersion: '0.1.0' };
    mockCheck.mockResolvedValue(update);
    expect(await checkForUpdate()).toBe(update);
  });

  it('returns null when up to date (check resolves null/undefined)', async () => {
    mockCheck.mockResolvedValue(null);
    expect(await checkForUpdate()).toBeNull();
  });

  it('never throws — returns null when check fails (offline / not under Tauri)', async () => {
    mockCheck.mockRejectedValue(new Error('not running under tauri'));
    expect(await checkForUpdate()).toBeNull();
  });

  it('applyUpdate downloads+installs, then relaunches', async () => {
    const downloadAndInstall = vi.fn().mockResolvedValue(undefined);
    await applyUpdate({ downloadAndInstall } as never);
    expect(downloadAndInstall).toHaveBeenCalledOnce();
    expect(mockRelaunch).toHaveBeenCalledOnce();
  });
});
