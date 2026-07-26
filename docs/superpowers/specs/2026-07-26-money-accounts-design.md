# Money accounts and movements — design

**Date:** 2026-07-26
**Status:** approved, implementing

## The problem

Money enters and leaves the shop in ways the program cannot record. Today the
only things that touch the till are sales, refunds and debt repayments. There
is no way to say:

- the owner withdrew card takings from the bank and put them in the drawer
- cash was taken to the bank
- a supplier was paid in cash
- change was brought in at the start of the day

Recording none of it, the shift reports a недостача or an излишек for money
that moved perfectly legitimately. That is one half of why this shop's till
never reconciled. The other half — card takings being added to the drawer count
— was fixed on 2026-07-26 in `CloseShiftForm`.

There is also no answer to "how much is on the card right now". Card sales are
recorded, but nothing tracks the balance they accumulate or the withdrawals
against it.

## What this is not

Not double-entry bookkeeping. No chart of accounts, no journals, no periods, no
trial balance. A shop owner needs to know where the money is and to write down
when it moves. That is the whole scope.

## Model

### Accounts

Money sits in accounts. Exactly one is the till drawer; the rest are bank or
card accounts.

```
money_accounts
  id
  company_id           FK companies, indexed
  name                 String(60)      "Касса", "Банк · DC", "Сейф"
  is_till              bool            exactly one true per company
  card_type            String(20)|NULL routes card sales of this type here
  opening_balance      Numeric(14,2)   what the account held at opening_at
  opening_at           timestamptz     movements before this are not counted
  is_active            bool
  sort_order           int
  created_at
```

Constraints:

- partial unique `(company_id) WHERE is_till` — one drawer per company
- partial unique `(company_id, card_type) WHERE card_type IS NOT NULL`
- partial unique `(company_id) WHERE NOT is_till AND card_type IS NULL` — one
  «Банк (прочее)», the destination for non-cash money that cannot be attributed
  to a card type (see *Routing* below)

### Movements

```
money_movements
  id
  company_id           FK companies, indexed
  account_id           FK money_accounts, indexed
  direction            'in' | 'out'
  amount               Numeric(14,2)  CHECK > 0
  reason               String(32)
  transfer_group       String(36)|NULL  pairs the two legs of a transfer
  note                 String(500)|NULL
  created_by_user_id   FK users
  created_at           timestamptz, indexed
```

Reasons — a closed list, because a free-text reason cannot be reported on:

| direction | reason | meaning |
|---|---|---|
| in | `transfer_in` | the receiving leg of a transfer |
| in | `owner_deposit` | the owner put money in |
| in | `change_float` | change brought for the drawer |
| in | `adjustment_in` | correcting the recorded balance upward |
| in | `other_income` | anything else coming in |
| out | `transfer_out` | the sending leg of a transfer |
| out | `bank_deposit` | cash taken to the bank |
| out | `supplier_payment` | a supplier paid from this account |
| out | `expense` | shop expenses |
| out | `salary` | wages paid |
| out | `owner_withdrawal` | the owner took money |
| out | `adjustment_out` | correcting the recorded balance downward |
| out | `other_expense` | anything else going out |

A **transfer** is two rows sharing a `transfer_group`: `transfer_out` on the
source, `transfer_in` on the destination, same amount. Withdrawing card takings
as cash is a transfer from «Банк · DC» to «Касса» — the case that prompted all
of this.

A movement is immutable. A mistake is corrected by an opposing movement, not by
an edit, so the history stays truthful.

### Balances are derived, never cached

```
balance(account) =
    opening_balance
  + Σ movements(in) − Σ movements(out)                        [created_at >= opening_at]
  + if is_till:      Σ cash sales + Σ cash debt payments − Σ cash refunds
  + if card_type:    Σ card sales with that card_type
  + if «прочее»:     Σ card debt payments − Σ card refunds
```

A cached balance column would drift the moment any path forgot to update it.
The production database already shows what that costs: four products whose
`stock_quantity` disagrees with their FIFO layers because a manual edit, a
delete and a purchase void each moved one and not the other. Money gets no
cached mirror.

### Routing

`sale_returns.refund_method` and `customer_ledger_entries.payment_method` record
*how* but not *which card*. Non-cash amounts from those two sources therefore
land on the «Банк (прочее)» account, which is created only when such a movement
first exists. In the current production data there are none: every refund and
every debt repayment so far has been cash.

## Effect on the shift

`CashShiftService.compute_totals` gains a fourth source: movements on the till
account inside the window.

```
expected_cash = opening_cash
              + cash sales
              + cash debt repayments
              − cash refunds
              + till movements in
              − till movements out
```

`ShiftTotals` gains `movements_in`, `movements_out` and a `movements` list of
`(reason, direction, amount)` so the shift page can show each one. A closed
shift freezes them with everything else, and a movement cannot be recorded into
a closed shift — the same rule that already blocks annulling a receipt there.

## Effect on reports — none

`/api/sales/summary`, the dashboard and every product report read `sales` and
`sale_items`. They do not read `money_movements` and must not. Moving money
between accounts is not revenue, and taking cash to the bank is not an expense
against turnover. A regression test asserts that recording movements leaves the
sales summary unchanged.

## Access

A new module, `finance`, added to the canonical registry:

- `finance:user` — see account balances and the movement history
- `finance:manager` — record movements and transfers, edit accounts

Till in/out from the shift page is `register:manager`: the cashier who closes
the drawer is the one who writes down that they took 150 out for a delivery.

`finance` is added to every business-type preset and enabled for existing
companies by the migration, so nobody loses a screen they had.

## Migration

`d1e2f3a4b5c6`, chained on `c0d1e2f3a4b5` (the current production pin).

1. create `money_accounts`, `money_movements` and their indexes
2. per company: one «Касса» with `is_till`, `opening_balance` and `opening_at`
   taken from that company's earliest shift (`opening_cash`, `opened_at`), or
   `0` at the company's `created_at` when it has no shifts
3. per distinct `sales.card_type` per company: a «Банк · <type>» account with a
   zero opening balance at the company's `created_at`, so every card sale ever
   recorded counts toward it
4. insert `finance` into `company_modules` for every existing company

Downgrade drops both tables and the `finance` rows.

The bank balances that step 3 produces are gross card takings with nothing
withdrawn against them, which is honest but will overstate what is actually in
the bank. The owner squares it once with an `adjustment_out` movement, which
stays visible in the history — better than silently editing an opening balance.

## Screens

**`/finance`** — the account list with balances and a combined movement
history. Actions: «Перевод» (account → account), «Внести», «Изъять»,
«Скорректировать остаток». Each row shows date, account, reason, note, amount
and who recorded it.

**`/shifts`** — «Внести» and «Изъять» beside «Срез» and «Закрыть смену», acting
on the till account. The movements appear in «Прочие движения денег» and in the
till arithmetic, so the cashier sees why the expected figure changed.

## Open ends, deliberately left

- No bank reconciliation against a statement. The balance is what the shop
  recorded, not what the bank says.
- No currency other than the company's. Multi-currency is its own problem.
- No approval flow on a movement. A shop of this size does not have one.
