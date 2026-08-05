# Handoff — Sellary stock/money audit, 4–5 August 2026

> **Update, 5 August.** The audit finished; another session added the stocktake
> feature (`dc2bb71`, `1069387`, `902c017`). Four more fixes shipped on 5 August:
> `4243e92` + `1dea406` (refund of a discounted line paid 0.00), `d752418` (five
> wrong report figures), `4268ecd` (barcode with a trailing space made a second
> product card). Sections 9–11 below are the current open list.


Read this whole file before touching anything. It is the full context of a session
that (a) added purchased/sold columns to the products list, (b) found why a product
showed 53 units instead of 59, (c) fixed three bugs, and (d) launched a large
read-only audit of the production database that was still running when the session
ended.

Working directory: `D:\Learning\Sellary`. Branch: `main`. Everything below is pushed.

---

## 1. Why this started

The owner (Alisher) noticed **~2000 somoni missing from the till** and suspected
duplicated sales or products. He asked for two things:

1. show, in the products list, **how much of each product was bought and how much
   was sold**, so a wrong stock number becomes visible;
2. **find the problem**.

## 2. What the 2000 somoni turned out to be

Not duplication. It is the close discrepancy of **shift №9**:

| | |
|---|---|
| shift | №9, opened 2026-07-29 03:22 UTC, closed 2026-08-03 19:00 UTC (6 days open) |
| opening cash | 14 100.63 |
| expected | 21 394.28 |
| counted | 19 385.58 |
| **discrepancy** | **−2 008.70** |

The expected figure adds up exactly: `14100.63 + 7543.30 cash sales + 499.93 cash
debt payments − 749.58 cash refunds = 21394.28`. So the arithmetic is right and the
shortage is either real missing cash or sales rung up wrongly.

Daily sales show the excess concentrated on **31.07 (3532.80 over 55 receipts)** and
**23.07 (2757.04 over 69 receipts)**, against a normal day of ~400–900. Those two
days are the place to look receipt by receipt. **This was never finished** — see
open item O1.

Total discrepancy of all shifts in the last 30 days: −1894.70.
Money accounts today: till 19 395.58, DC 847.53, Eskhata 14.00, Alif 0.00.

## 3. Why «Рс Кола 1.5л Сиё» showed 53 and not 59

Product id **14**, company_id **2**.

Production `inventory_logs` for it sum to exactly the balance:

```
po_receive     +276.000   (5 receipts)
sale           -228.000   (84 rows)
sale_void       +29.000   (14 rows)
sale_return     +18.000   (1 row)
product_delete  -42.000   (2 rows: -36 on 24.06, -6 on 18.07)
------------------------------------------------
                  53.000  == products.stock_quantity
```

The −36 on 24.06 was replaced the same day by PO #19 (+36). The **−6 on 18.07 was
never replaced**: someone deleted the product card while it still had 6 units,
the stock was written off silently, and when the card came back it started at 0.

That is the whole bug. Nothing about money, nothing about duplication.

## 4. Every product that lost stock the same way

7 delete events, 6 products; 2 of them were compensated by a receipt on the same day.

| id | product | date | lost | state today | approx value |
|---|---|---|---|---|---|
| 533 | самбуса 12с | 29.07 | 50 | inactive (deleted) | ~600 |
| 36 | Shifotea 0.5л | 23.06 | 24 | active, stock 0 | ~46 |
| 14 | Рс Кола 1.5л Сиё | 18.07 | 6 | active, stock 53 | ~66 |
| 280 | Сосиска охотничи Арзон | 23.06 | 5 | active, stock 0.728 | ~301 |

Compensated, no action needed: product 14 (−36 on 24.06, PO #19 gave +36 the same
day) and product 279 «Порошок Апрел» (−10 on 24.06, +10 the same day).
Product 295 «Test» (−11) is a test article.

**None of this is repaired in the data yet** — see open item O2.

## 5. `product_recreate` — what those 30 rows mean

Creating a product with a barcode that belongs to a soft-deleted product reactivates
that same row: `ProductService.create` calls `writeoff_all_stock(consumer_type=
"product_recreate")` first, then applies the quantity typed in the form
(`sellary-backend/services/product_service.py`, the `if existing:` branch).

So a `-90` recreate row does **not** mean 90 units were lost; it means the old
leftover was zeroed and replaced by the number the user typed. It is only dangerous
because it is silent.

## 6. Code changes made and pushed (all on `main`)

| commit | what |
|---|---|
| `af02ad0` | feat(products): purchased/sold columns |
| `815bbf5` | fix(reports): top-products died on a product with no barcode |
| `c0e0b6a` | fix(products): refuse to delete a product that still has stock |
| `179d203` | fix(products): count purchases from the receipts, not the FIFO layers |

Details:

**`af02ad0`** — `GET /api/products?with_totals=true` now returns
`purchased_quantity`, `sold_quantity`, `ledger_stock_quantity`.
- `repositories/product_repository.py::get_movement_totals` (new)
- `services/product_service.py::get_all(with_totals=...)`
- `schemas/product.py::ProductResponse` (three optional fields)
- `api/products.py` (`with_totals` query param)
- frontend: `src/app/(protected)/products/page.tsx` — «Закуплено» / «Продано»
  columns, plus a red «по партиям: X» line under the stock cell when the FIFO
  layers disagree with `stock_quantity` (helpers `formatQty` / `ledgerDrift`);
  `src/lib/types.ts` got the three fields.

**`815bbf5`** — `schemas/report.py::TopProductItem.barcode` was `str`, so the whole
top-products report raised a validation error as soon as one product had no barcode
(«ТАРБУЗ»). Now `Optional[str]`.

**`c0e0b6a`** — `ProductService.delete` raises `ValueError` when
`stock_quantity > 0` («Нельзя удалить товар, пока на нём есть остаток (53).
Сначала спишите или продайте его.»), which the router maps to 400. The frontend
delete mutation now shows `error.response.data.detail` instead of a generic toast.
`writeoff_all_stock` is kept for legacy rows whose layers still hold units their
balance has lost — that also keeps the purchase behind such a layer voidable.
Tests updated: `tests/unit/test_product_service.py`,
`tests/unit/test_purchase_void_writeoff.py`,
`tests/integration/test_product_endpoints.py`.

**`179d203`** — «Закуплено» first read `inventory_layers.original_quantity`, which
was wrong twice over: PO #9 (16 June) raised balances without writing layers at all,
and the 3 August ledger repair shrank layers of products 5, 34, 36, 250. Shifotea
showed «18 bought / 19 sold». It now sums `purchase_receipt_items.quantity` joined
to non-reversed receipts, with an outer join to `inventory_layers` so a voided line
(reversed layer) is still excluded. `ledger_stock_quantity` stays on the layers, so
the two numbers remain independent and the drift warning still means something.

Verification actually run: `pytest tests/integration tests/unit` → **1002 passed**;
frontend `npx tsc --noEmit` clean; CI green for `af02ad0` and `815bbf5`; the backend
deploy was confirmed live by finding `with_totals` in the production `openapi.json`.
CI for `c0e0b6a` and `179d203` was **not** checked — do that first.

## 7. The audit that was still running

Launched with the Workflow tool: 7 dimensions × (audit → adversarial verify).
45 agents started, 30 had returned when the session ended.

- run id: `wf_dd384ad3-f26`
- script: `C:\Users\alisher.ummatqulov\.claude\projects\D--Learning-Sellary\5596ee52-6a36-4759-8531-4e8c3374e1f3\workflows\scripts\sellary-prod-audit-wf_dd384ad3-f26.js`
- results: `...\subagents\workflows\wf_dd384ad3-f26\journal.jsonl` (one JSON line per
  agent; `{"type":"result", ...}` lines carry the findings) plus `agent-*.jsonl`

Dimensions: `stock`, `sales`, `money`, `purchases`, `reports`, `writeoffs`,
`hygiene`. Each auditor returns `{dimension, checks[]}` where a check has
`name / holds / expected / actual / affected / detail / severity / sql`; every
failing check is then handed to a skeptic that must re-derive it with a different
query and may set `confirmed=false`.

**To continue**: read `journal.jsonl` first (it holds the completed results — do not
re-run what already answered), then either resume
`Workflow({scriptPath: "<path above>", resumeFromRunId: "wf_dd384ad3-f26"})` or just
finish the missing dimensions by hand.

One partial result already visible in the journal: purchases check 1 —
`purchase_order_items.quantity_received == SUM(purchase_receipt_items.quantity)`
holds for all **560** PO lines.

Facts already established that the audit must not re-report as new:
- FIFO drift across the whole company is **0 products** (`stock_quantity` equals the
  sum of open-layer `remaining_quantity` everywhere) after the 3 August repair;
- the 4 delete losses in section 4;
- shift 9's −2008.70;
- PO #9 wrote no layers.

## 8. How to query production (read-only)

The permission rule `"Bash(railway run:*)"` was added to
`D:\Learning\Sellary\.claude\settings.local.json` by the owner. **Warning:** that rule
injects the production environment, so it also allows writes — every script must be
SELECT-only, and any repair must be shown to the owner before it runs.

The Railway service `Sellary` only exposes the internal Postgres host, so use the
`Postgres` service, which carries `DATABASE_PUBLIC_URL`:

```bash
cd "D:/Learning/Sellary/sellary-backend" && railway run --service Postgres -- "D:\\Learning\\Sellary\\sellary-backend\\.venv\\Scripts\\python.exe" "C:\\path\\to\\script.py"
```

