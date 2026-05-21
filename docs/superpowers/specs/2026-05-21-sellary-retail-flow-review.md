# Sellary Retail POS, Inventory, Purchase, UOM va Srok Product Flow Review

Sana: 2026-05-21

Loyiha: Sellary

Scope: retail POS MVP, supplier/vendor, purchase order, stock, UOM, sales, returns, expiry/srok product, production readiness.

## Qisqa Xulosa

Sellary hozir online retail POS MVP uchun yaxshi asosga ega: product katalog, supplier, purchase order, sale, return, inventory log, idempotency va tenant isolation bor. Sale vaqtida stock kamayishi, purchase receive vaqtida stock ko'payishi, return/cancel vaqtida stock qaytishi asosiy darajada ishlayapti.

Lekin productionga "standart POS" sifatida chiqarishda hali bir nechta muhim gap bor:

1. Purchase order frontend `send` va `cancel` requestlariga `Idempotency-Key` bermayapti, backend esa talab qilyapti. Bu UI workflowda xato berishi mumkin.
2. Srok/expiry product umuman model qilinmagan. Agar oziq-ovqat, dori, kosmetika yoki yaroqlilik muddati bor mahsulot sotilsa, bu productionga chiqishdan oldin kerak.
3. UOM hozir oddiy text field. Purchase UOM va sale UOM orasida conversion yo'q. Masalan, quti bilan olib dona sotish, kg bilan olib gramm sotish, litr bilan olib ml sotish hali standard emas.
4. Stock hozir product-level bitta aggregate son. Lot/batch, expiry, FIFO/FEFO, cost per batch yo'q.
5. Product stockni edit formdan to'g'ridan-to'g'ri o'zgartirish mumkin. Bu inventory log/auditni chetlab o'tadi.
6. Cost/profit hisoblari production POS uchun hali to'liq emas: sale itemda `cost_at_sale` yo'q, reportlar current `Product.cost_price`ga tayanadi.
7. Sale-level discount/overall markup return/refundga to'g'ri taqsimlanmagan. Overall discount ishlatilsa return refund noto'g'ri chiqishi mumkin.
8. Purchase order moduli uchun backend integration/unit testlar deyarli yo'q. Core stock flowni productionga chiqarishdan oldin test bilan yopish kerak.

Mening tavsiyam: agar mijozlar oddiy non-expiry retail bo'lsa, 1, 3, 5, 6, 7, 8 ni tez yopib pilot qilish mumkin. Agar srokli product bo'lsa, expiry/batch trackingni production oldidan P0 qilish kerak.

## Hozirgi Real Workflow

### 1. Vendor/Supplier

Hozirgi model:

- `suppliers` jadvali bor.
- Supplier company scope ichida saqlanadi.
- Fieldlar: name, contact_person, email, phone, address, payment_terms, is_active.
- Supplierga purchase orderlar bog'lanadi.

Hozirgi flow:

1. Admin/manager supplier yaratadi.
2. Supplier purchase orderda tanlanadi.
3. Supplierni o'chirishga faqat PO yo'q bo'lsa ruxsat.

Yaxshi tomon:

- Supplier business oqimi uchun yetarli minimal model bor.
- Existing PO bo'lsa supplier delete bloklanadi.

Kamchilik:

- Supplier delete hard delete qiladi; product/category/customer kabi soft-delete emas.
- Supplier duplicate nazorati yo'q. Masalan, bitta phone/name bilan ikki marta supplier ochilishi mumkin.
- Supplier balance, payables, vendor invoice, payment status yo'q. MVP uchun shart emas, lekin keyinchalik kerak bo'ladi.

Tavsiya:

- MVP uchun supplier modeli yetarli.
- Supplier delete ham soft-delete bo'lishi kerak.
- Duplicate guard qo'shish kerak: company_id + normalized phone yoki company_id + normalized name.

## 2. Product va UOM

Hozirgi model:

