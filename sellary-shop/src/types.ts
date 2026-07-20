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

// ---------------------------------------------------------------------------
// Orders (shopper-facing history)
// ---------------------------------------------------------------------------

export type OrderStatus =
  | 'pending'
  | 'confirmed'
  | 'preparing'
  | 'ready'
  | 'delivering'
  | 'completed'
  | 'cancelled';

export interface ShopOrderItem {
  id: number;
  product_id: number | null;
  product_name: string;
  unit_price: number;
  quantity: number;
  line_total: number;
}

export interface ShopOrder {
  id: number;
  company_id: number;
  order_number: number;
  status: OrderStatus;
  fulfillment_type: 'delivery' | 'pickup';
  delivery_address: string | null;
  contact_phone: string;
  contact_name: string;
  subtotal: number;
  total_amount: number;
  notes: string | null;
  sale_id: number | null;
  checkout_group_id: string | null;
  created_at: string;
  updated_at: string;
  items: ShopOrderItem[];
}

export interface OrderListPage {
  items: ShopOrder[];
  total: number;
  skip: number;
  limit: number;
}
