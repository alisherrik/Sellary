'use client';

import axios from 'axios';

import { clearOwnerSession, getOwnerAccessToken } from './owner-session';
import { clearStoredSession, getActiveAccessToken } from './session';
import type {
  AuthSession,
  CompanySession,
  LoginResponse,
  ManagedCompany,
  ManagedMembership,
  ManagedUser,
  OwnerLoginResponse,
  OwnerSession,
  PurchaseOrder,
  PurchaseOrderPayload,
  ReceivePurchaseOrderPayload,
  VoidPreview,
  VoidResult,
} from './types';

export const API_URL = (process.env.NEXT_PUBLIC_API_URL || '/api').replace(/\/$/, '');
export const API_PROXY_TARGET = (
  process.env.NEXT_PUBLIC_API_PROXY_TARGET || 'http://127.0.0.1:8001'
).replace(/\/$/, '');

const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

const ownerClient = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

if (typeof window !== 'undefined') {
  api.interceptors.request.use(
    (config) => {
      const token = getActiveAccessToken();
      config.headers = config.headers ?? {};

      if (token && !config.headers.Authorization) {
        config.headers.Authorization = `Bearer ${token}`;
      }

      return config;
    },
    (error) => Promise.reject(error),
  );

  api.interceptors.response.use(
    (response) => response,
    (error) => {
      if (error.response?.status === 401) {
        clearStoredSession();
        window.location.href = '/login';
      }

      return Promise.reject(error);
    },
  );

  ownerClient.interceptors.request.use(
    (config) => {
      const token = getOwnerAccessToken();
      config.headers = config.headers ?? {};

      if (token && !config.headers.Authorization) {
        config.headers.Authorization = `Bearer ${token}`;
      }

      return config;
    },
    (error) => Promise.reject(error),
  );

  ownerClient.interceptors.response.use(
    (response) => response,
    (error) => {
      if (error.response?.status === 401) {
        clearOwnerSession();
        window.location.href = '/owner/login';
      }

      return Promise.reject(error);
    },
  );
}

export const authApi = {
  login: (username: string, password: string) =>
    api.post<LoginResponse>(`/auth/login?_t=${Date.now()}`, { username, password }),
  selectCompany: (companyId: number, loginToken: string) =>
    api.post<CompanySession>(
      '/auth/select-company',
      { company_id: companyId },
      {
        headers: {
          Authorization: `Bearer ${loginToken}`,
        },
      },
    ),
  switchCompany: (companyId: number) =>
    api.post<CompanySession>('/auth/switch-company', { company_id: companyId }),
  logout: () => api.post('/auth/logout'),
  me: () => api.get<AuthSession>('/auth/me'),
};

export const ownerApi = {
  login: (username: string, password: string) =>
    ownerClient.post<OwnerLoginResponse>('/owner/auth/login', { username, password }),
  session: () => ownerClient.get<OwnerSession>('/owner/session'),
  getUsers: (params?: { search?: string }) =>
    ownerClient.get<ManagedUser[]>('/owner/users', { params }),
  createUser: (data: {
    username: string;
    email: string;
    full_name?: string;
    password: string;
    is_active?: boolean;
  }) => ownerClient.post<ManagedUser>('/owner/users', data),
  updateUser: (
    id: number,
    data: {
      username?: string;
      email?: string;
      full_name?: string;
      is_active?: boolean;
    },
  ) => ownerClient.patch<ManagedUser>(`/owner/users/${id}`, data),
  getCompanies: (params?: { search?: string }) =>
    ownerClient.get<ManagedCompany[]>('/owner/companies', { params }),
  createCompany: (data: { name: string; slug?: string; is_active?: boolean }) =>
    ownerClient.post<ManagedCompany>('/owner/companies', data),
  updateCompany: (
    id: number,
    data: { name?: string; slug?: string; is_active?: boolean },
  ) => ownerClient.patch<ManagedCompany>(`/owner/companies/${id}`, data),
  getMemberships: (params?: { search?: string }) =>
    ownerClient.get<ManagedMembership[]>('/owner/memberships', { params }),
  createMembership: (data: {
    user_id: number;
    company_id: number;
    role: 'admin' | 'manager' | 'cashier';
    is_default?: boolean;
    is_active?: boolean;
  }) => ownerClient.post<ManagedMembership>('/owner/memberships', data),
  updateMembership: (
    id: number,
    data: {
      role?: 'admin' | 'manager' | 'cashier';
      is_default?: boolean;
      is_active?: boolean;
    },
  ) => ownerClient.patch<ManagedMembership>(`/owner/memberships/${id}`, data),
  enterCompany: (companyId: number) =>
    ownerClient.post<CompanySession>(`/owner/companies/${companyId}/enter`),
};

export const adminApi = {
  getUsers: (params?: { search?: string }) => api.get<ManagedUser[]>('/admin/users', { params }),
  createUser: (data: {
    username: string;
    email: string;
    full_name?: string;
    password: string;
    role: 'admin' | 'manager' | 'cashier';
    is_active?: boolean;
    is_default?: boolean;
  }) => api.post<ManagedUser>('/admin/users', data),
  createMembership: (data: {
    user_id?: number;
    identifier?: string;
    role: 'admin' | 'manager' | 'cashier';
    is_default?: boolean;
    is_active?: boolean;
  }) => api.post<ManagedMembership>('/admin/memberships', data),
  updateMembership: (
    id: number,
    data: {
      role?: 'admin' | 'manager' | 'cashier';
      is_default?: boolean;
      is_active?: boolean;
    },
  ) => api.patch<ManagedMembership>(`/admin/memberships/${id}`, data),
};