- Productda `uom` oddiy string: `dona`, `kg`, `litr`, `metr`, `quti`, `komplekt`.
- Stock quantity `Numeric(10,3)`, ya'ni 3 decimalgacha ishlaydi.
- Productda `cost_price`, `sell_price`, `tax_percent`, `stock_quantity`, `min_stock_level` bor.

Yaxshi tomon:

- Decimal quantity backendda bor. Kg/litr kabi fractional mahsulotlar uchun baza mavjud.
- UOM frontendda select sifatida ko'rsatilgan.

Muhim muammo:

UOM faqat label. System hali "unit conversion" qilmaydi.

Misollar:

- 1 quti = 24 dona
- 1 kg = 1000 gramm
- 1 litr = 1000 ml
- 1 pack = 6 bottle

Hozir system buni bilmaydi. Purchase orderda `quantity_ordered=1 quti` va POSda `1 dona` sotish kabi real retail flow ishlamaydi. Hozir purchase, stock va sale bir xil product UOMda bo'lishi shart.

Frontenddagi receive modal ham `parseInt` ishlatyapti. Bu 1.5 kg, 0.25 litr kabi receive qilishni buzadi.

Tavsiya:

MVP uchun ikkita yo'l bor.

### Variant A: Sodda, tez va xavfsiz

Har bir product bitta base UOMda yuradi. Purchase ham, stock ham, sale ham shu UOMda bo'ladi.

Misollar:

- Coca Cola 1.5L bottle -> UOM `dona`
- Guruch -> UOM `kg`
- Yog' -> UOM `litr`
- Non -> UOM `dona`

Quti bilan olib dona sotilsa, POga dona sonini kiritiladi: 10 quti x 24 dona = 240 dona.

Afzallik:

- Tez implement.
- Kam bug.
- Hozirgi modelga mos.

Kamchilik:

- User quti/pack conversionni qo'lda hisoblaydi.

### Variant B: Standard UOM conversion

Yangi tablelar:

- `units`: id, code, name, unit_type, precision
- `product_units`: product_id, unit_id, conversion_to_base, is_base, is_purchase_default, is_sale_default

Stock doim base UOMda saqlanadi. Purchase va sale kirishda conversion qilinadi.

Misol:

- Product: Coca Cola 0.5
- Base UOM: dona
- Purchase UOM: quti, conversion_to_base = 24
- Sale UOM: dona, conversion_to_base = 1
- PO receive: 10 quti -> stock +240 dona
- Sale: 3 dona -> stock -3 dona

Afzallik:

- Professional POS/inventory standard.
- Katta do'konlar uchun qulay.

Kamchilik:

- UI, API, tests, reportlar ko'proq o'zgaradi.

Mening tavsiyam:

Pilot uchun Variant A yetarli, lekin UIga aniq text qo'yish kerak: "Miqdor productning asosiy birlikida kiritiladi". Agar mijozlar quti bilan olib dona sotsa, Variant B ni P1 qilish kerak.

## 3. Purchase Order Flow

Hozirgi backend flow:

1. PO `draft` statusda yaratiladi.
2. Draft paytida edit/delete mumkin.
3. `send` qilinganda status `sent`.
4. `receive` qilinganda:
   - PO item locked qilinadi.
   - Product rows locked qilinadi.
   - `quantity_received` oshadi.
   - Product `stock_quantity` oshadi.
   - Inventory log yoziladi.
   - PO `partially_received` yoki `received` bo'ladi.
5. `cancel` allowed: draft, sent, partially_received.

Yaxshi tomon:

- State machine bor.
- Receive vaqtida row lock ishlatilgan.
- Over-receive validation bor.
- Partial receive bor.
- Inventory log yoziladi.
- Idempotency backendda receive uchun bor.

P0 muammo: frontend send/cancel idempotency header bermaydi

Backend:

- `POST /api/purchase-orders/{id}/send` `Idempotency-Key` talab qiladi.
- `POST /api/purchase-orders/{id}/cancel` ham birinchi route sifatida `Idempotency-Key` talab qiladi.

Frontend:

- `purchaseOrdersApi.send(id)` header bermaydi.
- `purchaseOrdersApi.cancel(id)` header bermaydi.

Natija:

