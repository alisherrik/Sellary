export type SaleContextType = 'retail' | 'restaurant';
export type ProductType = 'item' | 'dish';

export interface User {
  id: number;
  username: string;
  email: string;
  full_name?: string;
  role: 'admin' | 'manager' | 'cashier';
  is_active: boolean;
  created_at: string;
}

export interface Product {
  id: number;
  barcode?: string;
  name: string;
  description?: string;
  category_id?: number;
  category?: Category;
  product_type: ProductType;
  cost_price: string;
  sell_price: string;
  tax_percent: string;
  stock_quantity: number;
  min_stock_level: number;
  is_active: boolean;
  profit_percent?: string;
  created_at: string;
  updated_at?: string;
}

export interface Category {
  id: number;
  name: string;
  description?: string;
  is_active: boolean;
  created_at: string;
}

export interface Customer {
  id: number;
  name?: string;
  phone: string;
  email?: string;
  address?: string;
  is_active: boolean;
  created_at: string;
}

export interface SaleItem {
  id: number;
  product_id: number;
  product_name: string;
  quantity: number;
  unit_price: string;
  tax_percent: string;
  tax_amount: string;
  discount_amount: string;
  subtotal: string;
  total: string;
  transaction_type?: 'sale' | 'return';
  quantity_returned?: number;
  quantity_returnable?: number;
}

export interface Sale {
  id: number;
  customer_id?: number;
  customer_name?: string;
  cashier_id: number;
  cashier_name: string;
  subtotal: string;
  tax_amount: string;
  discount_amount: string;
  total_amount: string;
  payment_method: 'cash' | 'card' | 'mobile';
  card_type?: 'alif' | 'eskhata' | 'dc';
  status: 'completed' | 'cancelled' | 'refunded';
  notes?: string;
  context_type: SaleContextType;
  table_name?: string;
  created_at: string;
  items: SaleItem[];
}

export interface CartItem {
  product: Product;
  quantity: number;
  discount: number;
}

export interface DashboardWidgets {
  today_sales: string;
  today_profit: string;
  today_sales_count: number;
  low_stock_count: number;
  low_stock_items: LowStockItem[];
  top_products: TopProductItem[];
  recent_sales: RecentSale[];
}

export interface LowStockItem {
  product_id: number;
  product_name: string;
  barcode: string;
  current_stock: number;
  min_stock_level: number;
}

export interface TopProductItem {
  product_id: number;
  product_name: string;
  barcode: string;
  quantity_sold: number;
  revenue: string;
  profit: string;
}

export interface RecentSale {
  id: number;
  total_amount: string;
  payment_method: string;
  created_at: string;
}

export interface Supplier {
  id: number;
  name: string;
  contact_person?: string;
  email?: string;
  phone: string;
  address?: string;
  payment_terms?: string;
  is_active: boolean;
  created_at: string;
  updated_at?: string;
}

export type PurchaseOrderStatus = 'draft' | 'sent' | 'partially_received' | 'received' | 'cancelled';

export interface PurchaseOrderItem {
  id: number;
  product_id: number;
  quantity_ordered: number;
  quantity_received: number;
  unit_cost: string;
  subtotal: string;
  product?: {
    id: number;
    name: string;
    barcode: string;
  };
}

export interface PurchaseOrder {
  id: number;
  supplier_id: number;
  supplier?: {
    id: number;
    name: string;
  };
  order_date: string;
  expected_delivery_date?: string;
  status: PurchaseOrderStatus;
  total_amount: string;
  notes?: string;
  is_active: boolean;
  created_at: string;
  updated_at?: string;
  items: PurchaseOrderItem[];
}

// Report Types
export interface DailySalesData {
  date: string;
  total_sales: number;
  total_profit: number;
  sales_count: number;
}

export interface DailySalesReport {
  total_sales: number;
  total_profit: number;
  sales_count: number;
  data: DailySalesData[];
}

export interface ProfitReport {
  revenue: string;
  cost: string;
  profit: string;
  profit_margin_percent: string;
}

export interface TopProductItem {
  product_id: number;
  product_name: string;
  barcode: string;
  quantity_sold: number;
  total_revenue: number;
  total_profit: number;
}

export interface TopProductsReport {
  top_products: TopProductItem[];
}

