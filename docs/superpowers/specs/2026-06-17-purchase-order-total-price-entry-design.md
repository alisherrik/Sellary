# Zakupkada umumiy summa orqali kiritish + 4-xonali narx aniqligi

**Sana:** 2026-06-17
**Holat:** Tasdiqlangan

## Muammo

Zakupkada (purchase order) user har bir qatorda **Количество** (soni) va **Цена** (dona narxi) kiritadi.
Lekin amalda tovarlar ko'pincha **optom narxda** olinadi — masalan bir blok kola 45 so'm.
Dona narxi qoldiq bilan chiqadi (`45 / 24 = 1.875`) va buni qo'lda kiritish qiyin.
Bundan tashqari narx hamma joyda 2 xona aniqlikda saqlanadi, shuning uchun `1.88 × 24 = 45.12 ≠ 45` —
qoldiq paydo bo'ladi.

## Maqsad

1. Userga zakupka qatorida **Сумма** (umumiy/optom narx) ni to'g'ridan-to'g'ri kirita olish.
   Dona narxi avtomatik hisoblanadi: `unit_cost = Сумма / Количество`.
2. Qoldiqni yo'qotish uchun narx aniqligini hamma joyda `Numeric(10,2) → Numeric(10,4)` ga ko'tarish.
   `45 / 24 = 1.8750` aniq saqlanadi, `subtotal = 45.0000`.

## Backend o'zgarishlari

### Migration (yangi alembic revision)
`Numeric(10,2) → Numeric(10,4)`:
- `purchase_order_items.unit_cost`
- `purchase_receipt_items.unit_cost`
- `inventory_layers.unit_cost`
- `products.cost_price`

Numeric kengaytirish xavfsiz: eski `1.88` qiymatlar `1.8800` bo'ladi, ma'lumot yo'qolmaydi.

### Schemas
- `PurchaseOrderItemBase.unit_cost`: `decimal_places=2 → 4`
- `ProductBase.cost_price` va `ProductUpdate.cost_price`: `decimal_places=2 → 4`
  (**majburiy** — aks holda 4-xonali `cost_price` bilan `ProductResponse` validatsiyadan o'tmaydi)

### Ledger (`services/inventory_ledger_service.py`)
- `PRICE_QUANT = Decimal("0.01") → Decimal("0.0001")` — o'rtacha (weighted-average) `cost_price`
  aniqligini saqlasin. `MONEY_QUANT` allaqachon `0.0001`, asosiy matematika tegmaydi.

`subtotal = quantity × unit_cost` mantiqi o'zgarmaydi — endi `24 × 1.8750 = 45.0000` aniq chiqadi.

## Frontend o'zgarishlari (zakupka editori)

### `features/purchase-orders/purchaseOrderForm.ts`
- `unit_cost` yagona haqiqat (source of truth) bo'lib qoladi; payload `unit_cost` yuboradi.
- Yangi helperlar:
  - `deriveUnitCostFromTotal(total, qty)` → `round(total / qty, 4)` (qty ≤ 0 bo'lsa hisoblamaydi)
  - `deriveLineTotal(qty, unitCost)` → `qty × unitCost`

### `components/purchase-orders/PurchaseOrderItemsTable.tsx`
`Сумма` ustuni endi tahrirlanadigan `<input>`, `Цена` bilan ikki tomonlama:
- User **Сумма** kiritsa → `unit_cost = deriveUnitCostFromTotal(Сумма, Количество)`
- User **Цена** yoki **Количество** kiritsa → `Сумма = deriveLineTotal(...)` (ko'rsatiladi)
- `Сумма` katakchasi yozish paytida "snap" bo'lmasligi uchun ichki tahrir-buferi (local edit state)
  bilan ishlaydi: fokusda userning yozgani ko'rinadi, `onChange`da `unit_cost`ga commit bo'ladi.
- Editordagi **Цена** input `unit_cost` ni to'liq (4 xonagacha, ortiqcha nollarsiz) ko'rsatadi.

### Manba haqiqati qarori
`unit_cost` saqlanadigan haqiqat. **Количество** o'zgarsa — `unit_cost` barqaror qoladi,
`Сумма` qayta hisoblanadi (1 blok → 2 blok = summa 45 → 90, dona narx o'zgarmaydi). Optom mantiqiga mos.

### Ko'rinish (faqat-o'qish joylar)
PO detail (`purchase-orders/[id]/page.tsx`) — `formatCurrency` (2 xona) — bu yerda `1.88` ko'rinishi
maqbul, chunki pul jami to'g'ri.

## Chekka holatlar
- `Количество = 0` yoki bo'sh → bo'lish mumkin emas: `Сумма` kiritilsa `unit_cost` o'zgarmaydi.
- Mahsulot tanlanganda `unit_cost` mahsulot `cost_price`'idan to'ldiriladi (hozirgi xatti-harakat).
- Validatsiya: `unit_cost ≥ 0`, `Количество > 0` (hozirgicha).

## Test qilish
- **Backend:** `python -m compileall` gate; PO create/update test'larida 4-xonali `unit_cost`
  va aniq `subtotal`; ledger receive test'i `inventory_value` aniqligi.
- **Frontend:** `purchaseOrderForm.test.ts` — `deriveUnitCostFromTotal` (45/24=1.875), Сумма↔Цена
  ikki tomonlama; `PurchaseOrderItemsTable.test.tsx` — Сумма kiritilganda Цена yangilanishi.
- Profit/report formatlash 4-xona bilan buzilmasligini tekshirish.