Script header (the stdout reconfigure is needed or Cyrillic output dies on cp1252):

```python
import os
import sys
from sqlalchemy import create_engine, text
sys.stdout.reconfigure(encoding="utf-8")
url = os.environ.get("DATABASE_PUBLIC_URL") or os.environ["DATABASE_URL"]
engine = create_engine(url.replace("postgres://", "postgresql://", 1))
```

Do not put an env-var prefix (`FOO=bar railway run ...`) before the command — it no
longer matches the permission rule and the call is denied. Existing read-only scripts
live in the session scratchpad:
`C:\Users\ALISHE~1.UMM\AppData\Local\Temp\claude\D--Learning-Sellary\5596ee52-6a36-4759-8531-4e8c3374e1f3\scratchpad\`
(`inspect_product.py <id>`, `scan_delete_writeoffs.py`, `list_delete_losses.py`).

The live shop is **company_id = 2**, timezone Asia/Dushanbe. The MCP connector to the
same backend is also available for read-only reports (`get_sales_summary`,
`list_shifts`, `get_top_products`, `get_purchases_by_product`, `search_products`, …).

## 9. Open items

- **O1** — the −2008.70 of shift 9 is still unexplained. Go through the receipts of
  31.07 and 23.07 one by one and compare each sale's tenders with what the cashier
  actually took. Nothing in the code has been shown to cause it yet.
- **O2** — the 4 lost stock quantities (533: 50, 36: 24, 14: 6, 280: 5) are still
  missing from the data. The owner was asked whether to restore them and had not
  answered. A restore must be a normal inventory adjustment with a written reason,
  not a raw UPDATE.
- **O3** — finish the audit (section 7) and give the owner one exact table:
  every invariant, expected vs actual, severity.
- **O4** — check CI for `c0e0b6a` and `179d203` (`gh run list`).
- **O5** — the product-recreate path still wipes leftover stock silently. Now that
  delete is blocked while stock > 0, consider blocking the silent wipe too, or at
  least warning in the UI.
- **O6** — `TopProductItem.quantity_sold` is `int`, so a product sold by weight
  (`43.142 kg`) is truncated in the top-products report. Not yet fixed.

## 10. Where it stands after 5 August

Fixed and deployed (CI green, backend and frontend live):

| commit | what it fixes |
|---|---|
| `4243e92` + `1dea406` | A return of a discounted line paid the customer 0.00. Basis is now `sale_item.total` minus the pro-rata share of any sale discount the lines do not carry. Replayed over all 23 production returns: 20 reproduce to the cent, 3 become 5.00 / 2.00 / 10.00. The offline cashier now allocates a sale discount the way `SaleService.create` does. |
| `d752418` | «Доля в закупках» divided by the top-50 page instead of the period (13589.83 of 19406.22); PO #56's 28 line-voided receipts still counted as purchases; `quantity_sold` truncated 43.142 kg to 43; top-product profit used today's cost card, not cost at sale; the reports page printed `total_profit`, a field the API never sends, so it always showed 0; «30 дней» covered 31 days while the connector's `last_30_days` covered 30. |
| `4268ecd` | A barcode with a trailing space passed the duplicate check and created a second card for the same article. Trimmed on write and compared trimmed. |

Still open, in order:

1. **Pay the three customers**: sale 98 → 5.00, sale 103 → 2.00, sale 476 → 10.00
   (returns 4, 8, 10 on 30–31 July). The code no longer creates this, but the
   money was never handed over.
2. **17 short barcodes are shared by different goods** — «60» is both «Термос
   Охан» (60.00) and «ланчик» (0.60); «86» is both «Крышка Гулдор» and «сервелат
   48 ташкентский»; «74» sits on three soap cards. Scanning one can ring up the
   other. The owner has to choose new codes; the 9 remaining duplicate groups are
   harmless onboarding leftovers (the second card is inactive with no stock and
   no sales).
3. **Restore the 4 delete losses** — 533 (50), 36 (24), 14 (6), 280 (5),
   ~1013 in cost — as stocktake documents, not raw UPDATEs.
4. **Product 545 «кола 0.33»** holds 20 units at cost 0.00 (PO 71 received them
   at zero), so its profit is overstated.
5. **81 inactive products still hold 2737 units / 128 266 of value.** They are
   excluded from «стоимость склада» (`get_inventory_value` filters `is_active`),
   so no report is wrong today, but the value is fabricated by the 15 June seed
   layers and would come back to life if a card were reactivated.
6. **Shift 9's −2008.70** is still unexplained (see O1).

## 11. How the owner wants to be answered

Uzbek or very simple English, two sentences, verdict first, no options — one
decision. Never claim something is done without having run the check and read the
output. Warnings about production writes and data loss are always written in full.
