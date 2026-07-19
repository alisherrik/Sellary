import { describe, expect, it } from 'vitest';

import type {
  MarketplaceSettings,
  MarketplaceSettingsUpdate,
  Product,
} from '@/lib/types';

describe('marketplace types', () => {
  it('Product carries marketplace publish + image fields', () => {
    const product: Pick<Product, 'is_published' | 'image_url'> = {
      is_published: true,
      image_url: 'https://cdn.example/x.jpg',
    };
    expect(product.is_published).toBe(true);
    expect(product.image_url).toBe('https://cdn.example/x.jpg');
  });

  it('MarketplaceSettings holds the storefront shape', () => {
    const settings: MarketplaceSettings = {
      is_marketplace_enabled: false,
      logo_url: null,
      marketplace_description: null,
      supports_delivery: true,
      supports_pickup: true,
    };
    expect(settings.is_marketplace_enabled).toBe(false);
    expect(settings.supports_delivery).toBe(true);
  });

  it('MarketplaceSettingsUpdate allows partial edits', () => {
    const patch: MarketplaceSettingsUpdate = { supports_pickup: false };
    expect(patch.supports_pickup).toBe(false);
  });
});