export const productsApi = {
  getAll: (params?: any) => api.get('/products', { params }),
  getById: (id: number) => api.get(`/products/${id}`),
  getByBarcode: (barcode: string) => api.get(`/products/barcode/${barcode}`),
  search: (q: string) => api.get('/products/search', { params: { q } }),
  create: (data: any) => api.post('/products', data),
  update: (id: number, data: any) => api.put(`/products/${id}`, data),
  delete: (id: number) => api.delete(`/products/${id}`),
  getLowStock: () => api.get('/products/low-stock'),
};

export const salesApi = {
  getAll: (params?: any) => api.get('/sales', { params }),
  getById: (id: number) => api.get(`/sales/${id}`),
  create: (data: any, idempotencyKey?: string) => {
    const key = idempotencyKey || generateIdempotencyKey();
    return api.post('/sales', data, { headers: { 'Idempotency-Key': key } });
  },
  cancel: (id: number, idempotencyKey?: string) => {
    const key = idempotencyKey || generateIdempotencyKey();
    return api.post(`/sales/${id}/cancel`, {}, { headers: { 'Idempotency-Key': key } });
  },
  processReturn: (id: number, data: any, idempotencyKey?: string) => {
    const key = idempotencyKey || generateIdempotencyKey();
    return api.post(`/sales/${id}/return`, data, { headers: { 'Idempotency-Key': key } });
  },
  getReturns: (id: number) => api.get(`/sales/${id}/returns`),
  previewVoid: (id: number) => api.get<VoidPreview>(`/sales/${id}/void-preview`),
  void: (id: number, reason: string, idempotencyKey?: string) => {
    const key = idempotencyKey || generateIdempotencyKey();
    return api.post<VoidResult>(`/sales/${id}/void`, { reason }, {
      headers: { 'Idempotency-Key': key },
    });
  },
};

export const inventoryApi = {
  adjust: (data: any, idempotencyKey?: string) => {
    const key = idempotencyKey || generateIdempotencyKey();
    return api.post('/inventory/adjust', data, { headers: { 'Idempotency-Key': key } });
  },
  getLogs: (params?: any) => api.get('/inventory/logs', { params }),
  getValuation: () => api.get('/inventory/valuation'),
};

export const reportsApi = {
  getDashboard: () => api.get('/reports/dashboard'),
  getDailySales: (params?: any) => api.get('/reports/daily-sales', { params }),
  getProfit: (params?: any) => api.get('/reports/profit', { params }),
  getTopProducts: (params?: any) => api.get('/reports/top-products', { params }),
};

export const categoriesApi = {
  getAll: (params?: any) => api.get('/categories', { params }),
  getById: (id: number) => api.get(`/categories/${id}`),
  create: (data: any) => api.post('/categories', data),
  update: (id: number, data: any) => api.put(`/categories/${id}`, data),
  delete: (id: number) => api.delete(`/categories/${id}`),
};

export const customersApi = {
  getAll: (params?: any) => api.get('/customers', { params }),
  getById: (id: number) => api.get(`/customers/${id}`),
  create: (data: any) => api.post('/customers', data),
  update: (id: number, data: any) => api.put(`/customers/${id}`, data),
  delete: (id: number) => api.delete(`/customers/${id}`),
};

export const suppliersApi = {
  getAll: (params?: any) => api.get('/suppliers', { params }),
  getById: (id: number) => api.get(`/suppliers/${id}`),
  create: (data: any) => api.post('/suppliers', data),
  update: (id: number, data: any) => api.put(`/suppliers/${id}`, data),
  delete: (id: number) => api.delete(`/suppliers/${id}`),
};

export const purchaseOrdersApi = {
  getAll: (params?: Record<string, string | number>) =>
    api.get<PurchaseOrder[]>('/purchase-orders', { params }),
  getById: (id: number) => api.get<PurchaseOrder>(`/purchase-orders/${id}`),
  create: (data: PurchaseOrderPayload) => api.post<PurchaseOrder>('/purchase-orders', data),
  update: (id: number, data: PurchaseOrderPayload) =>
    api.put<PurchaseOrder>(`/purchase-orders/${id}`, data),
  send: (id: number, idempotencyKey?: string) => {
    const key = idempotencyKey || generateIdempotencyKey();
    return api.post<PurchaseOrder>(`/purchase-orders/${id}/send`, {}, {
      headers: { 'Idempotency-Key': key },
    });
  },
  receive: (id: number, data: ReceivePurchaseOrderPayload, idempotencyKey?: string) => {
    const key = idempotencyKey || generateIdempotencyKey();
    return api.post<PurchaseOrder>(`/purchase-orders/${id}/receive`, data, {
      headers: { 'Idempotency-Key': key },
    });
  },
  cancel: (id: number, idempotencyKey?: string) => {
    const key = idempotencyKey || generateIdempotencyKey();
    return api.post<PurchaseOrder>(`/purchase-orders/${id}/cancel`, {}, {
      headers: { 'Idempotency-Key': key },
    });
  },
  delete: (id: number) => api.delete(`/purchase-orders/${id}`),
  previewVoid: (id: number) => api.get<VoidPreview>(`/purchase-orders/${id}/void-preview`),
  void: (id: number, reason: string, idempotencyKey?: string) => {
    const key = idempotencyKey || generateIdempotencyKey();
    return api.post<VoidResult>(`/purchase-orders/${id}/void`, { reason }, {
      headers: { 'Idempotency-Key': key },
    });
  },
};

export const metaApi = {
  getSaleReturnOptions: () => api.get('/meta/sale-return-options'),
};

export const generateIdempotencyKey = (): string =>
  typeof crypto !== 'undefined'
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

export default api;
