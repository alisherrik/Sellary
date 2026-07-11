import { getStoreValue, setStoreValue } from './storage';

const DEFAULT_API_URL = 'http://127.0.0.1:8001';

let apiBaseUrl: string | null = null;
let accessToken: string | null = null;

export async function getApiBaseUrl(): Promise<string> {
  if (!apiBaseUrl) {
    const stored = await getStoreValue<string>('api_base_url');
    apiBaseUrl = stored || DEFAULT_API_URL;
  }
  return apiBaseUrl;
}

export async function setApiBaseUrl(url: string): Promise<void> {
  apiBaseUrl = url;
  await setStoreValue('api_base_url', url);
}

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const base = (await getApiBaseUrl()).replace(/\/$/, '');
  const url = `${base}${path}`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };

  if (accessToken && !headers.Authorization) {
    headers['Authorization'] = `Bearer ${accessToken}`;
  }

  const response = await fetch(url, {
    ...options,
    headers,
  });

  if (response.status === 204 || response.headers.get('content-length') === '0') {
    return undefined as T;
  }

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    if (response.status === 401) {
      accessToken = null;
    }
    throw new ApiError(
      formatApiError(data, response.status),
      response.status,
      data
    );
  }

  return data as T;
}

export class ApiError extends Error {
  status: number;
  data?: unknown;

  constructor(message: string, status: number, data?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

export interface LoginTokenResponse {
  login_token: string;
  token_type: string;
  user: {
    id: number;
    username: string;
    email: string;
    full_name?: string | null;
    global_role: string;
    is_active: boolean;
    created_at: string;
  };
  companies: Array<{ id: number; name: string; slug: string }>;
}

export interface AccessTokenResponse {
  access_token: string;
  token_type: string;
  user: {
    id: number;
    username: string;
    email: string;
    full_name?: string | null;
    global_role: string;
    is_active: boolean;
    created_at: string;
  };
  current_company: {
    id: number;
    name: string;
    slug: string;
    is_active: boolean;
    role: string;
    is_default: boolean;
  };
  companies: Array<{
    id: number;
    name: string;
    slug: string;
    is_active: boolean;
    role: string;
    is_default: boolean;
  }>;
}

export async function login(username: string, password: string): Promise<LoginTokenResponse> {
  const base = (await getApiBaseUrl()).replace(/\/$/, '');
  const response = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => null);
    throw new ApiError(formatApiError(err, response.status), response.status, err);
  }

  return response.json();
}

export async function selectCompany(
  loginToken: string,
  companyId: number
): Promise<AccessTokenResponse> {
  const token = loginToken.trim();
  const response = await apiFetch<AccessTokenResponse>('/api/auth/select-company', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ company_id: companyId }),
  });
  setAccessToken(response.access_token);
  return response;
}

export async function checkHealth(): Promise<boolean> {
  try {
    const base = (await getApiBaseUrl()).replace(/\/$/, '');
    const response = await fetch(`${base}/health`, { method: 'POST' });
    return response.ok;
  } catch {
    return false;
  }
}

export interface SyncBootstrapResponse {
  company_id: number;
  company_name: string;
  user_id: number;
  user_username: string;
  user_role: string;
  server_time: string;
  products: Array<{
    id: number;
    barcode: string | null;
    name: string;
    uom: string;
    category_id: number | null;
    sell_price: number;
    tax_percent: number;
    stock_quantity: number;
    is_active: boolean;
    updated_at: string;
  }>;
  categories: Array<{
    id: number;
    name: string;
    is_active: boolean;
    updated_at: string | null;
  }>;
}

export interface SyncSaleItem {
  product_id: number;
  quantity: number;
  sell_price: number;
}

export interface SyncSale {
  client_sale_id: string;
  idempotency_key: string;
  created_at_client: string;
  payment_method: string;
  card_type?: string | null;
  discount_amount: number;
  paid_amount: number;
  change_amount: number;
  notes?: string | null;
  items: SyncSaleItem[];
}

export interface SyncWarning {
  type: string;
  product_id: number;
  product_name: string;
  requested: number;
  available: number;
  new_balance: number;
}

export interface SyncSaleResult {
  client_sale_id: string;
  status: 'synced' | 'duplicate' | 'failed';
  sale_id?: number | null;
  warnings?: SyncWarning[] | null;
  error?: string | null;
}

export interface SyncSalesResponse {
  results: SyncSaleResult[];
}

// Owned by api.ts per contract C-7 (mirrors SyncSaleResult). Consumed by db.ts's
// applyCustomerIdMap; credit-sync will construct these from the sync/customers response.
export interface SyncCustomerResult {
  client_customer_id: string;
  status: 'synced' | 'duplicate' | 'failed';
  server_id?: number | null;
  error?: string | null;
}

// Owned by api.ts per contract C-7 (mirrors SyncWarning). Consumed by db.ts's
// applyPaymentResults; credit-sync will construct these from the sync/payments response.
export interface SyncPaymentWarning {
  type: string;
  requested: number;
  applied: number;
}

// Owned by api.ts per contract C-7. Consumed by db.ts's applyPaymentResults; credit-sync will
// construct these from the sync/payments response.
export interface SyncPaymentResult {
  client_payment_id: string;
  status: 'synced' | 'duplicate' | 'failed';
  applied_amount?: number | null;
  warnings?: SyncPaymentWarning[] | null;
  error?: string | null;
}

export async function fetchBootstrap(): Promise<SyncBootstrapResponse> {
  return apiFetch('/api/sync/bootstrap');
}

export async function pushSales(sales: SyncSale[]): Promise<SyncSalesResponse> {
  return apiFetch('/api/sync/sales', {
    method: 'POST',
    body: JSON.stringify({ sales }),
  });
}

export interface DeviceRegisterResponse {
  device_id: string;
  device_token: string;
  name: string | null;
  expires_at: string;
}

export interface DeviceRefreshResponse {
  access_token: string;
  token_type: string;
  expires_at: string; // Contract §4.7: device-token expiry mirror (NOT device_token_expires_at)
}

export async function registerDevice(
  name: string,
  deviceId?: string
): Promise<DeviceRegisterResponse> {
  const id = deviceId ?? crypto.randomUUID();
  return apiFetch<DeviceRegisterResponse>('/api/auth/devices/register', {
    method: 'POST',
    body: JSON.stringify({ name, device_id: id }),
  });
}

export async function refreshDevice(
  deviceId: string,
  deviceToken: string
): Promise<DeviceRefreshResponse> {
  const base = (await getApiBaseUrl()).replace(/\/$/, '');
  const response = await fetch(`${base}/api/auth/devices/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ device_id: deviceId, device_token: deviceToken }),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiError(formatApiError(data, response.status), response.status, data);
  }
  const parsed = data as DeviceRefreshResponse;
  setAccessToken(parsed.access_token);
  return parsed;
}

function formatApiError(data: unknown, status: number): string {
  if (typeof data === 'object' && data !== null) {
    const detail = (data as { detail?: unknown; message?: unknown }).detail;
    const message = (data as { message?: unknown }).message;

    if (typeof detail === 'string') {
      return detail;
    }
    if (Array.isArray(detail)) {
      return detail
        .map((item) => {
          if (typeof item === 'string') return item;
          if (item && typeof item === 'object' && 'msg' in item) {
            return String((item as { msg: unknown }).msg);
          }
          return JSON.stringify(item);
        })
        .join('; ');
    }
    if (typeof message === 'string') {
      return message;
    }
  }

  return `HTTP ${status}`;
}
