# Client Credit Ledger Design

## Decision

Build credit sales as a real customer receivables ledger, not as a sale comment. Cash, card, and mobile sales may continue without a customer. Credit sales require a customer.

## Customer scope

Reuse the existing `customers` table and make it suitable for POS credit:

- `name` stores the customer full name and is required.
- `phone` is required for newly-created customers and unique inside a company.
- `description` is an optional free-form note.
- Existing `email` and `address` remain for future expansion, but the POS quick-create flow only asks for name, phone, and description.

Normal walk-in sales keep `customer_id = null`. We do not create a fake shared cash customer because it would pollute customer debt and history reports.

## Backend architecture

Add a `customer_ledger_entries` table:

- `company_id`
- `customer_id`
- `sale_id` nullable
- `entry_type`: `credit_sale`, `payment`, `return_adjustment`, `cancel_adjustment`
- `amount`: positive increases debt, negative decreases debt
- `payment_method`: nullable; set to `cash`, `card`, or `mobile` for debt payments
- `description`
- `created_by_user_id`
- `created_at`

Add `Sale.payment_status`:

- `paid` for normal cash/card/mobile sales
- `unpaid` for credit sales with no debt payments yet
- `partial` for credit sales with some debt payments
- `settled` once the sale's remaining credit debt is zero

Add `credit_sale` to the backend `PaymentMethod` enum. Credit is not a real money movement; it records a receivable. Later payments use real methods.

Use a dedicated `CustomerLedgerService` for all debt mutations:

- create a credit entry after a credit sale is created
- record a payment entry for a customer
- reduce debt when a credit sale is returned
- reduce debt when a credit sale is voided
- compute customer balance and sale credit status from ledger entries

## API

Extend existing endpoints:

- `POST /api/sales` accepts `payment_method: "credit"` and requires `customer_id`.
- Sale responses include `payment_status`, `credit_amount`, `credit_paid_amount`, and `credit_remaining_amount`.
- Customer responses include `balance`.

Add customer ledger endpoints:

- `GET /api/customers/{customer_id}/ledger` returns ledger history and balance.
- `POST /api/customers/{customer_id}/payments` records a debt payment with `amount`, `payment_method`, and optional `description`.

Debt payments require an idempotency key because they mutate money-related state.

## POS flow

The payment modal keeps four choices: cash, card, mobile, credit.

When credit is selected:

- show a customer selector/search area
- allow quick customer creation with name, phone, description
- block completion until a customer is selected
- send `payment_method: "credit"` and `customer_id`
- do not send a fake note

After success, refresh products, sales, customers, and dashboard queries.

## Customer UI

Add a `Клиенты` page to the protected app:

- customer list with name, phone, description, balance
- create/edit simple customer details
- customer detail panel with ledger history
- `Принять оплату долга` action when balance is positive

The first version keeps payment allocation at the customer balance level. It does not assign each payment to individual old sales. This keeps the MVP clean while leaving room for a future allocation table.

## Sales UI

Sales history displays credit sales as `В долг` with debt status:

- `Не оплачено`
- `Частично`
- `Оплачено`

Sale detail shows customer, credit amount, paid amount, and remaining amount. If the sale is a credit sale with remaining debt, it offers `Принять оплату долга`, which posts a customer payment.

## Return and void behavior

When a credit sale is returned, create a negative `return_adjustment` ledger entry for the refund amount. This decreases the customer's debt instead of treating it like a cash refund.

When a credit sale is voided, create a negative `cancel_adjustment` entry for the remaining outstanding credit amount for that sale.

All ledger entries remain immutable audit history. We do not delete old credit comments or old debt events.

## Deployment

Alembic files are not part of normal commits in this project, and Railway is pinned to an older migration revision. To make deployment safe, add a small idempotent startup schema ensure for the new customer credit columns/tables. It must only create missing credit-ledger schema pieces and must be safe to run repeatedly.

## Testing

Backend tests cover:

- credit sales require a customer
- credit sales create a positive ledger entry
- customer payments create negative ledger entries
- customer balance is computed correctly
- returns and voids reduce credit debt
- normal cash/card/mobile sales still work without customers

Frontend tests cover:

- POS credit completion requires selecting/creating a customer
- POS credit sale sends `payment_method: "credit"` and `customer_id`
- customer page can list balances and post a payment
- sales page labels credit sales and shows debt status