- UIda "Send" yoki "Cancel" bosilganda backend 400 qaytarishi mumkin.
- Bu purchase workflowni productionda buzadi.

Fix:

- `purchaseOrdersApi.send` va `purchaseOrdersApi.cancel` ham `generateIdempotencyKey()` yuborsin.
- Backenddagi duplicate cancel route olib tashlansin. Hozir bir xil path/method ikki marta e'lon qilingan.
- Tests qo'shilsin: send/cancel without idempotency -> 400, with idempotency -> success, replay -> cached/same response.

P1 muammo: PO create/update idempotent emas

PO receive idempotent, lekin PO create/update emas. Double-click yoki network retry PO duplicate yaratishi mumkin.

Tavsiya:

- PO create ham `Idempotency-Key` talab qilsin yoki frontend submit buttonni hard-disable qilsin.
- Production standard uchun create ham idempotent bo'lgani yaxshi.

P1 muammo: Receive request schema kuchsiz

Hozir `ReceiveItemsRequest.items` `List[dict]`.

Tavsiya:

```text
ReceiveItem:
- item_id: int > 0
- quantity_to_receive: Decimal > 0, decimal_places=3
- lots?: list for expiry-tracked products
```

Bu validationni Pydantic darajasida kuchaytirish kerak.

## 4. Stock Count Standard

Hozir product stock bitta field:

```text
products.stock_quantity
```

Stockni o'zgartiradigan joylar:

- Sale create -> kamayadi
- Sale cancel -> ko'payadi
- Sale return -> ko'payadi
- PO receive -> ko'payadi
- Manual inventory adjust -> ko'payadi/kamayadi
- Product update -> to'g'ridan-to'g'ri o'zgarishi mumkin

Yaxshi tomon:

- Core stock movementlar transaction ichida ketadi.
- Sale/return/receive product rows lock qiladi.
- Inventory log bor.
- Overselling bloklangan.

Katta muammo: Product edit stockni auditdan chetlab o'tadi

Product update schema `stock_quantity`ni qabul qiladi. ProductService.update esa uni oddiy field sifatida set qiladi. Bu stockni inventory log yozmasdan o'zgartiradi.

Productionda bunday bo'lmasligi kerak. POS/inventory systemda stock o'zgarishi har doim movement/log bilan yurishi kerak.

To'g'ri qoida:

- Product yaratishda initial stock 0 bo'lsin yoki "opening balance" movement yaratilishi kerak.
- Product edit stock_quantityni o'zgartirmasin.
- Stock o'zgarishi faqat:
  - purchase receive
  - sale
  - sale cancel
  - sale return
  - manual adjustment
  - expired write-off
  - supplier return
orqali bo'lsin.

Tavsiya:

- Product update API dan `stock_quantity`ni olib tashlash yoki ignore qilish.
- Initial stock uchun alohida endpoint: `POST /api/inventory/opening-balance`.
- Admin product edit qilsa, stock field readonly bo'lsin; yonida "Adjust stock" button bo'lsin.

## 5. Sales POS Flow

Hozirgi sale flow:

1. Cashier product tanlaydi.
2. Backend productlarni `FOR UPDATE` bilan lock qiladi.
3. Requested quantity stockdan ko'p bo'lsa reject.
4. Subtotal = quantity x unit_price.
5. Tax = subtotal x tax_percent / 100.
6. Item total = subtotal + tax - item_discount.
7. Sale total = subtotal + tax - sale_discount.
8. Stock kamayadi.
9. Inventory log yoziladi.
10. Sale status `completed`.

Yaxshi tomon:

- Overselling bloklangan.
- Decimal hisob ishlatilgan.
- Row lock ishlatilgan.
- Idempotency bor.
- Card payment uchun card_type validation bor.
- Sale returns partial qayta ishlaydi.

P0/P1 muammo: overall discount va return refund mismatch

Sale itemda `total` item-level discountni hisoblaydi. Sale total esa sale-level discountni alohida hisoblaydi. Return refundda esa:

```text
unit_refund = sale_item.total / sale_item.quantity
```

