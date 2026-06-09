import { Store } from '@tauri-apps/plugin-store';
import { Stronghold, Client, Store as StrongholdStore } from '@tauri-apps/plugin-stronghold';

const SESSION_STORE_FILE = 'session.json';
const SESSION_META_KEY = 'cashier_session_meta';
const STRONGHOLD_CLIENT = 'sellary-cashier';
const STRONGHOLD_SNAPSHOT = 'sellary-stronghold.snapshot';
const STRONGHOLD_PASSWORD = 'sellary-mvp-key-2026-v1';
const STRONGHOLD_TOKEN_KEY = 'access_token';

export interface PersistedCashierSession {
  accessToken: string;
  expiresAt: string;
  companyId: number;
  companyName: string;
  userId: number;
  username: string;
  userRole: string;
}

export interface SessionMetadata {
  expiresAt: string;
  companyId: number;
  companyName: string;
  userId: number;
  username: string;
  userRole: string;
}

let store: Store | null = null;
let strongholdStore: StrongholdStore | null = null;

async function getStore(): Promise<Store> {
  if (!store) {
    store = await Store.load(SESSION_STORE_FILE);
  }
  return store;
}

async function getStrongholdStore(): Promise<StrongholdStore | null> {
  if (strongholdStore) {
    return strongholdStore;
  }
  try {
    const sh = await Stronghold.load(STRONGHOLD_SNAPSHOT, STRONGHOLD_PASSWORD);
    let client: Client;
    try {
      client = await sh.loadClient(STRONGHOLD_CLIENT);
    } catch {
      client = await sh.createClient(STRONGHOLD_CLIENT);
    }
    strongholdStore = client.getStore();
    await sh.save();
    return strongholdStore;
  } catch {
    console.warn(
      'Stronghold unavailable; falling back to app store token persistence'
    );
    return null;
  }
}

function decodeJwtExp(token: string): string {
  const [, payload] = token.split('.');
  if (!payload) {
    return new Date(0).toISOString();
  }
  const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
  const json = JSON.parse(atob(normalized));
  if (typeof json.exp !== 'number') {
    return new Date(0).toISOString();
  }
  return new Date(json.exp * 1000).toISOString();
}

export function getTokenExpiresAt(token: string): string {
  return decodeJwtExp(token);
}

export function isSessionExpired(session: PersistedCashierSession, now?: Date): boolean {
  const expiresAt = Date.parse(session.expiresAt);
  if (isNaN(expiresAt)) {
    return true;
  }
  return (now || new Date()).getTime() >= expiresAt;
}

export async function saveCashierSession(session: PersistedCashierSession): Promise<void> {
  const tokenBytes = Array.from(new TextEncoder().encode(session.accessToken));
  const st = await getStrongholdStore();
  if (st) {
    await st.remove(STRONGHOLD_TOKEN_KEY).catch(() => {});
    await st.insert(STRONGHOLD_TOKEN_KEY, tokenBytes);
  } else {
    const encodedToken = btoa(session.accessToken);
    const s = await getStore();
    await s.set('cashier_access_token_encoded', encodedToken);
    await s.save();
  }

  const meta: SessionMetadata = {
    expiresAt: session.expiresAt,
    companyId: session.companyId,
    companyName: session.companyName,
    userId: session.userId,
    username: session.username,
    userRole: session.userRole,
  };
  const s = await getStore();
  await s.set(SESSION_META_KEY, meta);
  await s.save();
}

export async function loadCashierSession(): Promise<PersistedCashierSession | null> {
  let accessToken: string | null = null;

  const st = await getStrongholdStore();
  if (st) {
    try {
      const raw = await st.get(STRONGHOLD_TOKEN_KEY);
      if (raw && raw.length > 0) {
        accessToken = new TextDecoder().decode(new Uint8Array(raw));
      }
    } catch {
      console.warn('Failed to read access token from Stronghold');
    }
  } else {
    const s = await getStore();
    const encodedToken = await s.get<string>('cashier_access_token_encoded') ?? null;
    if (encodedToken) {
      try {
        accessToken = atob(encodedToken);
      } catch {
        accessToken = null;
      }
    }
  }

  if (!accessToken) {
    return null;
  }

  const s = await getStore();
  const meta = await s.get<SessionMetadata>(SESSION_META_KEY);
  if (!meta) {
    return null;
  }

  return {
    accessToken,
    expiresAt: meta.expiresAt,
    companyId: meta.companyId,
    companyName: meta.companyName,
    userId: meta.userId,
    username: meta.username,
    userRole: meta.userRole,
  };
}

export async function clearCashierSession(): Promise<void> {
  const st = await getStrongholdStore();
  if (st) {
    await st.remove(STRONGHOLD_TOKEN_KEY).catch(() => {});
  }

  const s = await getStore();
  await s.delete('cashier_access_token_encoded').catch(() => {});
  await s.delete(SESSION_META_KEY).catch(() => {});
  await s.save();
}

export const sessionTestInternals = { decodeJwtExp };
