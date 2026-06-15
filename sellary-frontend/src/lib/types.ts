export type ProductType = 'item';
export type GlobalUserRole = 'standard' | 'super_admin';
export type UserRole = 'admin' | 'manager' | 'cashier';
export type PurchaseOrderStatus =
  | 'draft'
  | 'sent'
  | 'partially_received'
  | 'received'
  | 'cancelled';
export type SaleStatus =
  | 'completed'
  | 'partially_returned'
  | 'returned'
  | 'cancelled';

export interface User {
  id: number;
  username: string;
  email: string;
  full_name?: string;
  global_role: GlobalUserRole;
  is_active: boolean;
  created_at: string;
}

export interface CompanySummary {
  id: number;
  name: string;
  slug: string;
  is_active: boolean;
  role: UserRole;
  is_default: boolean;
}

export interface LoginResponse {
  login_token: string;
  token_type: 'bearer';
  user: User;
  companies: CompanySummary[];
}

export interface CompanySession {
  access_token: string;
  token_type: 'bearer';
  user: User;
  current_company: CompanySummary;
  companies: CompanySummary[];
}

export interface AuthSession {
  user: User;
  current_company: CompanySummary;
  companies: CompanySummary[];
}

export interface OwnerLoginResponse {
  access_token: string;
  token_type: 'bearer';
  user: User;
}

export interface OwnerSession {
  user: User;
}

export interface ManagedCompany {
  id: number;
  name: string;
  slug: string;
  is_active: boolean;
  created_at: string;
  updated_at?: string | null;
}

export interface ManagedUserMembershipSummary {
  id: number;
  company_id: number;
  user_id: number;
  role: UserRole;
  is_default: boolean;
  is_active: boolean;
  created_at: string;
  company: ManagedCompany;
}

export interface ManagedUser {
  id: number;
  username: string;
  email: string;
  full_name?: string | null;
  global_role: GlobalUserRole;
  is_active: boolean;
  created_at: string;
  memberships: ManagedUserMembershipSummary[];
}

export interface ManagedMembership {
  id: number;
  user_id: number;
  company_id: number;
  role: UserRole;
  is_default: boolean;
  is_active: boolean;
  created_at: string;
  updated_at?: string | null;
  user: User;
  company: ManagedCompany;
}

export interface Category {
  id: number;
  name: string;
  description?: string;
  is_active: boolean;
  created_at: string;
}

export interface Product {
  id: number;
  barcode?: string | null;
  name: string;
  description?: string;
  category_id?: number;
  category?: Category;
  product_type: ProductType;
  uom: string;
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

export interface Customer {
  id: number;
  name?: string;
  phone?: string | null;
  email?: string;
  address?: string;
  is_active: boolean;
  created_at: string;
}

export interface SaleItem {
  id: number;
  product_id: number;
  product_name: string;
  uom: string;
  quantity: number;
  unit_price: string;
  tax_percent: string;
  tax_amount: string;
  discount_amount: string;
  subtotal: string;
  total: string;
  transaction_type?: 'sale' | 'return';
  quantity_returned: number;
  quantity_returnable: number;
  can_return: boolean;
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
  refunded_amount?: string;
  remaining_refundable_amount?: string;
  payment_method: 'cash' | 'card' | 'mobile';
  card_type?: 'alif' | 'eskhata' | 'dc';
  status: SaleStatus;
  can_return?: boolean;
  notes?: string;
  voided_at?: string;
  voided_by_user_id?: number;
  void_reason?: string;
  created_at: string;
  items: SaleItem[];
}

export interface SaleReturnItem {
  id: number;
  sale_item_id: number;
  product_name: string;
  quantity_returned: number;
  refund_amount: string;
}

export interface SaleReturn {
  id: number;
  sale_id: number;
  user_id: number;
  user_name: string;
  total_refund_amount: string;
  refund_method: 'cash' | 'card' | 'mobile';
  notes?: string;
  created_at: string;
  items: SaleReturnItem[];
}

export interface SaleReturnOptions {
  refund_methods: string[];
  returnable_statuses: string[];
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
  barcode?: string | null;
  current_stock: number;
  min_stock_level: number;
}

export interface TopProductItem {
  product_id: number;
  product_name: string;
  barcode?: string | null;
  quantity_sold: number;
  revenue?: string;
  profit?: string;
  total_revenue?: number;
  total_profit?: number;
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
    barcode?: string | null;
    uom?: string;
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
  voided_at?: string;
  voided_by_user_id?: number;
  void_reason?: string;
  items: PurchaseOrderItem[];
}

export interface InventoryImpact {
  product_id: number;
  product_name: string;
  quantity_change: number;
  value_change: number;
  resulting_stock: number;
}

export interface ReversalBlocker {
  blocker_type: 'sale' | 'inventory_adjustment' | 'legacy_history';
  reference_id?: number | null;
  product_id: number;
  product_name: string;
  quantity: number;
  created_at?: string | null;
  message: string;
}

export interface VoidPreview {
  can_void: boolean;
  is_legacy: boolean;
  impacts: InventoryImpact[];
  blockers: ReversalBlocker[];
}

export interface VoidResult {
  operation_id: number;
  entity_type: 'sale' | 'purchase_order';
  entity_id: number;
  status: string;
  voided_at: string;
}

export interface PurchaseOrderItemPayload {
  product_id: number;
  quantity_ordered: number;
  unit_cost: number;
}

export interface PurchaseOrderPayload {
  supplier_id: number;
  expected_delivery_date: string | null;
  notes: string | null;
  items: PurchaseOrderItemPayload[];
}

export interface ReceivePurchaseOrderPayload {
  items: Array<{ item_id: number; quantity_to_receive: number }>;
}

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

export interface TopProductsReport {
  top_products: TopProductItem[];
}