Bu overall discountni hisobga olmaydi.

Misol:

- Product A: 100
- Product B: 100
- Overall discount: 20
- Sale total: 180
- User Product A ni return qiladi

Hozir Product A refund 100 bo'lishi mumkin, lekin standard POSda refund 90 bo'lishi kerak, chunki 20 discount proportional taqsimlanishi kerak.

Fix variantlari:

### Variant A: Discount allocation snapshot

Sale create vaqtida sale-level discountni itemlarga proportional taqsimlash:

```text
item_discount_total = item_discount + allocated_sale_discount
item_total = item_subtotal + item_tax - item_discount_total
```

SaleItemga yangi fieldlar:

- line_discount_amount
- allocated_sale_discount_amount
- final_total

Return refund `final_total / quantity`dan hisoblanadi.

### Variant B: Backend sale totalni item totals sumidan chiqarish

Sale total doim item total sumiga teng bo'ladi. Sale-level discount yo'q, hammasi itemlarga tarqatiladi.

Mening tavsiyam: Variant A/B aralashmasi: backendga sale-level discount kelishi mumkin, lekin service uni itemlarga allocate qilib, item final_total snapshotini saqlasin.

P1 muammo: overall markup frontendda to'liq backendga bormaydi

Item markup uchun frontend unit_price oshiryapti. Bu ishlaydi. Lekin overall markup UIda ko'rsatilsa ham backendga qo'shimcha total sifatida bormaydi, chunki `discount_amount` `Math.max(0, ...)` bilan clamp bo'ladi.

Tavsiya:

- MVPda overall markupni o'chirish.
- Faqat item-level price override qoldirish.
- Yoki `adjustment_amount` modelini qo'shish:
  - positive = surcharge/markup
  - negative = discount

P1 muammo: Tax discountdan oldin hisoblanadi

Hozir tax subtotaldan hisoblanadi, keyin discount ayriladi.

Ba'zi joylarda POS standard:

```text
taxable_base = subtotal - discount
tax = taxable_base * tax_percent
```

Qaysi biri to'g'ri bo'lishi mamlakat/biznes qoidaga bog'liq. Hozir bu aniq hujjatlashtirilmagan.

Tavsiya:

- MVPda tax disabled yoki 0 bo'lsa muammo yo'q.
- Agar real VAT/soliq ishlatilsa, tax calculation policy alohida config bo'lishi kerak:
  - tax_before_discount
  - tax_after_discount
  - tax_inclusive_price

## 6. Returns va Cancellation

Hozirgi return flow:

1. Sale lock qilinadi.
2. Sale items lock qilinadi.
3. Return quantity returnable quantitydan oshsa reject.
4. Product rows lock qilinadi.
5. Refund amount item totalga proportional hisoblanadi.
6. Product stock oshadi.
7. Inventory log yoziladi.
8. Sale status partial/returned bo'ladi.

Yaxshi tomon:

- Partial return bor.
- Over-return bloklangan.
- Stock qaytadi.
- Sale status to'g'ri yangilanadi.

Kamchiliklar:

- Overall discount allocation yo'q.
- Return qaysi batch/lotga qaytishi model qilinmagan.
- Return qilingan product "resellable", "damaged", "expired", "quarantine" kabi holatlarga ajratilmagan.
- Inventory log `reference_id=None` yozadi return logda. Bu audit uchun yetarli emas; sale_return.id flushdan keyin log reference_id sifatida yozilishi kerak.

Tavsiya:

- Return reason va condition qo'shish:
  - resellable
  - damaged
  - expired
  - wrong_item
  - customer_changed_mind
- Resellable bo'lsa stockga qaytarish.
- Damaged/expired bo'lsa stockga qaytarmaslik yoki quarantine stockga o'tkazish.
- `reference_type="sale_return"`, `reference_id=sale_return.id` bo'lishi kerak.

## 7. Cost, COGS va Profit

Hozir productda `cost_price` bor. Purchase itemda `unit_cost` bor. Sale itemda `cost_price_at_sale` yo'q.

Report profit hisobida current product cost ishlatiladi.

