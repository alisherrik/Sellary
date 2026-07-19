import { describe, expect, it, vi, beforeEach } from 'vitest';

// Mock axios so we can assert the request shape without a real network call.
// Use vi.hoisted so the mock functions are available when the factory runs.
const { post, get, patch, put, del } = vi.hoisted(() => ({
  post: vi.fn(() => Promise.resolve({ data: {} })),
  get: vi.fn(() => Promise.resolve({ data: {} })),
  patch: vi.fn(() => Promise.resolve({ data: {} })),
  put: vi.fn(() => Promise.resolve({ data: {} })),
  del: vi.fn(() => Promise.resolve({ data: {} })),
}));

vi.mock('axios', () => {
  const instance = {
    post,
    get,
    patch,
    put,
    delete: del,
    interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } },
  };
  return { default: { create: () => instance } };
});

// Session helpers are imported at module load; stub them so import succeeds.
vi.mock('@/lib/session', () => ({
  getActiveAccessToken: () => 'token',
  clearStoredSession: vi.fn(),
}));
vi.mock('@/lib/owner-session', () => ({
  getOwnerAccessToken: () => null,
  clearOwnerSession: vi.fn(),
}));

import { companyApi, productsApi } from '@/lib/api';

beforeEach(() => vi.clearAllMocks());

describe('productsApi.uploadImage', () => {
  it('posts multipart form-data with the file field to the image endpoint', async () => {
    const file = new File([new Uint8Array([1, 2, 3])], 'photo.jpg', {
      type: 'image/jpeg',
    });

    await productsApi.uploadImage(7, file);

    expect(post).toHaveBeenCalledTimes(1);
    const [url, body, config] = post.mock.calls[0];
    expect(url).toBe('/products/7/image');
    expect(body).toBeInstanceOf(FormData);
    expect((body as FormData).get('file')).toBe(file);
    // No manual Content-Type: axios sets multipart/form-data + boundary itself.
    expect(config?.headers?.['Content-Type']).toBeUndefined();
  });
});

describe('companyApi marketplace settings', () => {
  it('reads settings from GET /company/marketplace', async () => {
    await companyApi.getMarketplace();
    expect(get).toHaveBeenCalledWith('/company/marketplace');
  });

  it('patches a subset to /company/marketplace', async () => {
    await companyApi.updateMarketplace({ supports_delivery: false });
    expect(patch).toHaveBeenCalledWith('/company/marketplace', {
      supports_delivery: false,
    });
  });
});
