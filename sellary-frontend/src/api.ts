import axios from 'axios';

const API_URL = 'http://localhost:8000/api';

const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor to add auth token
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
    if (error.response?.status === 401) {
      localStorage.removeItem('token');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

// Helper to generate idempotency key using browser crypto API
export const generateIdempotencyKey = (): string => crypto.randomUUID();

// API Functions
export const authApi = {
  login: (username: string, password: string) =>
    api.post('/auth/login', { username, password }),
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
  create: (data: any, idempotencyKey: string) =>
    api.post('/sales', data, { headers: { 'Idempotency-Key': idempotencyKey } }),
  cancel: (id: number, idempotencyKey: string) =>
    api.post(`/sales/${id}/cancel`, {}, { headers: { 'Idempotency-Key': idempotencyKey } }),
  processReturn: (id: number, data: any, idempotencyKey: string) =>
    api.post(`/sales/${id}/return`, data, { headers: { 'Idempotency-Key': idempotencyKey } }),
  getReturns: (id: number) => api.get(`/sales/${id}/returns`),
};

export const inventoryApi = {
  adjust: (data: any, idempotencyKey: string) =>
    api.post('/inventory/adjust', data, { headers: { 'Idempotency-Key': idempotencyKey } }),
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
  send: (id: number, idempotencyKey: string) =>
    api.post(`/purchase-orders/${id}/send`, {}, { headers: { 'Idempotency-Key': idempotencyKey } }),
  receive: (id: number, data: any, idempotencyKey: string) =>
    api.post(`/purchase-orders/${id}/receive`, data, { headers: { 'Idempotency-Key': idempotencyKey } }),
  cancel: (id: number) => api.post(`/purchase-orders/${id}/cancel`),
  delete: (id: number) => api.delete(`/purchase-orders/${id}`),
};

export const metaApi = {
  getSaleReturnOptions: () => api.get('/meta/sale-return-options'),
};

export default api;
