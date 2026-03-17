# Sellary Backend

FastAPI backend for the Sellary platform.

## Setup

1. Install dependencies:
```bash
pip install -r requirements.txt
```

2. Set up PostgreSQL database:
```sql
CREATE DATABASE sellary_db;
```

3. Configure environment:
```bash
cp .env.example .env
# Edit .env with your database credentials
```

4. Run database migrations:
```bash
alembic upgrade head
```

5. Create admin user:
```bash
python seed_admin.py
```

6. Run the server:
```bash
uvicorn main:app --reload
```

The API will be available at `http://localhost:8000`
API documentation at `http://localhost:8000/docs`

## Default Admin Credentials

- Username: `admin`
- Password: `admin123`

## API Endpoints

### Authentication
- POST `/api/auth/login` - Login
- GET `/api/auth/me` - Get current user
- POST `/api/auth/logout` - Logout

### Products
- GET `/api/products` - List products
- POST `/api/products` - Create product
- GET `/api/products/{id}` - Get product
- PUT `/api/products/{id}` - Update product
- DELETE `/api/products/{id}` - Delete product
- GET `/api/products/barcode/{barcode}` - Find by barcode
- GET `/api/products/search?q=` - Search products

### Sales
- POST `/api/sales` - Create sale
- GET `/api/sales` - List sales
- GET `/api/sales/{id}` - Get sale details
- POST `/api/sales/{id}/cancel` - Cancel sale

### Inventory
- POST `/api/inventory/adjust` - Adjust stock
- GET `/api/inventory/logs` - View inventory logs
- GET `/api/inventory/valuation` - Get inventory value

### Reports
- GET `/api/reports/dashboard` - Dashboard widgets
- GET `/api/reports/daily-sales` - Daily sales report
- GET `/api/reports/profit` - Profit report
- GET `/api/reports/top-products` - Top selling products

### Categories
- GET `/api/categories` - List categories
- POST `/api/categories` - Create category
- PUT `/api/categories/{id}` - Update category
- DELETE `/api/categories/{id}` - Delete category

### Customers
- GET `/api/customers` - List customers
- POST `/api/customers` - Create customer
- PUT `/api/customers/{id}` - Update customer
- DELETE `/api/customers/{id}` - Delete customer
