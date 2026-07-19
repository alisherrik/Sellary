export interface ShopProduct {
  id: number;
  name: string;
  description: string | null;
  sell_price: number;
  image_url: string | null;
  uom: string;
  category_id: number | null;
  category_name: string | null;
  company_id: number;
  company_name: string;
  company_slug: string;
  in_stock: boolean;
}

export interface ShopSummary {
  company_id: number;
  slug: string;
  name: string;
  logo_url: string | null;
  marketplace_description: string | null;
  supports_delivery: boolean;
  supports_pickup: boolean;
}

export interface ShopCategory {
  id: number;
  name: string;
}

export interface CatalogPage {
  items: ShopProduct[];
  total: number;
  skip: number;
  limit: number;
}
