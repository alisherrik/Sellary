# Sellary MCP tuzatishlari

2026 yil 1 oktabr. Tuzatishlar mahalliy kodda tayyor. Deploy, production bazasiga
migratsiya va haqiqiy Claude/ChatGPT ulanishi bajarilmadi.

## Imkoniyatlar

MCP **17 tadan 33 ta vositaga** kengaydi. Yangi o‘qish vositalari:

- `list_products`, `get_product` — to‘liq faol katalog va mahsulot miqdorlari;
- `list_sales`, `get_sale` — cheklar, alohida tenderlar, qarz va qaytarishlar;
- `list_stock_movements` — mahsulot/chek/manba turi va davr bo‘yicha harakat;
- `list_reconciliations`, `get_reconciliation`, `check_consistency` — sverka tarixi va mustaqil tekshiruv;
- `list_customers`, `get_customer_ledger` — mijozlar, joriy qarz va operatsiyalar;
- `list_money_movements` — qo‘lda qayd etilgan kirim, chiqim, transfer va tuzatishlar;
- `list_purchase_orders`, `get_purchase_order` — xarid hujjatlari va olingan miqdorlar;
- `list_write_offs`, `get_write_off`, `get_write_off_summary` — spisanie va supplier return hujjatlari.

Ro‘yxatlarda `count`, `total`, `limit`, `offset`, `has_more`, `next_offset` bor.
`list_money_movements` aniq `total: null` qaytaradi, davom ettirish ishlaydi.
Limit sahifa hajmini boshqaradi; katalogning umumiy hajmini kesmaydi.
Top mahsulotlar, yetib kelmagan buyurtmalar, past qoldiq, xaridning mahsulot/yetkazib
beruvchi qatorlari va smenalar ham davom ettiriladi. Jami va ulushlar sahifadan
mustaqil hisoblanadi. Checker filtri/sahifasi kompaniyaning umumiy `clean` natijasini o‘zgartirmaydi.

Barcha vositalar typed input/output schema va o‘qish/yozish annotations e’lon qiladi.
Katalog, mijozlar va yetkazib beruvchilar ro‘yxati faol yozuvlarni ko‘rsatadi;
arxivdagi mahsulotni ID bo‘yicha o‘qish mumkin. Ma’lumot boshqa tenantga chiqmaydi.
Sverka tarixi manager/admin, checker faqat admin uchun. Yozish hanuz faqat
imzolangan `purchase_preview` → `purchase_commit` oqimi orqali.

## Xavfsizlik va xarid

Yangi MCP tokeni `mcp_access`, `aud` va `iss` bilan ajratilgan. Oddiy REST API
yangi hamda legacy MCP tokenlarini rad etadi; MCP tokeni REST refresh yoki
company switch orqali kengroq web sessiyaga aylanmaydi. Eski MCP tokenlari
MCPning o‘zida moslik uchun saqlangan, noto‘g‘ri audience qabul qilinmaydi.
Kompaniya/a’zo `ai` ruxsati har chaqiruvda va OAuthda tekshiriladi.

OAuth login signed transactionni qayta yuborish, yangisini chiqarish yoki IPni
almashtirish orqali hisob throttle’ini chetlab o‘tolmaydi. Sync DB/bcrypt ishlar
threadpoolga chiqarildi. Decrypt qilinmagan confidential client secret rad etiladi.
Invalid grant OAuth xatosi bo‘ladi. Refresh almashtirish bitta tranzaksiyada;
xato bo‘lsa eski grant saqlanadi. PostgreSQLda refresh va admin revoke bir xil
doimiy client qatorini qulflaydi. Ulanish ro‘yxati agentlarni takrorlamaydi,
refresh ulanishning boshlanish sanasini o‘zgartirmaydi. Settings/health server mavjudligini ko‘rsatadi.

Xarid mahsulot, buyurtma, kirim va idempotency natijasini bitta tashqi
tranzaksiyada saqlaydi. Ichki buyurtma yaratish MCP uchun commit qilmaydi;
RESTning eski default xatti-harakati saqlangan. Yangi mahsulotni bajarish vaqtida
qo‘yilgan ID imzolangan request hash’ini o‘zgartirmaydi. Replay shu hujjatni qaytaradi.
Nosoz kirim yarim hujjat yoki o‘zgargan qoldiq qoldirmaydi.