Muammo:

Bugun product cost 10 edi, sotuv bo'ldi. Ertaga purchase receive qilib cost 12 bo'ldi. Agar report current Product.cost_price bilan hisoblansa, kechagi sale profit ham o'zgarib ketadi. Bu production accounting/POS uchun noto'g'ri.

Standart yechim:

SaleItemda snapshot saqlash:

- unit_cost_at_sale
- cost_total_at_sale
- gross_profit_at_sale

Sale vaqtida qaysi costing method tanlangan bo'lsa, shu bo'yicha cost yoziladi:

- Simple MVP: current product.cost_price snapshot
- Better: moving average cost
- Best for expiry/lot: lot-specific cost via FEFO/FIFO allocation

Purchase receive vaqtida cost update:

MVP uchun moving average:

```text
new_avg_cost =
  (old_stock * old_avg_cost + received_qty * received_unit_cost)
  / (old_stock + received_qty)
```

Agar old stock 0 bo'lsa, cost = received_unit_cost.

Expiry/lot modelga o'tilganda har lot o'z unit_costini saqlaydi va COGS sale allocationdan keladi.

## 8. Srok/Expiry Product Masalasi

Hozir expiry/srok product support yo'q. Productda expiration_date yo'q, batch/lot yo'q, stock bitta umumiy son.

Agar mahsulotlarda yaroqlilik muddati bo'lsa, aggregate stock yetarli emas.

Misol:

- Product: Yogurt
- Batch A: 20 dona, expiry 2026-06-01
- Batch B: 30 dona, expiry 2026-07-01
- Total stock: 50

POS sotganda qaysi batchdan sotildi? Agar expiry yaqin batch sotilmasa, omborda eski srok qoladi. Return bo'lsa qaysi batchga qaytadi? Expired bo'lsa sotishni bloklash kerakmi?

Shu savollar hozir systemda javobsiz.

### Eng yaxshi model: Lot/Batch + FEFO

Yangi field:

Product:

- tracking_mode: none | expiry | lot | serial
- requires_expiry: bool
- shelf_life_days: optional
- expiry_warning_days: int default 30

Yangi table: `inventory_lots`

- id
- company_id
- product_id
- supplier_id
- purchase_order_id
- purchase_order_item_id
- lot_code
- expiration_date
- received_at
- unit_cost
- quantity_received
- quantity_available
- status: active | expired | quarantined | depleted | written_off
- created_by
- created_at

Yangi table: `stock_movements`

- id
- company_id
- product_id
- lot_id nullable
- movement_type:
  - opening_balance
  - purchase_receive
  - sale
  - sale_cancel
  - sale_return
  - manual_adjust
  - expired_writeoff
  - supplier_return
- quantity_delta
- unit_cost
- previous_quantity
- new_quantity
- reference_type
- reference_id
- reason
- created_by
- created_at

Yangi table: `sale_item_lots`

- sale_item_id
- lot_id
- quantity
- unit_cost_at_sale

### Expiry flow

PO receive:

1. Product expiry-tracked bo'lsa, receive modal expiry date talab qiladi.
2. User lot_code kiritadi yoki system yaratadi.
3. Stock lotga qo'shiladi.
4. Product aggregate stock ham oshadi.
5. Movement yoziladi.

POS sale:

1. Product expiry-tracked bo'lsa, system FEFO qiladi.
2. Eng yaqin expiry date bor active lotdan sotadi.
3. Expired lotdan sotishni bloklaydi.
4. SaleItemLot allocation saqlanadi.
5. COGS lot unit_costdan yoziladi.

Return:

1. Return original sale_item_lots bo'yicha qaysi lotdan sotilganini biladi.
2. Agar product resellable va expired emas bo'lsa, original lotga stock qaytadi.
3. Agar expired/damaged bo'lsa, quarantine yoki write-off movement yoziladi.

Daily job:

- Expiring soon list
- Expired list
- Optional auto status update: lot status expired
- Expired lotni POSda block qilish

UI kerak:

- Receive modalda "expiry date" va "lot/batch" fieldlari.
- Product detailda "Batches" tab.
- Dashboardda "Sroki yaqin productlar".
- POSda expired product scan qilinsa block.
- Reportsda expired write-off amount.

### Expiry implement priority

Agar mijozlar srokli product sotmasa:

- Expiry modelni P2 qilsa bo'ladi.
- Lekin stock audit va sale cost snapshotni baribir qilish kerak.

Agar mijozlar oziq-ovqat/dori/kosmetika sotsa:

- Expiry model P0/P1.
- Productionga chiqishdan oldin hech bo'lmaganda lot + expiration_date + FEFO block kerak.

Minimal expiry MVP:

1. Productda `requires_expiry`.
2. PO receive itemda `expiration_date`.
3. `inventory_lots` table.
4. Sale FEFO allocation.
5. Expired lotdan sotishni block qilish.
6. Expiring soon report.

Keyingi phase:

- Supplier return
- Quarantine stock
- Damaged return
- Auto write-off workflow

## 9. Standard End-to-End Flow

Quyidagi flow production POS uchun tavsiya qilinadi.

### Product setup

1. Category yaratish.
2. Product yaratish:
   - name
   - barcode
   - base_uom
   - sale_uom
   - purchase_uom
   - cost method
   - sell price
   - tax policy
   - expiry tracking yes/no
3. Initial stockni product formda emas, opening balance movement bilan kiritish.

### Vendor setup

1. Supplier yaratish.
2. Duplicate supplier tekshirish.
3. Supplier active/inactive status.

### Purchase

1. PO draft yaratish.
2. Itemlar qo'shish.
3. Unit cost kiritish.
4. PO send.
5. Receive:
   - received quantity
   - unit cost confirmation
   - expiry/lot if needed
6. Stock movement yozish.
7. Product average cost yoki lot cost update.
8. PO status partial/received.

### Sale

1. Product search/barcode.
2. Inactive/expired/out-of-stock product block.
3. Quantity kiritish.
4. Price override/discount policy.
5. Backend recalculates all money values.
6. Stock lock.
7. FEFO/FIFO allocation if tracked.
8. Sale item cost snapshot.
9. Stock movement.
10. Receipt number.

### Return

1. Sale tanlash.
2. Returnable items ko'rsatish.
3. Refund amount backenddan exact calculated.
4. Return reason/condition tanlash.
5. Resellable bo'lsa stockga qaytish.
6. Damaged/expired bo'lsa quarantine/write-off.
7. Movement log.
8. Sale status update.

### Manual stock adjustment

1. Admin/manager only.
2. Reason required.
3. Optional lot_id for expiry product.
4. Negative stock block.
5. Movement log required.

## 10. Productionga Chiqish Oldidan Priority Roadmap

### P0: Darhol Fix

1. Purchase order frontend idempotency:
   - `send` header qo'shish
   - `cancel` header qo'shish
   - duplicate backend cancel route olib tashlash
   - tests qo'shish

2. Product stock edit audit:
   - product update orqali stock_quantity editni o'chirish
   - opening balance/adjustment flow qilish
   - frontend product formda stock readonly yoki "initial only" qilish

3. Sale return discount allocation:
   - sale-level discountni itemlarga allocate qilish
   - return refundni allocated final item totaldan hisoblash
   - tests: overall discount + partial return

4. Purchase order tests:
   - create draft
   - send
   - receive partial
   - receive rest
   - over-receive reject
   - stock increase
   - inventory log
   - idempotency replay

### P1: Pilot uchun Juda Muhim

1. UOM policy:
   - agar conversion qilmasak, UI/docsda "base unit only" deb aniq qilish
   - receive modalda decimal quantity support

2. Cost snapshot:
   - sale_items.unit_cost_at_sale
   - sale_items.cost_total_at_sale
   - reports COGS shu snapshotdan hisoblasin

3. Purchase receive cost update:
   - moving average cost yoki last cost policy tanlash
   - product costni receive asosida yangilash

4. Barcode inactive product:
   - barcode endpoint inactive productni 404 qilsin
   - soft-deleted product barcode reuse policy tanlansin

