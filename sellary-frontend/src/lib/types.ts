import type { ModuleKey, ModuleMap } from './modules';

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
  modules?: ModuleMap;
  company_modules?: ModuleKey[];
}

export interface AuthSession {
  user: User;
  current_company: CompanySummary;
  companies: CompanySummary[];
  modules?: ModuleMap;
  company_modules?: ModuleKey[];
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

// An additional sale unit on top of the product's base unit (uom + sell_price).
// `factor` = base units per 1 of this unit; `sell_price` = price per this unit.
export interface ProductUnit {
  id: number;
  name: string;
  factor: string;
  sell_price: string;
  barcode?: string | null;
  is_active: boolean;
  sort_order: number;
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
  is_published?: boolean;
  image_url?: string | null;
  profit_percent?: string;
  units?: ProductUnit[];
  created_at: string;
  updated_at?: string;
}

// Company storefront settings for the Telegram marketplace (F1). Read/updated
// through GET/PATCH /api/company/marketplace; server-side per company, not a
// device-local setting.
export interface MarketplaceSettings {
  is_marketplace_enabled: boolean;
  logo_url?: string | null;
  marketplace_description?: string | null;
  supports_delivery: boolean;
  supports_pickup: boolean;
}

// Partial patch for the storefront form — every field optional (PATCH semantics).
export interface MarketplaceSettingsUpdate {
  is_marketplace_enabled?: boolean;
  logo_url?: string | null;
  marketplace_description?: string | null;
  supports_delivery?: boolean;
  supports_pickup?: boolean;
}

// Platform-global marketplace secrets (F7). Owner-panel only. GET returns masked
// views only — plaintext is never sent to the browser.
export interface PlatformSettingView {
  is_set: boolean;
  masked: string;
  source: 'db' | 'env' | 'unset';
}

export interface PlatformSettingsResponse {
  telegram_bot_token: PlatformSettingView;
  telegram_webhook_secret: PlatformSettingView;
  cloudinary_url: PlatformSettingView;
}

// PUT payload — every field optional; blank/omitted preserves the stored value.
export interface PlatformSettingsUpdatePayload {
  telegram_bot_token?: string;
  telegram_webhook_secret?: string;
  cloudinary_url?: string;
}

export interface Customer {
  id: number;
  name?: string;
  phone?: string | null;
  email?: string;
  address?: string;
  description?: string | null;
  balance?: string;
  is_active: boolean;
  created_at: string;
}

export interface SaleItem {
  id: number;
  product_id: number;
  product_name: string;
  uom: string;
  quantity: number;
  product_unit_id?: number | null;
  sold_quantity?: number;
  sold_unit_label?: string | null;
  sold_unit_factor?: number;
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

/** One tender in a sale: 26 наличными, 10 картой DC, 4 в долг. */
export interface SalePayment {
  method: 'cash' | 'card' | 'mobile' | 'credit';
  card_type?: 'alif' | 'eskhata' | 'dc' | null;
  amount: string;
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
  // The LARGEST tender when the sale was split. `payments` below is what the
  // customer actually handed over; this field exists for display and for
  // anything written before split payments.
  payment_method: 'cash' | 'card' | 'mobile' | 'credit';
  card_type?: 'alif' | 'eskhata' | 'dc';
  is_split?: boolean;
  payments?: SalePayment[];
  payment_status?: 'paid' | 'unpaid' | 'partial' | 'settled';
  credit_amount?: string;
  credit_paid_amount?: string;
  credit_remaining_amount?: string;
  status: SaleStatus;
  can_return?: boolean;
  notes?: string;
  voided_at?: string;
  voided_by_user_id?: number;
  void_reason?: string;
  created_at: string;
  items: SaleItem[];
}

export interface SaleSearchSuggestion {
  kind: 'product' | 'cashier' | 'customer' | 'status' | 'payment';
  label: string;
  value: string;
  score: number;
}

export interface SalesHourlyBucket {
  hour: number; // local hour on the company's clock, not the server's
  turnover: string;
}

export interface ShiftTotals {
  cash_sales: string;
  card_sales: string;
  card_by_type: Record<string, string>; // { dc, eskhata, alif }
  mobile_sales: string;
  credit_sales: string;
  debt_payments_by_method: Record<string, string>;
  refunds_by_method: Record<string, string>;
  sales_count: number;
  /** Deliberate cash in and out of the drawer during the shift. */
  movements_in: string;
  movements_out: string;
  movements: ShiftMovement[];
  /**
   * Cash in the drawer this shift's own window cannot account for — usually an
   * offline sale that synced in after its shift had closed. Kept as its own
   * line so «Ожидается в кассе» can equal the Касса balance on the money page
   * without the arithmetic above it appearing to be wrong.
   */
  late_arrivals: string;
  expected_cash: string;
}

export interface ShiftMovement {
  id: number;
  direction: 'in' | 'out';
  amount: string;
  reason: string;
  reason_label: string;
  note: string | null;
  created_at: string;
}

// --- money accounts ---------------------------------------------------------

export interface MoneyAccount {
  id: number;
  name: string;
  is_till: boolean;
  card_type: string | null;
  balance: string;
  opening_balance: string;
  opening_at: string;
  is_active: boolean;
  sort_order: number;
}

export interface MoneyOverview {
  accounts: MoneyAccount[];
  total: string;
  cash_total: string;
  noncash_total: string;
}

export interface MoneyMovement {
  id: number;
  account_id: number;
  account_name: string;
  direction: 'in' | 'out';
  amount: string;
  reason: string;
  reason_label: string;
  transfer_group: string | null;
  note: string | null;
  created_by_user_id: number;
  created_by_name: string | null;
  created_at: string;
}

export interface MovementReason {
  value: string;
  label: string;
}

export interface MovementReasons {
  in: MovementReason[];
  out: MovementReason[];
}

// --- purchase reports -------------------------------------------------------

export interface PurchaseDayRow {
  day: string;
  spend: string;
  receipts: number;
}

export interface PurchaseSummary {
  total_spend: string;
  receipts_count: number;
  orders_count: number;
  suppliers_count: number;
  products_count: number;
  lines_count: number;
  average_receipt: string;
  by_day: PurchaseDayRow[];
}

export interface PurchaseByProductRow {
  product_id: number;
  name: string;
  uom: string | null;
  quantity: string;
  spend: string;
  share_percent: string;
  average_cost: string;
  min_cost: string;
  max_cost: string;
  first_cost: string | null;
  last_cost: string | null;
  cost_change_percent: string | null;
  current_cost_price: string;
  current_sell_price: string;
  deliveries: number;
  last_received_at: string | null;
}

export interface PurchaseBySupplierRow {
  supplier_id: number;
  name: string;
  spend: string;
  share_percent: string;
  receipts: number;
  products: number;
  last_received_at: string | null;
}

export interface OutstandingOrderRow {
  order_id: number;
  order_date: string | null;
  supplier_name: string;
  total_amount: string;
  pending_lines: number;
}

export interface CashShiftSnapshot {
  id: number;
  taken_at: string;
  taken_by_user_id: number;
  totals: ShiftTotals;
}

export interface CashShift {
  id: number;
  shift_number: number;
  status: 'open' | 'closed';
  opened_at: string;
  opened_by_user_id: number;
  opening_cash: string;
  closed_at: string | null;
  closed_by_user_id: number | null;
  counted_cash: string | null;
  expected_cash: string | null;
  discrepancy: string | null; // counted − expected; negative = недостача
  notes: string | null;
  totals: ShiftTotals; // live for open, frozen for closed
}

export interface CashShiftDetail extends CashShift {
  snapshots: CashShiftSnapshot[];
}

/**
 * Totals over every sale matching a filter — computed server-side because the
 * client only holds one page. Cancelled sales are excluded; `turnover` is gross
 * and `net_turnover` has refunds taken off, which is what the reports headline.
 */
export interface SalesSummary {
  turnover: string;
  refunds: string;
  net_turnover: string;
  count: number;
  average_check: string;
  refund_operations: number;
  hourly: SalesHourlyBucket[];
  // Turnover split by payment method. cash + card + mobile + credit === turnover.
  cash: string;
  card: string;
  mobile: string;
  credit: string;
  // Cash collected against в-долг sales in the window; the debt still owed is
  // `credit - cash_debt_payments`. NOT a drawer balance and never to be shown
  // as one — `cash + cash_debt_payments` is cash that PASSED THROUGH the till
  // over the window, which is a different quantity from what is in it now. How
  // much is in the drawer is answered by the till MoneyAccount alone (Деньги,
  // and the shift's «Ожидается в кассе», which reads the same figure).
  cash_debt_payments: string;
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

export type CustomerLedgerEntryType =
  | 'credit_sale'
  | 'payment'
  | 'return_adjustment'
  | 'cancel_adjustment';

export interface CustomerLedgerEntry {
  id: number;
  customer_id: number;
  sale_id?: number | null;
  entry_type: CustomerLedgerEntryType;
  amount: string;
  payment_method?: 'cash' | 'card' | 'mobile' | null;
  description?: string | null;
  created_by_user_id: number;
  created_at: string;
}

export interface CustomerLedgerResponse {
  customer_id: number;
  balance: string;
  entries: CustomerLedgerEntry[];
}

export interface CustomerPaymentPayload {
  amount: string | number;
  payment_method: 'cash' | 'card' | 'mobile';
  description?: string | null;
}

export interface CustomerPaymentResponse {
  customer_id: number;
  balance: string;
  entries: CustomerLedgerEntry[];
}

// The chosen sale unit for a cart line. `id: null` means the product's base unit.
// `factor` = base units per 1 of this unit; `price` = price per this unit.
export interface CartUnit {
  id: number | null;
  label: string;
  factor: number;
  price: number;
}

export interface CartItem {
  product: Product;
  unit: CartUnit;
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
  is_voided?: boolean;
  voided_at?: string | null;
  voided_by_user_id?: number | null;
  void_reason?: string | null;
  reversal_operation_id?: number | null;
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
  sale_item_id?: number | null;
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
  /** Why annulment is refused, when no dependent document is to blame. */
  block_reason?: string | null;
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
  total_sales: number; // net of refunds
  // Gross and refunds let this page reconcile with the sales history, which
  // headlines gross turnover.
  gross_turnover: string;
  refunds: string;
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

// --- Marketplace orders (F4/F5) ---

export type OrderStatus =
  | 'pending'
  | 'confirmed'
  | 'preparing'
  | 'ready'
  | 'delivering'
  | 'completed'
  | 'cancelled';

export type FulfillmentType = 'delivery' | 'pickup';

export interface OrderItem {
  id: number;
  product_id: number | null;
  product_name: string;
  unit_price: string;
  quantity: string;
  line_total: string;
}

export interface Order {
  id: number;
  company_id: number;
  order_number: number;
  status: OrderStatus;
  fulfillment_type: FulfillmentType;
  delivery_address: string | null;
  contact_phone: string;
  contact_name: string;
  subtotal: string;
  total_amount: string;
  notes: string | null;
  sale_id: number | null;
  checkout_group_id: string | null;
  created_at: string;
  updated_at: string;
  items: OrderItem[];
}

export interface OrderListResponse {
  items: Order[];
  total: number;
  skip: number;
  limit: number;
}

export interface OrderConfirmPayload {
  payment_method?: 'cash' | 'card' | 'mobile';
}

export interface OrderCancelPayload {
  reason?: string;
}

// Only the statuses the merchant can set via POST /api/orders/{id}/status.
export type OrderStatusAdvanceTarget = 'preparing' | 'ready' | 'delivering' | 'completed';

/** One row of the stock ledger: who moved it, by how much, and from what to what. */
export interface InventoryLog {
  id: number;
  product_id: number;
  product_name: string;
  user_id: number;
  user_name: string;
  quantity_change: string;
  value_change: string;
  previous_quantity: string;
  new_quantity: string;
  reason?: string | null;
  reference_type?: string | null;
  reference_id?: number | null;
  created_at: string;
}

// Taking goods off the shelf. Two independent axes: `reason_code` says why the
// goods are unsellable, `disposition` says where they went. A supplier return
// moves no money — it records that the goods left and who took them.
export type WriteOffDisposition = 'disposed' | 'returned_to_supplier';

export type WriteOffReason =
  | 'spoiled'
  | 'damaged'
  | 'defective'
  | 'expired'
  | 'lost'
  | 'shortage'
  | 'internal_use';

export interface WriteOffItem {
  id: number;
  product_id: number;
  product_name: string;
  product_unit_id: number | null;
  unit_name: string | null;
  unit_quantity: string;
  quantity: string;
  unit_cost: string;
  line_cost: string;
}

export interface WriteOff {
  id: number;
  disposition: WriteOffDisposition;
  reason_code: WriteOffReason;
  supplier_id: number | null;
  supplier_name: string | null;
  notes: string | null;
  total_cost: string;
  created_by_user_id: number;
  created_by_name: string | null;
  created_at: string;
  items: WriteOffItem[];
}

export interface WriteOffListResponse {
  items: WriteOff[];
  total: number;
}

export interface WriteOffSummaryBucket {
  key: string;
  total_cost: string;
  document_count: number;
}

export interface WriteOffSummary {
  period_start: string;
  period_end: string;
  total_cost: string;
  document_count: number;
  by_reason: WriteOffSummaryBucket[];
  by_disposition: WriteOffSummaryBucket[];
}
