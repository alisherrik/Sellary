# Sellary - Complete Documentation

A modern Point of Sale (POS) system for retail businesses with inventory management, supplier management, purchase orders, and comprehensive reporting.

---

## Table of Contents

1. [System Overview](#system-overview)
2. [Technology Stack](#technology-stack)
3. [Features Overview](#features-overview)
4. [User Interface Pages](#user-interface-pages)
5. [Business Logic](#business-logic)
6. [Database Schema](#database-schema)
7. [API Endpoints](#api-endpoints)
8. [Limitations & What's NOT Included](#limitations--whats-not-included)
9. [Setup & Installation](#setup--installation)

---

## System Overview

This is the full-stack Sellary application designed for small to medium retail businesses. It provides:

- **Point of Sale (POS)** - Fast sales processing with barcode support
- **Inventory Management** - Stock tracking with low stock alerts
- **Supplier Management** - Vendor information and purchase orders
- **Reporting & Analytics** - Sales, profit, and product performance reports
- **Multi-user Support** - Role-based access control

---

## Technology Stack

### Backend
| Component | Technology |
|-----------|------------|
| Language | Python 3.14 |
| Framework | FastAPI |
| Database | PostgreSQL |
| ORM | SQLAlchemy |
| Migrations | Alembic |
| Authentication | JWT (JSON Web Tokens) |

### Frontend
| Component | Technology |
|-----------|------------|
| Framework | Next.js 14 (React) |
| Language | TypeScript |
| Styling | Tailwind CSS |
| State Management | Zustand |
| HTTP Client | Axios |
| Charts | Recharts |
| Notifications | React Hot Toast |
| Icons | Heroicons |

---

## Features Overview

### ✅ What This App CAN Do

| Feature | Description | Status |
|---------|-------------|--------|
| **User Authentication** | Login/logout with JWT tokens | ✅ Implemented |
| **Role-based Access** | Admin, Manager, Cashier roles | ✅ Implemented |
| **Product Management** | Create, edit, delete products | ✅ Implemented |
| **Category Management** | Organize products by categories | ✅ Implemented |
| **Barcode Support** | Search products by barcode | ✅ Implemented |
| **Point of Sale** | Process sales with cart | ✅ Implemented |
| **Multiple Payment Types** | Cash, Card (Alif/Eskhata/DC), Mobile | ✅ Implemented |
| **Multi-tab Checkout** | Multiple sale sessions simultaneously | ✅ Implemented |
| **Inventory Tracking** | Automatic stock deduction on sale | ✅ Implemented |
| **Low Stock Alerts** | Dashboard warnings for low stock | ✅ Implemented |
| **Supplier Management** | Add/edit supplier information | ✅ Implemented |
| **Purchase Orders** | Create and track inventory purchases | ✅ Implemented |
| **Partial Receiving** | Receive purchase orders in parts | ✅ Implemented |
| **Sales Reports** | Daily/weekly/monthly sales data | ✅ Implemented |
| **Profit Reports** | Revenue, cost, and margin analysis | ✅ Implemented |
| **Top Products Report** | Best-selling products ranking | ✅ Implemented |
| **Sale Cancellation** | Cancel completed sales with stock reversal | ✅ Implemented |
| **Inventory Logs** | Track all stock changes | ✅ Implemented |
| **Dark Mode** | UI supports dark/light themes | ✅ Implemented |
| **Hotkey Support** | Keyboard shortcuts (F2, Enter) | ✅ Implemented |

---

## User Interface Pages

### 1. Login Page (`/login`)

**Purpose:** User authentication

**Features:**
- Username and password input fields
- Error messages for invalid credentials
- Redirects to Dashboard on success

**Business Logic:**
- Validates credentials against database
- Issues JWT token with 7-day expiration
- Stores token in localStorage

---

### 2. Dashboard (`/dashboard`)

**Purpose:** Quick overview of business performance

**Widgets Displayed:**
| Widget | Description |
|--------|-------------|
| Today's Sales | Total revenue for current day |
| Today's Profit | Profit (revenue - cost) for current day |
| Transactions | Number of sales today |
| Low Stock Items | Count of products below minimum stock |
| Top Selling Products | Top 5 products by quantity sold today |
| Low Stock Alerts | List of products needing restock |
| Recent Sales | Last 10 completed transactions |

---

### 3. POS Page (`/pos`)

**Purpose:** Process sales transactions

**UI Components:**
- **Session Tabs** - Multiple cart sessions (tabs) for parallel checkouts
- **Product Search Drawer** - Search by name or barcode (F2 to open)
- **Cart Display** - Items with quantity controls (+/-)
- **Order Summary** - Subtotal, tax, and total
- **Payment Modal** - Select payment method and complete sale

**Payment Methods:**
| Method | Card Types |
|--------|------------|
| Cash | — |
| Card | Alif Bank, Eskhata Bank, DC (Dushanbe City) |
| Mobile | — |

**Keyboard Shortcuts:**
| Key | Action |
|-----|--------|
| `F2` | Open product search drawer |
| `Enter` | Complete sale (when modal is open) |

**Business Logic:**
1. Add products to cart (validates stock availability)
2. Adjust quantities (max = available stock)
3. Select payment method
4. If Card → Select card type (Alif/Eskhata/DC)
5. On "Complete Payment":
   - Creates sale record
   - Creates sale items
   - Deducts stock from products
   - Creates inventory log entries
   - Returns success/error

---

### 4. Products Page (`/products`)

**Purpose:** Manage product catalog

**Features:**
- Search products by name/barcode
- Filter by category
- Add new products
- Edit existing products
- Delete products (soft delete)

**Product Fields:**
| Field | Required | Description |
|-------|----------|-------------|
| Barcode | Yes | Unique product identifier |
| Name | Yes | Product display name |
| Description | No | Product details |
| Category | No | Product category |
| Cost Price | Yes | Purchase/cost price |
| Sell Price | Yes | Selling price |
| Tax % | No | Tax percentage (default: 0) |
| Stock Quantity | Yes | Current quantity in stock |
| Min Stock Level | No | Threshold for low stock alerts |

---

### 5. Suppliers Page (`/suppliers`)

**Purpose:** Manage vendor/supplier information

**Features:**
- Search suppliers
- Add new suppliers
- Edit supplier details
- Delete suppliers

**Supplier Fields:**
| Field | Required | Description |
|-------|----------|-------------|
| Name | Yes | Supplier company name |
| Contact Person | No | Primary contact name |
| Email | No | Contact email |
| Phone | Yes | Contact phone number |
| Address | No | Business address |
| Payment Terms | No | e.g., "Net 30", "COD" |

---

### 6. Purchase Orders Page (`/purchase-orders`)

**Purpose:** Manage inventory purchases from suppliers

**Features:**
- Create purchase orders
- Add multiple items to PO
- Track PO status
- Receive items (full or partial)
- Cancel POs

**PO Status Workflow:**
```
DRAFT → SENT → PARTIALLY_RECEIVED → RECEIVED
         ↓
      CANCELLED
```

**Actions by Status:**
| Status | Edit | Send | Receive | Cancel | Delete |
|--------|------|------|---------|--------|--------|
| Draft | ✅ | ✅ | ❌ | ✅ | ✅ |
| Sent | ❌ | ❌ | ✅ | ✅ | ❌ |
| Partially Received | ❌ | ❌ | ✅ | ✅ | ❌ |
| Received | ❌ | ❌ | ❌ | ❌ | ❌ |
| Cancelled | ❌ | ❌ | ❌ | ❌ | ❌ |

**Receive Items Flow:**
1. Open "Receive Items" modal
2. Enter quantity received for each item
3. On submit:
   - Updates PO item quantities
   - Increases product stock
   - Creates inventory log entries
   - Updates PO status (partial/complete)

---

### 7. Reports Page (`/reports`)

**Purpose:** Business analytics and reports

**Report Tabs:**

#### Sales Report
- Total revenue for period
- Total profit for period
- Transaction count
- Line chart showing daily sales trend

#### Profit Report
- Revenue (total sales)
- Cost (total product costs)
- Profit (revenue - cost)
- Margin percentage
- Bar chart comparison

#### Top Products Report
- Ranked list of best sellers
- Quantity sold
- Profit generated
- Bar chart visualization

**Time Period Options:**
- Last 7 days
- Last 30 days
- Last 90 days
- Last year

---

## Business Logic

### Sales Processing

```
1. Cashier adds products to cart
2. System validates stock availability
3. Cashier selects payment method
   - If Card → Selects card type (Alif/Eskhata/DC)
4. System calculates:
   - Subtotal = Σ(quantity × unit_price)
   - Tax = Σ(subtotal × tax_percent / 100)
   - Total = Subtotal + Tax - Discount
5. Sale is created with status = COMPLETED
6. Stock is deducted from each product
7. Inventory logs are created
```

### Sale Cancellation

```
1. Admin/Manager selects sale to cancel
2. System reverses stock deduction
3. Inventory logs created (positive quantity)
4. Sale status = CANCELLED
```

### Purchase Order Receiving

```
1. User enters quantity received for each item
2. For each item:
   - Product stock += quantity_received
   - PO item.quantity_received += quantity
   - Inventory log created
3. If all items fully received → status = RECEIVED
   Else → status = PARTIALLY_RECEIVED
```

### Profit Calculation

```
Revenue = Sum of all sale totals
Cost = Sum of (sold_quantity × product.cost_price)
Profit = Revenue - Cost
Margin = (Profit / Revenue) × 100
```

---

## Database Schema

### Tables

| Table | Description |
|-------|-------------|
| `users` | System users (cashiers, managers, admins) |
| `products` | Product catalog |
| `categories` | Product categories |
| `customers` | Customer information (optional) |
| `suppliers` | Vendor information |
| `sales` | Sale transactions |
| `sale_items` | Items in each sale |
| `purchase_orders` | Inventory purchase orders |
| `purchase_order_items` | Items in each PO |
| `inventory_logs` | Stock change history |
| `membership_module_access` | Per-membership module grants (`pos`/`inventory`/`purchasing`/`shop`/`reports` × `user`/`manager`); no row = no access, admin role bypasses |

### Key Relationships

```
products ──┬── category (many-to-one)
           ├── sale_items (one-to-many)
           └── purchase_order_items (one-to-many)

sales ──┬── cashier/user (many-to-one)
        ├── customer (many-to-one, optional)
        └── sale_items (one-to-many)

purchase_orders ──┬── supplier (many-to-one)
                  └── purchase_order_items (one-to-many)
```

### Sale Statuses
- `completed` - Normal completed sale
- `cancelled` - Cancelled sale (stock reversed)
- `refunded` - Refunded sale

### Payment Methods
- `cash` - Cash payment
- `card` - Card payment (with card_type: alif/eskhata/dc)
- `mobile` - Mobile payment

---

## API Endpoints

### Authentication

Multi-company auth flow:
1. Login returns a `login_token` (short-lived).
2. User picks a company, exchanges for a company-scoped `access_token`.
3. All business endpoints require a company-scoped access token.

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/login` | User login |
| POST | `/api/auth/select-company` | Select company, get access token (response includes `modules` grant map) |
| POST | `/api/auth/logout` | User logout |
| GET | `/api/auth/me` | Get current user (response includes `modules` grant map) |
| GET | `/api/admin/memberships/{id}/modules` | Admin: read a member's module grants |
| PUT | `/api/admin/memberships/{id}/modules` | Admin: replace a member's module grants |

Module access: business endpoints are gated per module (`pos`: sales/shifts/customers; `inventory`: products/categories/inventory; `purchasing`: suppliers/POs; `shop`: merchant orders; `reports`) at level `user` (daily flow) or `manager` (destructive/corrective ops: cancels, returns, voids, deletes, inventory adjust, PO receive). Admin role bypasses. Missing grant → HTTP 403 `{"detail": {"code": "module_access_denied", ...}}`.

### Products
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/products` | List all products |
| GET | `/api/products/{id}` | Get product by ID |
| GET | `/api/products/barcode/{barcode}` | Get product by barcode |
| GET | `/api/products/search?q={query}` | Search products |
| GET | `/api/products/low-stock` | Get low stock products |
| POST | `/api/products` | Create product |
| PUT | `/api/products/{id}` | Update product |
| DELETE | `/api/products/{id}` | Delete product |

### Categories
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/categories` | List all categories |
| POST | `/api/categories` | Create category |
| PUT | `/api/categories/{id}` | Update category |
| DELETE | `/api/categories/{id}` | Delete category |

### Sales
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/sales` | List sales |
| GET | `/api/sales/{id}` | Get sale details |
| POST | `/api/sales` | Create sale |
| POST | `/api/sales/{id}/cancel` | Cancel sale |

### Suppliers
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/suppliers` | List suppliers |
| POST | `/api/suppliers` | Create supplier |
| PUT | `/api/suppliers/{id}` | Update supplier |
| DELETE | `/api/suppliers/{id}` | Delete supplier |

### Purchase Orders
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/purchase-orders` | List POs |
| GET | `/api/purchase-orders/{id}` | Get PO details |
| POST | `/api/purchase-orders` | Create PO |
| PUT | `/api/purchase-orders/{id}` | Update PO |
| POST | `/api/purchase-orders/{id}/send` | Mark PO as sent |
| POST | `/api/purchase-orders/{id}/receive` | Receive PO items |
| POST | `/api/purchase-orders/{id}/cancel` | Cancel PO |
| DELETE | `/api/purchase-orders/{id}` | Delete draft PO |

### Reports
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/reports/dashboard` | Dashboard widgets |
| GET | `/api/reports/daily-sales` | Daily sales data |
| GET | `/api/reports/profit` | Profit report |
| GET | `/api/reports/top-products` | Top selling products |

### Inventory
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/inventory/adjust` | Manual stock adjustment |
| GET | `/api/inventory/logs` | Stock change history |
| GET | `/api/inventory/valuation` | Current inventory value |

### Sync (Tauri Cashier)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/sync/bootstrap` | Download products/categories for offline catalog |
| POST | `/api/sync/sales` | Push offline sales to server |
| GET | `/api/sync/status` | Check sync status of pending sales |

Requires company-scoped `access_token`.

---

## Limitations & What's NOT Included

> [!CAUTION]
> The following features are **NOT implemented** in this version:

| Feature | Status | Notes |
|---------|--------|-------|
| Multi-store support | ❌ | Single store only |
| Barcode printing | ❌ | No label printing |
| Receipt printing | ❌ | No physical receipt generation |
| Customer loyalty/points | ❌ | No rewards system |
| Discount codes/coupons | ❌ | No promotional codes |
| Return/refund processing | ❌ | Can only cancel sales |
| Expense tracking | ❌ | No expense management |
| Employee scheduling | ❌ | No shift management |
| Restaurant module | ❌ | Removed from codebase — out of scope |
| PWA / offline web sync | ❌ | Removed — replaced by Tauri cashier |
| Offline mode | ✅ | Via Tauri desktop cashier app |
| Mobile app | ❌ | Desktop app via Tauri |
| Multi-currency | ❌ | Single currency only |
| Tax configuration | ❌ | Per-product tax only |
| Email notifications | ❌ | No email alerts |
| Data export (Excel/PDF) | ❌ | No export functionality |
| Audit logs | ❌ | No user action tracking |
| Customer management | ⚠️ | Basic - no purchase history view |
| Price history | ❌ | No historical price tracking |
| Product variants | ❌ | No size/color variations |
| Bundle/kit products | ❌ | No product packaging |

---

## Setup & Installation

### Prerequisites
- Python 3.10+
- Node.js 18+
- PostgreSQL 14+

### Backend Setup
```bash
cd sellary-backend

# Create virtual environment
python -m venv .venv
.venv\Scripts\activate  # Windows
source .venv/bin/activate  # Linux/Mac

# Install dependencies
pip install -r requirements.txt

# Configure environment
cp .env.example .env
# Edit .env with your database credentials

# Run migrations
python -m alembic upgrade head

# Bootstrap company and admin user
python bootstrap_company.py --company-name "Sellary Demo" --company-slug "sellary-demo" --owner-username "admin" --owner-email "admin@example.com" --owner-password "admin123" --owner-role "admin"

# Start server
python main.py
```

### Frontend Setup
```bash
cd sellary-frontend

# Install dependencies
npm install

# Start development server
npm run dev
```

### Quick Start (Both)
```powershell
# From project root
.\restart_app.ps1
```

### Default Admin Credentials
- Username: `admin`
- Password: `admin123`

---

## Support

For issues or questions, please review the codebase or create an issue in the repository.