5. Inventory reconciliation:
   - product.stock_quantity va movement sum solishtiradigan admin check
   - drift bo'lsa report

### P2: Srok/Expiry Agar Mijoz Talab Qilsa

1. `inventory_lots`
2. Product `requires_expiry`
3. PO receive expiry date
4. FEFO sale allocation
5. Expiring soon dashboard
6. Expired product block
7. Return to lot/quarantine/write-off

### P3: Keyingi POS Standartlar

1. Cash drawer / shift:
   - shift open
   - cash in/out
   - shift close
   - expected cash vs actual cash

2. Receipt numbering:
   - company scoped receipt_no
   - printable receipt

3. Payment details:
   - cash received
   - change
   - card provider transaction id
   - split payment

4. Supplier returns:
   - received productni supplierga qaytarish
   - stock decrease
   - payable/credit note later

## 11. Testing va Manual Smoke Checklist

### Backend automated tests

P0 testlar:

- Purchase send with idempotency key succeeds.
- Purchase send without key fails.
- Purchase cancel with idempotency key succeeds.
- Purchase receive partial updates stock.
- Purchase receive replay does not double stock.
- Product update cannot silently change stock.
- Inventory adjustment changes stock and writes log.
- Sale with stock exactly available succeeds.
- Sale over stock fails.
- Sale duplicate idempotency replay does not double-decrement stock.
- Sale return partial restores correct stock.
- Sale return with overall discount refunds correct proportional amount.
- Sale cancel restores stock once.

### Frontend tests

- Purchase order send/cancel uses idempotency header.
- Receive modal accepts decimal quantity for kg/litr.
- Product form does not silently edit stock after product exists.
- POS overall markup disabled or correctly sent to backend.
- POS shows backend error when inactive/out-of-stock product selected.

### Manual smoke

1. Create supplier.
2. Create product with stock 0.
3. Create purchase order for product.
4. Send PO.
5. Receive half.
6. Verify product stock increased.
7. Receive rest.
8. Verify PO status received.
9. Sell product in POS.
10. Verify stock decreased.
11. Return partial sale.
12. Verify stock increased only by returned quantity.
13. Cancel another sale.
14. Verify stock restored once.
15. Check inventory logs for every stock movement.

## 12. Mening Yakuniy Tavsiyam

Hozirgi sharoitda Sellaryni quyidagicha olib chiqish eng to'g'ri:

### Agar pilot mijoz oddiy retail bo'lsa

Production oldidan P0/P1dan kamida quyilarni qiling:

1. PO send/cancel idempotency frontend fix.
2. Product stock edit audit fix.
3. Sale return discount allocation fix.
4. Purchase order test coverage.
5. UOM base-unit policy aniq qilish.
6. Cost snapshot qo'shish.

Shundan keyin online retail MVP pilotga ancha sog'lom bo'ladi.

### Agar pilot mijoz srokli product sotsa

Expiry/batch trackingni qoldirmang. Eng kamida:

1. Product requires_expiry.
2. PO receive expiration_date.
3. Inventory lots.
4. FEFO sale allocation.
5. Expired stock block.
6. Expiring soon report.

Bu bo'lmasa, product count umumiy to'g'ri ko'rinishi mumkin, lekin real omborda eski srok qolib ketadi, expired product sotilib ketishi mumkin, return/cost/profit ham noto'g'ri bo'ladi.

## 13. Tavsiya Qilingan Implementation Tartibi

Eng tez va xavfsiz yo'l:

1. `purchaseOrdersApi.send/cancel` idempotency header fix.
2. Duplicate backend cancel route remove.
3. Purchase order tests.
4. Product stock update restriction.
5. Opening balance/manual adjust UX.
6. Sale discount allocation and return refund tests.
7. Sale item cost snapshot.
8. UOM decimal receive fix.
9. If needed: expiry/batch MVP.

Bu tartib bilan avval hozirgi broken workflowlar yopiladi, keyin hisob-kitob va audit to'g'rilanadi, oxirida srok productga o'tiladi.

