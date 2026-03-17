'use client';

import axios from 'axios';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api';

// Log the API URL for debugging
if (typeof window !== 'undefined') {
  console.log('API URL:', API_URL);
}

const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor to add auth token
if (typeof window !== 'undefined') {
  api.interceptors.request.use(
    (config) => {
      const token = localStorage.getItem('token');
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
      return config;
    },
    (error) => Promise.reject(error)
  );

  // Response interceptor to handle errors
  api.interceptors.response.use(
    (response) => response,
    (error) => {
      // Log the full error object for debugging
      console.error('Full API Error Object:', error);

      console.error('API Error Details:', {
        message: error.message,
        code: error.code,
        url: error.config?.url,
        baseURL: error.config?.baseURL,
        status: error.response?.status,
        data: error.response?.data || 'No response data',
      });

      if (error.response?.status === 401 && typeof window !== 'undefined') {
        localStorage.removeItem('token');
        window.location.href = '/login';
      }
      return Promise.reject(error);
    }
  );
}

// API Functions
export const authApi = {
  login: (username: string, password: string) =>
    api.post(`/auth/login?_t=${Date.now()}`, { username, password }),
  logout: () => api.post('/auth/logout'),
  me: () => api.get('/auth/me'),
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
  getAll: (params?: any) => api.get('/purchase-orders', { params }),
  getById: (id: number) => api.get(`/purchase-orders/${id}`),
  create: (data: any) => api.post('/purchase-orders', data),
  update: (id: number, data: any) => api.put(`/purchase-orders/${id}`, data),
  send: (id: number) => api.post(`/purchase-orders/${id}/send`),
  receive: (id: number, data: any, idempotencyKey?: string) => {
    const key = idempotencyKey || generateIdempotencyKey();
    return api.post(`/purchase-orders/${id}/receive`, data, { headers: { 'Idempotency-Key': key } });
  },
  cancel: (id: number) => api.post(`/purchase-orders/${id}/cancel`),
  delete: (id: number) => api.delete(`/purchase-orders/${id}`),
};

export const metaApi = {
  getSaleReturnOptions: () => api.get('/meta/sale-return-options'),
};

// Helper to generate idempotency key
export const generateIdempotencyKey = (): string =>
  typeof crypto !== 'undefined' ? crypto.randomUUID() : Math.random().toString(36).slice(2);

export default api;

