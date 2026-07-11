import { describe, it, expect, beforeEach, vi } from 'vitest';

const { mockInvoke, mockGetDeviceAuth, mockSetPinHash } = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
  mockGetDeviceAuth: vi.fn(),
  mockSetPinHash: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: mockInvoke }));
vi.mock('@tauri-apps/api/path', () => ({
  appDataDir: vi.fn().mockResolvedValue('/mock/appdata'),
}));
vi.mock('../db', () => ({
  getDeviceAuth: mockGetDeviceAuth,
  setPinHash: mockSetPinHash,
}));

import {
  saveDeviceCredential,
  loadDeviceCredential,
  clearDeviceCredential,
  savePin,
  verifyPin,
  clearPin,
} from '../session';

describe('device credential (store fallback)', () => {
  beforeEach(async () => {
    await clearDeviceCredential();
  });

  it('returns null when nothing is stored', async () => {
    expect(await loadDeviceCredential()).toBeNull();
  });

  it('round-trips token + expiry', async () => {
    await saveDeviceCredential('dev-token-abc', '2026-12-31T00:00:00.000Z');
    const cred = await loadDeviceCredential();
    expect(cred).toEqual({
      deviceToken: 'dev-token-abc',
      expiresAt: '2026-12-31T00:00:00.000Z',
    });
  });

  it('clear removes the credential', async () => {
    await saveDeviceCredential('dev-token-abc', '2026-12-31T00:00:00.000Z');
    await clearDeviceCredential();
    expect(await loadDeviceCredential()).toBeNull();
  });
});

describe('PIN helpers', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    mockGetDeviceAuth.mockReset();
    mockSetPinHash.mockReset();
  });

  it('savePin hashes via the Rust command and stores the PHC', async () => {
    mockInvoke.mockResolvedValue('$argon2id$phc');
    await savePin('1234');
    expect(mockInvoke).toHaveBeenCalledWith('pin_hash', { pin: '1234' });
    expect(mockSetPinHash).toHaveBeenCalledWith('$argon2id$phc');
  });

  it('verifyPin returns false when no hash is stored', async () => {
    mockGetDeviceAuth.mockResolvedValue({ pin_hash: null });
    expect(await verifyPin('1234')).toBe(false);
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('verifyPin delegates to the Rust command with the stored PHC', async () => {
    mockGetDeviceAuth.mockResolvedValue({ pin_hash: '$argon2id$phc' });
    mockInvoke.mockResolvedValue(true);
    expect(await verifyPin('1234')).toBe(true);
    expect(mockInvoke).toHaveBeenCalledWith('pin_verify', {
      pin: '1234',
      phc: '$argon2id$phc',
    });
  });

  it('clearPin stores an empty hash', async () => {
    await clearPin();
    expect(mockSetPinHash).toHaveBeenCalledWith('');
  });
});