Bir xil nom va yaqin supplier nomlari jim tanlanmaydi: candidates va aniq ID
kerak. Preview yakuniy mahsulot/xarid qoidalarini tekshiradi, NaN, salbiy qiymat,
nomi yo‘q yangi barcode va 200 tadan ortiq qatorni rad etadi. Bir draft ichidagi
takroriy yangi barcode imzolanmaydi. Arxivlangan barcode qayta faollashtirilmaydi;
previewdan keyin paydo bo‘lgan barcode konflikti ham commitni xavfsiz to‘xtatadi.

## Hisoblar va tarix

- `last_month` kabi aniq tarixiy davr sverkada kesilmaydi yoki teskari intervalga aylanmaydi.
  Sana jufti berilsa `custom` avtomatik tanlanadi; yarim juft va noto‘g‘ri ISO sana rad etiladi.
- Filtrlar kompaniya mahalliy kunidan UTCga o‘giriladi. Pul va kirimlarning half-open
  filtri kunning oxirgi mikrosekundini ham qamraydi.
- Dashboard barcode `null` bo‘lgan mahsulotda ishlaydi. Past qoldiqning 10 qatori
  va umumiy soni alohida olinadi; butun katalog xotiraga yuklanmaydi.
- Tannarx frozen FIFO line cost va haqiqiy qaytarilgan qatlamlardan olinadi.
  Kunlik foyda hisoblanadi. Mahsulot tushumi yozilgan chek summasi, chegirma/soliq
  va qaytarishlarga mos keladi; split tenderlar yagona pul manbai bo‘lib qoladi.
- Xarid unit price maydonlari 4 xonali; weighted average centga yaxlitlangan
  spenddan hisoblanmaydi. `0.001 × 1.2345` ham o‘rtacha narxni yo‘qotmaydi.
- Eski yopiq smenada snapshot yo‘q bo‘lsa, faqat ochilish/yopilish oralig‘i hisoblanadi;
  bugungi kassa unga aralashtirilmaydi. Saqlangan expected cash saqlanadi.
- Yangi avtomatik pul hisoblari oldingi tenderlarni yo‘qotmaydi. Provenance bilan
  tasdiqlangan offline oversell `known`; tushuntirilmagan manfiy qoldiq `drift` bo‘lib qoladi.
  Late arrival sverka chegarasi UTC instant bilan solishtiriladi. Checker qoldiq va
  qatlam orasida g‘olib tanlamaydi.

Katalog sahifasi birliklarni bittalab so‘ramaydi: 100 mahsulotga 105 SQL so‘rovi
chiqargan holat batch load bilan yopildi. Moliyaviy cheklar 200 talik batchda,
kirimning tarixiy narxlari esa sahifadagi mahsulotlar uchun oqim bilan o‘qiladi.

## Migratsiya

[f9a0b1c2d3e4](D:/Learning/Sellary/sellary-backend/alembic/versions/20261001_1600-f9a0b1c2d3e4_reanchor_unused_system_money_accounts.py)
faqat tegilmagan avtomatik zero-opening hisobning boshlanish sanasini qaytaradi:
`opening_at == created_at`, oldingi moliyaviy hujjatlar bor, hisobda pul harakati
yo‘q, kompaniyada sverka yo‘q; kassa uchun smenalar ham bo‘lmasligi kerak.
Manual ochilish, tuzatish/transfer, sanab yopilgan kassa va sverkali kompaniya chiqarib tashlanadi.
Migratsiya balansni tanlamaydi yoki mustaqil physical countni almashtirmaydi.

Tashlab o‘tilgan tarixiy hisob mustaqil kassa/bank sanog‘i bilan tekshiriladi;
zarur bo‘lsa mavjud `/api/money/corrections` orqali adjustment yoziladi.
Ularning barcha sanalarini avtomatik o‘zgartirish ikki marta sanash xavfini yaratadi.

Ikki Railway config `f9a0b1c2d3e4`ga pin qilindi; nested config MCP fayllarini ham kuzatadi.
Repo ikkita Alembic head’ga ega, shuning uchun deploy uchun aniq revision kerak:

```powershell
Set-Location D:\Learning\Sellary\sellary-backend
.\.venv\Scripts\python.exe -m alembic upgrade f9a0b1c2d3e4
```

Bu buyruq ushbu ishda productionga bajarilmadi.

## Tekshiruv

Umumiy backend to‘plami: **1175 passed**, 74 warnings, 29.63 soniya, exit code 0.
Warninglar deprecated kutubxona/flag, mavjud test transaction rollbacki,
FastMCPning Decimal regex adapteri va atayin qisqa noto‘g‘ri JWT kaliti testiga tegishli.

Amaldagi umumiy test natijasi [backend-test-results.txt](D:/Learning/Sellary/docs/audits/mcp_2026_10_01/backend-test-results.txt)da.
Quyidagilar mustaqil tekshirildi:

- 10 003 mahsulot 200 talik sahifalarda takrorsiz/yo‘qotishsiz olindi; boshqa tenant chiqmagan.
- 31 ta o‘qish vositasi FastMCP Client orqali chaqirilib structured output schemalari tekshirildi.
- Mounted `/mcp` HTTP lifespan orqali initialize, tools/list (33), tools/call va invalid bearer 401 sinovdan o‘tdi.
- Xarid testlari haqiqiy isolated SQLite commit/rollback bilan nosoz receipt, replay va barcode konfliktlarini tekshiradi.
- Refreshning nosoz almashtirilishi va revoke interleaving regressiyalari; PostgreSQL lock yo‘li kod/dialect bilan tekshirilgan.
- Compileall: API, core, models, repositories, schemas, services, MCP, main va migratsiyalar.
- Module parity: 9 modul mos; migration pin: yangi revision head; diff whitespace tekshiruvi toza.

Takrorlash uchun backend ichida:

```powershell
$env:DATABASE_URL = 'sqlite:///:memory:'
$env:SELLARY_ENV = 'test'
.\.venv\Scripts\python.exe -m pytest tests/integration tests/unit -q --no-cov -p no:cacheprovider
.\.venv\Scripts\python.exe -m compileall -q api core models repositories schemas services mcp_server main.py alembic/versions
```

Eski `probes.py` tarixiy nosozliklarni assert qiladi; amaldagi regressiya to‘plami sifatida ishlatilmaydi.

## Qoladigan chegaralar

- Productionga chiqarish va migratsiya qilish alohida qadam. Real PostgreSQL
  parallel transaction/lock va haqiqiy Claude/ChatGPT sessiyasi/yuklamasi bu muhitda sinov qilinmadi.
- Alohida agent revoke’i refreshni to‘xtatadi; allaqachon berilgan JWT default
  24 soatgacha yashaydi. Kompaniya/a’zo `ai` o‘chirilishi har chaqiruvda darhol tekshiriladi.
- Login limiter process-local, transport stateful. Multi-worker/replica uchun
  umumiy limiter va session routing/stateless rejim klient bilan tekshirilishi kerak.
- OAuth expired-record cleanup hali avtomatik rejalashtirilmagan; barcha tool
  chaqiruvlari uchun markaziy timing/audit/timeout monitoring ushbu patchga kirmaydi.
- Juda uzun davrdagi kunlik aggregatlar va yakka hujjatning satrlari tabiiy hajmini
  saqlaydi; real klient context/timeout chegarasi production o‘lchovi bilan baholanadi.
- MCPdan tashqari mavjud REST sale contractida faqat item discount berib,
  sale discountni bermaslikka oid nomuvofiqlik alohida ko‘rib chiqilishi kerak.
  MCP hisobotlari amalda yozilgan chek va qaytarish summalariga bog‘langan.

Userning avvalgi `.claude/settings.local.json` va frontend `tsconfig.tsbuildinfo`
o‘zgarishlari saqlandi va MCP commitlariga kiritilmaydi.

## Production bilan birlashtirish — 2026-10-02

Deploy oldidan remote `main` mahalliy boshlang‘ich koddan 45 commit oldinda
ekani aniqlandi. `679da08` dagi mavjud o‘zgarishlar saqlanib, MCP tuzatishlari
ularga birlashtirildi. Yakuniy connector 44 tool: mavjud nomlar va yangi
sahifalangan o‘qishlar birga ishlaydi; hammasi typed output va annotations bilan.

Mavjud `sellary:records` rozilik chegarasi saqlandi: reports-only token individual
chek, qarz tarixi, harakat, xarid/spisanie hujjati va checker findings o‘qiy olmaydi.
Katalog va yig‘ma hisobotlar `sellary:reports` bilan o‘qiladi.

Yopilgan davr hisobotlari UTC query instants va purchase exclusive-end chegarasiga
moslandi. Ombor baholashidagi miqdor/mahsulotlar soni birinchi 100 qator bilan
cheklanmaydi, kompaniya bo‘yicha SQL aggregate ishlatadi. Eski tool aliases shu
o‘qishlarning sahifalangan kontraktlariga ulanadi.

Production bazasida faqat o‘qish orqali `3de347509835` revision va `opening_notes`
ustuni tasdiqlandi. Yangi migratsiya parent shu revisionga moslandi:
`e8f9a0b1c2d3 → 3de347509835 → f9a0b1c2d3e4`.
Yakuniy release dalillari `DEPLOYMENT.md` da yoziladi.
