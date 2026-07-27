# Split payment on one sale — Design

Date: 2026-07-27
Status: approved (owner supplied the worked example; refund rule decided by us)
Scope: one sale settled with several tenders — cash, any card provider, mobile,
and debt, in any combination.

## The case

> Пришёл человек, купил товар на 50 сомони: 26 наличными, 10 DC, 10 Эсхата,
> 4 записал в долг. Всё это должно сохраниться.

Four tenders, one sale, summing exactly to the total. Today that is not
representable.

## What already works, and what does not

`sales` carries a single `payment_method` and, for cards, a single `card_type`.
On top of that there is one special case: a credit sale may carry a
`paid_amount` with an `initial_payment_method`, recorded as a `payment` row in
`customer_ledger_entries`.

So today:

| Combination | Works |
|---|---|
| Всё наличными / картой / переводом / в долг | yes |
| Половина наличными, половина в долг | yes — `paid_amount` |
| Половина DC, половина в долг | yes — `paid_amount` |
| **Половина DC, половина Эсхата** | **no** |
| **26 наличных + 10 DC + 10 Эсхата + 4 в долг** | **no** |

The gap is any sale with two or more non-debt tenders. The `paid_amount`
mechanism is a one-off that solved the common case and cannot generalise: there
is one slot.

## Model

A new child table, `sale_payments` — one row per tender. This is the standard
POS "tenders" shape, and it is the only option that survives contact with how
this codebase computes money.

```
sale_payments
  id
  company_id     -- tenant scope, mirrored from the sale for cheap grouping
  sale_id
  method         -- cash | card | mobile | credit
  card_type      -- alif | eskhata | dc; only when method = card
  amount         -- Numeric(12,2), > 0
  sort_order     -- the order the cashier entered them, for the receipt
  created_at
```

A JSON column on `sales` was rejected. Every money figure in this system is a
SQL aggregate — `MoneyRepository.balances`, `CashShiftService.compute_totals`,
`SaleService.get_summary`, the daily and profit reports all `GROUP BY` the
payment method. JSON would move all of that into Python, over every sale ever
made, to save one table.

### What happens to `sales.payment_method`

It stays, and it keeps a value: **the largest tender**, ties broken by a fixed
order (cash, card, mobile, credit). A new boolean `sales.is_split` says whether
there was more than one.

We are deliberately *not* adding a `mixed` value to the `paymentmethod`
Postgres enum, even though this repository has precedent for `ALTER TYPE … ADD
VALUE`. A new enum value would reach places this change does not touch: the
offline cashier's local schema and its sync validation, the history filters in
both clients, the MCP summary. Those would meet a value they cannot parse. The
dominant tender degrades gracefully instead — a reader that has not been
updated attributes the sale to its biggest tender rather than crashing.

After this change `payment_method` is **display and compatibility only**. Every
figure that is about money reads `sale_payments`. That rule matters more than
the column: a second channel for the same fact is how `stock_quantity` drifted
from its FIFO layers in production.

### Invariants

- `sum(sale_payments.amount) == sales.total_amount`, exactly, to the cent.
  Enforced on write and asserted by the backfill.
- Every amount is strictly positive. A zero tender is not a tender.
- At most one `credit` line per sale. Debt is one balance, not several.
- A `credit` line requires `customer_id` — there is nobody to owe otherwise.
- `card_type` is required for `card` and forbidden for everything else, matching
  the existing rule.
- Two lines with the same `(method, card_type)` are merged on write, and the
  merge is reported rather than done quietly.

## Write path

`SaleCreate` gains an optional `payments: list[SalePaymentCreate]`.

When it is absent, the request is interpreted exactly as today — scalar
`payment_method`, `card_type`, `paid_amount`, `initial_payment_method` — and the
service composes the tender rows itself. That keeps the offline cashier and the
sync endpoint working untouched, which matters because the cashier ships as an
installed desktop app and cannot be upgraded in lockstep.

When it is present, the scalar fields must not be, and the tenders are taken
literally.

The credit tender is what reaches `CustomerLedgerService.record_credit_sale`:
today that function books the *whole* `total_amount` as debt and then subtracts
the initial payment. With tenders it books the credit line's amount and nothing
else — the same number, arrived at without the subtraction.

`payment_status` follows from whether a credit tender exists, as it does now.

## Read path

Six places stop reading the scalar:

| Where | Change |
|---|---|
| `MoneyRepository.balances` | route each tender row to its account, not the whole sale total |
| `CashShiftService.compute_totals` | group tenders, not sales |
| `SaleService.get_summary` | cash/card/mobile/credit totals come from tenders |
| `ReportService` | same, for the dashboard and daily series |
| `SaleRepository` payment filter | `EXISTS (select 1 from sale_payments …)`, so filtering by "card" finds a sale that had a card leg |
| `SaleResponse` | gains `payments[]` and `is_split` |

The routing rule per tender is the one that already exists for whole sales:
cash → the till, a card → that provider's account or «Банк (прочее)», mobile →
«Банк (прочее)», credit → nowhere, because nothing moved.

For the worked example the shift then shows 26 in cash sales, 20 in card sales
split 10/10 between DC and Эсхата, and 4 in credit — from one sale.

## Returns

**The debt goes first.** Implemented — see below.

A return reduces the sale's outstanding credit before any money is handed back,
and only what is left is refunded. The cashier still chooses how to hand that
remainder over, which is what the return flow already asked for.

The reasoning: refunding cash while the customer still owes you for the same
sale is how a shop ends up chasing a debt it has already paid out on. It also
keeps the drawer untouched in the common case, so the shift still reconciles.

### What the two halves are worth

Before this, a return did two independent things — it wrote the debt down by up
to the refunded amount, and it recorded the *whole* refunded amount as money
leaving the till. Nothing compared them. On the worked example returned in
full, the shop paid out 50 in cash on a sale that had brought in 46 and was
owed 4, and cancelled the 4 as well.

It needed the cashier to pick a money refund method on a sale that owed money.
That was always possible — a pure в-долг sale had the same hole — but a split
sale invites it, because the screen says «Наличные» and gives no hint that part
of it is on the tab.

`sale_returns.credit_refund_amount` closes it. It records the part the debt
absorbed; `CashShiftService` and `MoneyRepository._sum_refunds` both read
`total_refund_amount - credit_refund_amount`, so a written-off debt never
leaves an account. `total_refund_amount` still means the value of the goods
returned, so turnover and `remaining_refundable_amount` are untouched.

A child table mirroring `sale_payments` was considered and rejected: the fault
was not "we cannot record several refund methods", it was "the debt half is
also paid out". One column says exactly that, and the cashier keeps the freedom
to hand money back however suits — refunding a card purchase in cash is a real
thing shops do.

Existing rows are backfilled to zero. They are accurate accounts of what
actually happened: if 50 in cash did leave the drawer, the balance being 50
lighter is correct, and rewriting history would move figures the owner has
already reconciled against.

## Migration

One revision, chaining off `e2f3a4b5c6d7` (the MCP OAuth tables).

1. Create `sale_payments`; add `sales.is_split` defaulting to false.
2. Backfill, per existing sale:
   - a plain sale → one row carrying `total_amount`, its method and card type;
   - a credit sale with an initial payment → **two** rows: the paid part with
     the method recorded on its ledger `payment` entry, and the remainder as
     `credit`. Both are already in the data; this only relocates them.
   - a credit sale with no initial payment → one `credit` row.
3. Assert the sum per sale matches `total_amount`, and fail loudly if it does
   not. A migration that silently loses a cent is worse than one that stops.

`is_split` is set true only for sales that came out of step 2 with two rows.

Downgrade drops the table and the column; the scalar columns were never
removed, so nothing is lost.

## Rollout

Backend and the web POS first; the Tauri cashier follows in its own change,
because its local SQLite schema, its outbox and its sync payload each need a
migration of their own and it ships as an installed binary.

Until then the cashier keeps sending scalar payments, which the compatibility
path above accepts unchanged.

## Testing

- The worked example end to end: 26 + 10 + 10 + 4 = 50 recorded, then shown
  correctly in the shift, the balances and the sales summary.
- Sum mismatch rejected — 26 + 10 + 10 + 3 must fail, not round.
- Two credit lines rejected; credit without a customer rejected; a card line
  without a card type rejected.
- Duplicate `(method, card_type)` merged, and the merge reported.
- The scalar path still produces identical results to today for every existing
  test — this is the regression that matters most.
- Backfill: a plain sale, a credit sale with an initial payment, and a credit
  sale without one each land on the right rows and sum to their total.
- A return against a split sale eats the debt first.
