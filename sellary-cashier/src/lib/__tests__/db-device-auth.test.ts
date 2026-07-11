import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createTestDb, FakeDatabase } from './helpers/fakeDb';

let fake: FakeDatabase;
vi.mock('@tauri-apps/plugin-sql', () => ({ default: { load: async () => fake } }));
let db: typeof import('../db');

beforeEach(async () => {
  vi.resetModules();
  fake = createTestDb();
  db = await import('../db');
});

describe('device-auth DAO', () => {
  it('getDeviceAuth returns null before provisioning', async () => {
    expect(await db.getDeviceAuth()).toBeNull();
  });

  it('ensureDeviceAuth creates the single id=1 row once and is idempotent', async () => {
    const a = await db.ensureDeviceAuth('dev-uuid-1');
    expect(a.id).toBe(1);
    expect(a.device_id).toBe('dev-uuid-1');
    const b = await db.ensureDeviceAuth('dev-uuid-2'); // does NOT overwrite existing device_id
    expect(b.device_id).toBe('dev-uuid-1');
    const rows = await fake.select<{ c: number }[]>('SELECT COUNT(*) AS c FROM device_auth');
    expect(rows[0].c).toBe(1);
  });

  it('setPinHash and bindDeviceIdentity persist onto the single row', async () => {
    await db.ensureDeviceAuth('dev-uuid-1');
    await db.setPinHash('$argon2id$v=19$m=...$hash');
    await db.bindDeviceIdentity({
      user_id: 7, username: 'kassa', company_id: 3, company_name: 'Shop',
      user_role: 'cashier', device_token_expires_at: '2026-12-31T00:00:00.000Z',
      last_online_auth_at: '2026-07-10T00:00:00.000Z',
    });
    const a = await db.getDeviceAuth();
    expect(a?.pin_hash).toBe('$argon2id$v=19$m=...$hash');
    expect(a?.pin_set_at).not.toBeNull();
    expect(a?.user_id).toBe(7);
    expect(a?.company_name).toBe('Shop');
    expect(a?.device_token_expires_at).toBe('2026-12-31T00:00:00.000Z');
  });

  it('recordPinFailure increments and lockout; resetPinFailures clears', async () => {
    await db.ensureDeviceAuth('dev-uuid-1');
    await db.recordPinFailure();
    await db.recordPinFailure('2026-07-10T00:05:00.000Z');
    let a = await db.getDeviceAuth();
    expect(a?.failed_pin_attempts).toBe(2);
    expect(a?.locked_until).toBe('2026-07-10T00:05:00.000Z');
    await db.resetPinFailures();
    a = await db.getDeviceAuth();
    expect(a?.failed_pin_attempts).toBe(0);
    expect(a?.locked_until).toBeNull();
  });
});
