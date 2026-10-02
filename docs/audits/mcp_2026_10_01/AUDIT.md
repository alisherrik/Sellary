# Sellary MCP imkoniyatlari va xatolari auditi

**Tuzatish bosqichi:** quyidagi tahlil boshlang‘ich holatning tarixiy qaydidir.
Tekshirilgan asosiy kod xatolari tuzatildi va vositalar 17 tadan 33 taga kengaytirildi.
Amaldagi holat, test dalillari va saqlanadigan cheklovlar
[tuzatish hisobotida](D:/Learning/Sellary/docs/audits/mcp_2026_10_01/IMPLEMENTATION.md).
Quyidagi eski satr raqamlari va nosozlikni assert qiladigan probes boshlang‘ich kodga tegishli.

2026 yil 1 oktabr. Tekshiruv mahalliy kod, amaldagi tool schemalari va izolyatsiyalangan testlarga asoslangan. Sellary MCP hozir 17 ta vositani ochadi: 3 ta katalog, 12 ta hisobot va 2 ta xarid vositasi. Backendda mavjud ko‘plab o‘qish imkoniyatlari MCPga chiqarilmagan. Bundan tashqari, huquqlar, xarid tranzaksiyasi va hisobot aniqligida takrorlangan xatolar bor.

Eng avval OAuth token chegarasi va xarid atomarligini tuzatish kerak. Keyin hisoblarning to‘g‘riligi, sahifalangan katalog va hujjat tafsilotlari ochiladi. Faqat limit sonini oshirish barcha mahsulotlar yoki tarixga kirishni hal qilmaydi.

## Tekshiruv dalillari

- Mavjud MCP testlaridan tanlangan 6 fayl: **105 passed**. Bu butun backend test to‘plami natijasi emas.
- Ushbu audit uchun yozilgan diagnostika: **15 passed**. Ular hozirgi nosoz xatti-harakatlarni tasdiqlaydi; xatolar tuzatilganini bildirmaydi. Bir test ikki bog‘liq hisobot xatosini ko‘rsatadi.
- Runtime: FastMCP **3.4.4**, MCP Python SDK **1.28.1**, ro‘yxatdan o‘tgan **17 vosita**.
- [Diagnostika kodi](D:/Learning/Sellary/docs/audits/mcp_2026_10_01/probes.py), [oxirgi natija](D:/Learning/Sellary/docs/audits/mcp_2026_10_01/probe-results.txt).
- Production bazasi, production loglari, real Claude/ChatGPT sessiyasi va yuklama tekshirilmagan. Quyidagi misollar real do‘kon ma’lumotlari haqida da’vo emas, testlarda qayta hosil qilingan holatlardir.
- Auditning boshlang‘ich bosqichida backend kodi o‘zgartirilmadi; keyingi tuzatishlar alohida qayd etilgan.

Mavjud MCP testlari vositalarni asosan oddiy Python funksiyasi sifatida chaqiradi. Xarid testlaridagi `_SharedSession.commit()` haqiqiy commit o‘rniga flush qiladi. Shu sababli qisman saqlanib qolish va transport muammolarining ayrimlari mavjud testlardan o‘tib ketadi.

## Foydalanuvchi so‘rovlari qayerda to‘xtaydi

| So‘rov | Hozirgi MCP | Backenddagi tayanch va kerakli o‘qish vositasi |
|---|---|---|
| Barcha mahsulotlarni ko‘rsat | Faqat `search_products`, maksimum 50; davom ettirish yo‘q | `ProductService.get_all`: sahifalangan `list_products`, kategoriya va qoldiq filtrlari |
| Bitta mahsulotning kartasi, kelgan va sotilgan miqdori | Qisqa katalog qatori; batafsil karta yo‘q | `ProductService.get_by_id`, `get_all(with_totals=True)`: `get_product` |
| Mahsulot harakati va tarixini tushuntir | Vosita yo‘q | `InventoryService.get_logs`: `list_stock_movements`, manba hujjati turi va ID bilan |
| Chekni top, mahsulotlari va to‘lovlarini ko‘rsat | Faqat umumiy hisobot; `get_dashboard`dagi oxirgi 10 chek qisqa ma’lumot beradi | `SaleService.get_all/get_by_id`: `list_sales`, `get_sale`, qaytarish tafsilotlari |
| Kassir, mijoz, to‘lov yoki chek bo‘yicha sotuvlarni ajrat | MCP sales summary faqat davrni qabul qiladi | Sales servisida bu filtrlarning ko‘pi bor; MCPga moslarini chiqarish kerak |
| Sverka sanalari, izohi va aniqlangan tafovutlar | Faqat davr javobidagi `reconciled_from`; tarix va checker yo‘q | `ReconciliationService.latest/history/check`: holat, tarix, alohida ruxsat bilan tekshiruv |
| Mijoz qarzi va qarz yopilish tarixi | Vosita yo‘q | `CustomerLedgerService.get_customer_ledger`: mijozlar va ledger o‘qish vositalari |
| Pulning kirim, chiqim va transfer tarixi | Faqat hozirgi hisoblar balansi | `MoneyService.history`: sahifalangan operatsiyalar |
| Eski xarid yoki kirim hujjatini och | Aggregatlar va yetib kelmagan buyurtmalar bor; yakunlangan hujjat tafsiloti yo‘q | `PurchaseOrderService.get_all/get_by_id`: xarid ro‘yxati va hujjat tafsiloti |
| Spisanie yoki yetkazib beruvchiga qaytarishni ko‘rsat | Vosita yo‘q | `StockWriteOffService`: hujjat ro‘yxati, tafsiloti va tannarxi |

Tayanchlar: [katalog vositalari](D:/Learning/Sellary/sellary-backend/mcp_server/tools_catalog.py:31), [hisobot vositalari](D:/Learning/Sellary/sellary-backend/mcp_server/tools_reports.py:54), [sales API](D:/Learning/Sellary/sellary-backend/api/sales.py:99), [inventory API](D:/Learning/Sellary/sellary-backend/api/inventory.py:132), [sverka API](D:/Learning/Sellary/sellary-backend/api/reconciliation.py:19), [mijoz ledgeri](D:/Learning/Sellary/sellary-backend/services/customer_ledger_service.py:32), [pul tarixi](D:/Learning/Sellary/sellary-backend/services/money_service.py:346).

Bu jadvaldagi yangi vositalar — tavsiya, ular hozir mavjud emas. Ayrim servislar ham sana, pagination yoki kerakli hujjat bog‘lanishlarini kengaytirishni talab qiladi.

## Birinchi navbatdagi xatolar

### 1 OAuth tokenining berilgan huquqlari REST orqali kengayadi

**P1, xavfsizlik, HTTP test bilan tasdiqlandi.** MCP JWT oddiy `token_type=access` bilan chiqariladi. REST autentifikatsiyasi `mcp`, OAuth scopes va `ai` cheklovlarini tekshirmaydi. Hisobot uchun berilgan token foydalanuvchining RESTdagi kengroq ruxsatlarini oladi.

Testda faqat reports scope bilan, kompaniya `ai` moduli o‘chirilgan bo‘lsa ham, `POST /api/auth/refresh` **200** qaytardi. Yangi web tokenda `mcp` va `scopes` yo‘q. `POST /api/auth/switch-company` esa foydalanuvchining boshqa a’zoligi uchun oddiy token berdi. Ikkinchi kompaniya foydalanuvchiga tegishli bo‘lishi shart; bu begona kompaniyaga a’zoliksiz kirish ekanligi tasdiqlanmagan. Ammo OAuthda faqat bitta kompaniya uchun berilgan rozilik chegarasi buziladi.

Natija: MCPdagi o‘qish cheklovi, purchase preview talabi va connectorni o‘chirish boshqaruvi REST orqali chetlab o‘tilishi mumkin. Tokenni ushlab turgan klient yoki kod uchun bu imkoniyat ochiq; LLM o‘zi avtomatik shunday qiladi degan da’vo emas.

Manbalar: [REST token tekshiruvi](D:/Learning/Sellary/sellary-backend/api/dependencies.py:66), [switch va refresh](D:/Learning/Sellary/sellary-backend/api/auth.py:81), [web token qayta chiqarilishi](D:/Learning/Sellary/sellary-backend/services/auth_service.py:253), [MCP token chiqarilishi](D:/Learning/Sellary/sellary-backend/mcp_server/oauth/provider.py:251).

Tuzatish: RESTda MCP tokenlarini rad etish; MCP uchun alohida token turi va audience; session almashish yo‘llarida ham shu chegara. Rasmiy MCP avtorizatsiya spetsifikatsiyasi tokenning mo‘ljallangan resource/audience uchun tekshirilishini talab qiladi. [MCP Authorization](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization).

### 2 Xarid yakunlanmasdan commit qilinadi

**P1, hujjatlar yaxlitligi, haqiqiy commitli SQLite test bilan tasdiqlandi.** `purchase_commit` ichidan chaqirilgan `create_with_items` order va yangi mahsulotlarni darhol commit qiladi. Qabul qilish va idempotency yozuvi keyin bajariladi. Xato bo‘lsa, tashqi rollback oldingi commitni qaytara olmaydi.

Test: receipt bosqichida xato berildi; ayni draft ikki marta yuborildi. Natija: **2 ta saqlangan order, 0 ta idempotency yozuvi**. Klient xato ko‘radi, bazada esa hujjatlar qoladi. Parallel chaqirishda ham shu strukturadan kelib chiqadigan xavf bor; PostgreSQL concurrency testi o‘tkazilmadi.

Manbalar: [ichki commit](D:/Learning/Sellary/sellary-backend/repositories/purchase_order_repository.py:101), [MCP order yaratishi](D:/Learning/Sellary/sellary-backend/mcp_server/tools_purchase.py:228), [tashqi transaction](D:/Learning/Sellary/sellary-backend/mcp_server/context.py:114), [commitni flushga almashtiradigan mavjud test](D:/Learning/Sellary/sellary-backend/tests/integration/test_mcp_tools.py:43).

Tuzatish: hujjat, yangi mahsulot, receipt, FIFO va idempotency bitta tashqi tranzaksiyada; ichki repositorylar flush qiladi. Boshqa REST callerlarning transaction egasini ham tekshirish kerak. Bir xil draft uchun parallel ijroni hujjat yaratilishidan oldin to‘xtatish zarur.

### 3 Yangi mahsulotli xarid qayta yuborilsa replay ishlamaydi

**P1, test bilan tasdiqlandi.** Request hash uchun `lines`ning o‘zi olinadi. Yangi mahsulot yaratilgach, shu ro‘yxatdagi `product_id=None` haqiqiy IDga almashtiriladi. Saqlangan hash asl imzolangan draftga mos kelmay qoladi.

Test: birinchi commit muvaffaqiyatli; ayni tokenning ikkinchi commitida «boshqa parametrlar» xatosi. Bu holatda ikkinchi hujjat yaratilishi emas, xavfsiz replay javobi buzilishi tasdiqlandi. Klient yangi preview qilishga urinsa, keyingi dublikat xavfi paydo bo‘ladi.

Manbalar: [request body](D:/Learning/Sellary/sellary-backend/mcp_server/tools_purchase.py:182), [ro‘yxat mutatsiyasi](D:/Learning/Sellary/sellary-backend/mcp_server/tools_purchase.py:225), [hash saqlanishi](D:/Learning/Sellary/sellary-backend/mcp_server/tools_purchase.py:279).

Tuzatish: ijro davomida o‘zgarmaydigan asl draftni hash qilish; natijadagi yaratilgan IDlarni alohida tutish. Yangi va aralash mahsulotli replay testlari kerak.

### 4 Pul hisobining birinchi o‘qilishi oldingi tushumni tashlab ketadi

**P1, test bilan tasdiqlandi, backenddan MCPga o‘tadigan xato.** Yangi card turi aniqlanganda avtomatik hisob `opening_at=now`, `opening_balance=0` bilan yaratiladi. Balans faqat shu sanadan keyingi sotuvlarni qo‘shadi. Hisob yaratilishiga sabab bo‘lgan oldingi tenderning o‘zi hisobga kirmaydi.

Test: oldingi DC tushumi **100.00**, birinchi overviewdagi DC balansi **0.00**. Alohida haqiqiy commitli tekshiruvda keyingi o‘qish ham nol bo‘ldi. Till avvaldan mavjud bo‘lgan holatda ham yangi card hisobi uchun muammo takrorlandi. MCP `get_money_accounts` o‘qish vositasi ushbu hisoblarni yaratadi va `mcp_session` ularni commit qiladi.

Manbalar: [avtomatik hisob](D:/Learning/Sellary/sellary-backend/services/money_service.py:119), [opening_at defaulti](D:/Learning/Sellary/sellary-backend/models/money_account.py:110), [sotuv sanasi filtri](D:/Learning/Sellary/sellary-backend/repositories/money_repository.py:217), [overview](D:/Learning/Sellary/sellary-backend/services/money_service.py:169).

Tuzatish: avtomatik tizim hisoblariga tegishli tarixiy boshlanish nuqtasi berish; qo‘lda kiritilgan opening balance sanalarini saqlash. Oldin yaratilgan noto‘g‘ri avtomatik hisoblarni alohida aniqlash va mustaqil manba bilan solishtirib tiklash kerak.

### 5 Shtrixkodsiz normal mahsulot dashboardni yiqitadi

**P1, test bilan tasdiqlandi, backenddan MCPga o‘tadigan xato.** Mahsulot modeli `barcode=None`ga ruxsat beradi. `LowStockItem` esa majburiy string talab qiladi. Birinchi 10 ta kam qolgan mahsulot ichida shtrixkodsiz tovar bo‘lsa, dashboard yig‘ilishi `ValidationError` bilan to‘xtaydi.

Manbalar: [mahsulot modeli](D:/Learning/Sellary/sellary-backend/models/product.py:29), [report schema](D:/Learning/Sellary/sellary-backend/schemas/report.py:77), [dashboard yig‘ilishi](D:/Learning/Sellary/sellary-backend/services/report_service.py:129).

Tuzatish: nullable barcode contractini hisobotlarda ham saqlash; shu holatni top-products schemalari uchun ham tekshirish.

### 6 OAuth login urinish limiti eski transaction bilan chetlab o‘tiladi

**P1, HTTP test bilan tasdiqlandi.** Urinishlar soni faqat klientga qaytarilgan yangi imzolangan transactionda oshiriladi. Asl `attempts=0` transaction qayta yuborilganda server eski holatni yana qabul qiladi.

Test: asl transaction bilan **7 ta noto‘g‘ri loginning hammasi 401**; limitga yetganda kutilgan 429 kelmadi. Yangi flow ochish ham ommaga ochiq.

Manbalar: [login ishlovi](D:/Learning/Sellary/sellary-backend/mcp_server/oauth/routes.py:95), [urinish counteri](D:/Learning/Sellary/sellary-backend/mcp_server/oauth/transaction.py:95).

Tuzatish: account/IP bo‘yicha serverdagi throttle; transaction urinishlarini serverda hisoblash. Parol tekshirilishidan oldin limit tekshiriladi.

## Sana va natija to‘liqligi

### 7 Sverka eski davrni teskari oralig‘iga aylantiradi

**P2, test bilan tasdiqlandi.** Named period boshlanishi sverka sanasiga ko‘tariladi, oxiri o‘zgarmaydi. 1 oktabrda `effective_from=2026-10-01`, `period=yesterday` so‘rovi **start=2026-10-01, end=2026-09-30** beradi. SQL bo‘sh natija qaytarishi mumkin; bu tarix o‘chirildi degan ma’noni bermaydi.

Manba: [davr resolveri](D:/Learning/Sellary/sellary-backend/mcp_server/periods.py:138).

Tuzatish: named tarixiy davr siyosatini aniq belgilash; hech qachon teskari oralig‘ini bajariladigan so‘rovga aylantirmaslik. Hozirgi vaqtinchalik yo‘l: **`period=custom`** bilan ikkala sanani yuborish — u sverka flooriga kesilmaydi.

### 8 Aniq sanalar custom tanlanmasa e’tiborsiz qoladi

**P2, test bilan tasdiqlandi.** `get_sales_summary(start_date='2026-01-01', end_date='2026-01-31')`da period default `today` qoladi; resolver berilgan sanalar o‘rniga bugunni tanlaydi. `PERIOD_ARG_DOC` yozilgan, ammo schema/descriptionga ulanmagan.

Manbalar: [sales tool defaulti](D:/Learning/Sellary/sellary-backend/mcp_server/tools_reports.py:54), [resolver](D:/Learning/Sellary/sellary-backend/mcp_server/periods.py:122), [ishlatilmagan izoh](D:/Learning/Sellary/sellary-backend/mcp_server/tools_reports.py:25).

Tuzatish: aniq sanalar berilganda avtomatik custom tanlash yoki mos kelmagan parametrlarni tushunarli xato bilan rad etish; `Literal`/enum va ISO date schema. `_parse_date` hozir matnning faqat birinchi 10 belgisini oladi — qisman noto‘g‘ri sanalar ham yutilishi mumkin.

### 9 Ro‘yxatlar kesilganini klient ishonchli bilolmaydi

**P1 imkoniyat bo‘shlig‘i, P2 noto‘g‘ri xulosa xavfi.** Testda **55 mahsulotdan 50** qaytdi, `count=50`, lekin `total`, `has_more`, offset yoki cursor yo‘q. Qidiruvni bo‘lib chiqish orqali to‘liq katalog olinganiga kafolat berib bo‘lmaydi.

| Vosita | Hozirgi limit | Muammo |
|---|---|---|
| `search_products` | default 15, max 50 | total va davom ettirish yo‘q |
| `list_suppliers` | default 50, max 200 | total bor, keyingi sahifa yo‘q |
| `get_top_products` | default 10, max 50 | faqat miqdor reytingi; foyda reytingi va product filtri yo‘q |
| `get_purchases_by_product` | default 50, max 500 | davom ettirish va kesilish belgisi yo‘q |
| `list_shifts` | default 20, max 100 | `total_discrepancy` faqat qaytgan sahifadagi smenalardan yig‘iladi |
| `get_low_stock` | cheklanmagan | katta javob va klient context/token chegarasiga urilish xavfi |
| `get_outstanding_orders` | cheklanmagan | katta javob va tarixni davom ettirish boshqaruvi yo‘q |

`list_shifts` period jami sifatida o‘qilsa, limitdan oldingi kamomadlar yo‘qoladi. Mahsulot va supplier repository ro‘yxatlarida barqaror `ORDER BY` ham yo‘q.

Manbalar: [catalog limits](D:/Learning/Sellary/sellary-backend/mcp_server/tools_catalog.py:39), [purchases limit](D:/Learning/Sellary/sellary-backend/mcp_server/tools_reports.py:186), [smena jami](D:/Learning/Sellary/sellary-backend/mcp_server/tools_reports.py:258), [product ro‘yxati](D:/Learning/Sellary/sellary-backend/repositories/product_repository.py:80).

Tuzatish: barqaror tartib, bounded sahifalar, total/has_more/next_cursor. Global jami paginationdan mustaqil hisoblanadi. Limitlarni schemada oshkora ko‘rsatish; jim clamp o‘rniga bajarilgan limitni javobda bildirish. Cheklanmagan javoblarni ham sahifalash kerak.

## Hisobot hisobidagi xatolar

### 10 FIFO tannarxi qayta yaxlitlangan o‘rtacha narxdan hisoblanadi

**P2, test bilan tasdiqlandi.** Sotuvda aniq `cost_total_at_sale` saqlanadi, lekin profit va top-products qolgan miqdorni yaxlitlangan `unit_cost_at_sale`ga ko‘paytiradi. Test: aniq tannarx **40.00**, 3 dona uchun saqlangan unit cost **13.33**, report cost **39.99**, foyda esa 0.01 ortiq.

Qisman qaytarishda qaytgan FIFO qatlamining narxi o‘rtacha narxdan farq qilishi mumkin; qolgan tannarxni faqat o‘rtacha orqali tiklashning strukturaviy xavfi ham bor.

Manbalar: [aniq cost saqlanishi](D:/Learning/Sellary/sellary-backend/services/sale_service.py:400), [report cost](D:/Learning/Sellary/sellary-backend/services/report_service.py:369), [top-products cost](D:/Learning/Sellary/sellary-backend/services/report_service.py:298).

Tuzatish: to‘liq sotuv uchun frozen aniq cost; qaytarilgan qism uchun allocation/release ma’lumoti. Legacy va offline shortfall uchun aniq belgilangan fallback. Mustaqil cost manbasi bilan tekshirish kerak.

### 11 Kunlik foyda doim nol

**P2, test bilan tasdiqlandi.** Davr foydasi hisoblanadi, kunlik `data[].total_profit` esa hardcoded nol. Testda davr foydasi **20.01**, yagona kun foydasi **0.00**.

Manba: [kunlik report](D:/Learning/Sellary/sellary-backend/services/report_service.py:189).

Tuzatish: foydani kun bo‘yicha ham hisoblash yoki hisoblanmagan qiymatni null/yo‘q field bilan belgilash; nol ma’lumot sifatida berilmaydi.

### 12 Top mahsulot foydasi chegirmani hisobga olmaydi

**P2, test bilan tasdiqlandi.** Top-products revenue uchun `SaleItem.subtotal` olinadi. Test: subtotal **100**, chegirma **50**, haqiqiy total **50**, cost **40**. Umumiy profit report **10.00**, ayni mahsulot top-reporti **60.00** qaytardi. Tax qo‘shilgan total bilan subtotal o‘rtasida ham shu semantik farq mavjud.

Manba: [top-products revenue](D:/Learning/Sellary/sellary-backend/services/report_service.py:290).

Tuzatish: line-level samarali revenue va sale-level chegirma/qaytarish taqsimotini umumiy report bilan bir xil qoidaga keltirish.

### 13 Xarid unit narxlari ikki kasrgacha qisqaradi

**P2, serialization test bilan tasdiqlandi.** `average_cost`, `first_cost`, `last_cost`, `min_cost`, `max_cost` unit-price ro‘yxatiga tushmaydi. **1.2345 → '1.23'**; `current_cost_price` esa to‘rt kasrni saqlaydi.

Manba: [serialization](D:/Learning/Sellary/sellary-backend/mcp_server/serialization.py:25).

Tuzatish: field nomi bo‘yicha taxmin o‘rniga typed response contract yoki aniq scale mapping; pul 2, miqdor 3, unit price 4 kasr.

### 14 Hisobot izohi gross va netni adashtiradi

**P2, kodda tasdiqlangan semantik muammo.** Sales tool izohi qaytarishlar allaqachon ayrilgani haqida aytadi. Javobdagi `turnover`, `average_check` va tender buckets gross; alohida `net_turnover` bor. Klient birinchi summani «sof tushum» deb aytishi mumkin.

Xarid supplier reporti «kimga qancha to‘landi» deydi, servis esa qabul qilingan mahsulot qiymatini ko‘rsatadi. Tizimda bu supplierga to‘langan pul yoki supplier balance ekanini tasdiqlovchi ledger yo‘q. Shunday ledger ixtiro qilinmasligi kerak.

Qaytarishlar ko‘p hisobotlarda original sale sanasiga bog‘lanadi. Bu o‘sha davr sotuvlarining hozirgi net holati; davr ichida real amalga oshgan refund/cash-flow sifatida talqin qilish noto‘g‘ri bo‘lishi mumkin.

Manbalar: [sales description](D:/Learning/Sellary/sellary-backend/mcp_server/tools_reports.py:61), [gross/net fieldlar](D:/Learning/Sellary/sellary-backend/services/sale_service.py:176), [supplier description](D:/Learning/Sellary/sellary-backend/mcp_server/tools_reports.py:160), [sale refund bog‘lanishi](D:/Learning/Sellary/sellary-backend/repositories/sale_repository.py:51).

Tuzatish: field ma’nosini, qaytarishning sana asosini va gross/net farqini tool izohi hamda response schemada oshkora berish. Turnover, received goods cost, cash tushumi va qarz yopilishi alohida ko‘rsatkichlar.

## Sverka tekshiruviga ta’sir qiladigan xatolar

### 15 Qoldiq qatlamlari tugagan offline oversell drift bo‘lib chiqadi

**P2, FIFO va checker testi bilan tasdiqlandi.** Checker salbiy qoldiqni `known` deb belgilash uchun umuman qatlam bo‘lmasligini tekshiradi. Ruxsat etilgan offline oversell mavjud qatlamlarni nolga tushiradi, ammo ularni yo‘q qilmaydi.

Test: 5 dona bor, `allow_oversell=True` orqali 8 sotildi, stock **−3**, depleted qatlamlar saqlanadi. Checker `stock_vs_layers`ni **drift** deb chiqardi. `ReconciliationService.create` drift bo‘lsa sverkani rad etadi, shu sababli qabul qilingan tarixiy fakt sverkani to‘xtatishi mumkin.

Manba: [checker oversold predikati](D:/Learning/Sellary/sellary-backend/services/consistency_service.py:89).

Tuzatish: offline oversellning haqiqiy provenansini tekshirish; depleted qatlamlarning borligini mezon qilmaslik. Salbiy qoldiqning hammasini avtomatik `known`ga aylantirish ham noto‘g‘ri. Checker ikki mustaqil qiymatni saqlaydi, o‘zi qaysi tomonni tuzatishni tanlamaydi.

### 16 Late arrivalda mahalliy timezone yo‘qotiladi

**P2, kod va vaqt chegarasi bilan tasdiqlangan; alohida end-to-end probe yozilmadi.** `floor.replace(tzinfo=None)` mahalliy yarim tunni UTCga aylantirmasdan naivlashtiradi. Dushanbeda 1 oktabr 00:00 = UTCda 30 sentabr 19:00. Kod UTCda 1 oktabr 00:00 bilan solishtiradi. Ochiq kunning birinchi 5 soatiga tegishli kech kelgan offline chek pre-freeze deb nomlanishi mumkin.

Manba: [late-arrival filter](D:/Learning/Sellary/sellary-backend/services/consistency_service.py:346).

Tuzatish: UTC instantga to‘g‘ri o‘girish; Dushanbe 00:00 chegarasining ikki tomonini Postgres va SQLiteda test qilish. Bu checker findingining tasnifi, pul summasi o‘zgargani haqidagi da’vo emas.

## Xaridni aniqlash va schemalar

### 17 Bir xil mahsulot nomlari noaniqlik sifatida chiqarilmaydi

**P2, DB-backed test bilan tasdiqlandi.** Exact-name dictionary har nomga faqat bitta mahsulotni saqlaydi. Ikki xil barcode bilan bir xil nom mavjud bo‘lsa, oldingi mahsulot ustidan yoziladi; preview `matched` qaytaradi va candidate yo‘q.

Manba: [name index](D:/Learning/Sellary/sellary-backend/mcp_server/purchase_resolve.py:181).

Tuzatish: nomdan mahsulotlar ro‘yxatiga index; exact nom bir nechtaga mos bo‘lsa ham ID yoki barcode bilan aniqlashtirish. Supplier fuzzy matchingda ham yaqin/teng moslikni jim tanlash o‘rniga candidates va explicit supplier ID kerak.

### 18 Preview commit qabul qilmaydigan ma’lumotni tasdiqlaydi

**P2, kod tekshiruvi va resolver probes bilan tasdiqlangan.** Yangi mahsulotning salbiy `sell_price`i previewda token olishi mumkin, commitdagi `ProductCreate` esa rad etadi. Noma’lum barcode-only yangi qatorda nom bo‘sh qolishi mumkin. NaN/Infinity quantization paytida `LineError` o‘rniga Decimal exceptionga olib keladi.

Manbalar: [preview resolver](D:/Learning/Sellary/sellary-backend/mcp_server/purchase_resolve.py:279), [commitda talab qilinadigan schema](D:/Learning/Sellary/sellary-backend/schemas/product.py:49).

Tuzatish: draft berilishidan oldin final schema, finite sonlar va required yangi mahsulot nomini tekshirish. Bular saqlangan 15 testga kirmagan qo‘shimcha kod/resolver tekshiruvlari.

### 19 Modelga berilayotgan schema yetarlicha aniq emas

**P2, runtime discovery bilan tasdiqlandi.** `period` va `mode` oddiy string; enum va date format yo‘q. `items` arbitrary dictlar ro‘yxati, required line fieldlar JSON schemada ko‘rsatilmagan. Output schema faqat `object, additionalProperties=true`. Tekshirilgan vositalarda `annotations=None`.

Natija: model description matnini taxmin qilib ishlatadi; kerakli parametrni o‘tkazib yuborish va ma’lumot ma’nosini noto‘g‘ri talqin qilish ehtimoli yuqori. Bu JSON Schema umuman yo‘q yoki structuredContent yo‘q degani emas — schema bor, ammo juda umumiy.

Tuzatish: Pydantic input/output modellari; davr/mode uchun enum; narx/miqdor scale; sanalar formati; limit min/max; read-only va write tool annotations. Pul birliklari, company va timezone metadata javoblarda aniq bo‘lsin. Rasmiy MCP tool spetsifikatsiyasi typed input/output contract va structured result validationni qo‘llaydi. [MCP Tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools).

## Faol ishlatishda operatsion xavflar

Quyidagilar koddan tekshirilgan qo‘shimcha topilmalar. Production yuklamasi yoki parallel Postgres tajribasi bilan o‘lchanmaganlari alohida ko‘rsatilgan.

- **OAuth event loopni band qiladi.** Async login handler ichida sync DB va bcrypt chaqiriladi. Provider ham async metodlarda sync DB ishlatadi. Sekin login/DB butun worker so‘rovlarini kechiktirishi mumkin. O‘lchangan production latency yo‘q. Tayanch: [login](D:/Learning/Sellary/sellary-backend/mcp_server/oauth/routes.py:108), [provider](D:/Learning/Sellary/sellary-backend/mcp_server/oauth/provider.py:81). Butun sync operatsiyani worker threadga ko‘chirish yoki async DB kerak.
- **Refresh rotation atomar emas.** Eski refresh token delete/commit qilinib, keyin yangi token yoziladi; authorization codedagi kabi row lock yo‘q. Parallel rotation va revoke race xavfi bor; concurrency testi bajarilmadi. Tayanch: [rotation](D:/Learning/Sellary/sellary-backend/mcp_server/oauth/store.py:300). Stable grant family, row lock va yagona transaction kerak.
- **Kutilgan OAuth xatolari 500ga aylanishi mumkin.** Provider ayrim invalid grant/disabled user holatlarida `ValueError` chiqaradi; SDK `TokenError`ni ushlaydi. Pure SDK probe exception tarqalishini ko‘rsatdi. Tayanch: [provider](D:/Learning/Sellary/sellary-backend/mcp_server/oauth/provider.py:184). `invalid_grant` contracti va muvaffaqiyatli rotationdan oldin tokenni yo‘qotmaslik kerak.
- **Secret key rotation confidential clientni fail-open qilishi mumkin.** Client secret decrypt bo‘lmasa `None` qaytadi, client record esa qoladi. O‘rnatilgan SDK truthy secret bo‘lgandagina uni solishtiradi. Dummy providerli SDK probe `client_secret_post`ni secret yo‘qligida qabul qildi. Production key rotation tekshirilmagan. Tayanch: [decrypt](D:/Learning/Sellary/sellary-backend/mcp_server/oauth/store.py:49), [client load](D:/Learning/Sellary/sellary-backend/mcp_server/oauth/store.py:124). Ciphertext bor-u decrypt bo‘lmasa clientni rad etish kerak.
- **A’zo `ai` huquqi bilan company `ai` huquqi bir xil tekshirilmaydi.** MCP context kompaniyada `ai` borligini tekshiradi, a’zoning alohida `ai` grantini talab qilmaydi. Business module huquqlari tekshiriladi. Settings API esa a’zo `ai` grantini talab qiladi. Tayanch: [context](D:/Learning/Sellary/sellary-backend/mcp_server/context.py:102), [settings](D:/Learning/Sellary/sellary-backend/api/mcp.py:18). Agar a’zoga beriladigan `ai` grant connectorga kirishni boshqarishi kerak bo‘lsa, bu siyosat barcha kirish nuqtalarida bir xil bajarilishi kerak.
- **Bir agentni revoke qilish darhol access JWTni yopmaydi.** U renewalni to‘xtatadi, mavjud token 24 soatgacha yashaydi. Bu kod/UIda oshkora hujjatlashtirilgan limit, yashirin bug emas. Tayanch: [revoke contract](D:/Learning/Sellary/sellary-backend/api/mcp.py:40). Yuqori darajali boshqaruv uchun per-client grant/session revocation kerak; company `ai` switch barcha agentlarni to‘xtatadi.
- **MCP ishlamasligi settingsda ko‘rinmaydi.** Initialization xato bo‘lsa backend MCPsiz ishlaydi; settings `enabled`ni faqat company modulidan oladi. Health umumiy healthy qaytaradi. Tayanch: [mount](D:/Learning/Sellary/sellary-backend/main.py:87), [connection status](D:/Learning/Sellary/sellary-backend/services/mcp_admin_service.py:32). MCP readiness/status va aniq reason kerak; POS ishlashini saqlash to‘g‘ri.
- **Default session holati scale qilishni cheklaydi.** `http_app(path='/')` default stateful/in-memory transportga tayangan. Ko‘p worker/replica va restartda session routing/resumption strategiyasi kerak. Production FastMCP env override ko‘rilmagan, memory/load probe bajarilmagan. Tayanch: [transport](D:/Learning/Sellary/sellary-backend/mcp_server/server.py:88). Stateless rejim mosligini real klientlarda tekshirish yoki cleanup/sticky routingni aniq sozlash kerak.
- **Tool audit va kuzatuv yetarli emas.** Purchase commit logi bor, barcha tool chaqiriqlarining grant/client, muddat, natija hajmi, error code va query davri bo‘yicha tizimli tarixi yo‘q. OAuth expired-record cleanup funksiyasi bor, repo qidiruvida chaqiruvchi topilmadi. Tayanch: [cleanup](D:/Learning/Sellary/sellary-backend/mcp_server/oauth/store.py:343). Secretsiz call audit, query count/duration metrikalari, timeout va scoped rate limit kerak.

## Qaysi cheklovlar saqlanishi kerak

Purchase preview va commit, explicit tasdiq, user/companyga bog‘langan imzolangan 15 daqiqalik draft, tenant isolation, business module huquqlari va online oversell taqiqi foydali chegaralardir. Hisobot, tarix, checker va katalogni kengaytirish uchun ularni olib tashlash shart emas.

Sotuv, qaytarish, void, sverka e’lon qilish va pul harakatini MCPdan yozish hozir so‘ralgan audit uchun zarur emas. Ularni keyinchalik ochish alohida mahsulot qarori va xavfsiz tasdiqlash contractini talab qiladi. Supplier returndan avtomatik pul/supplier ledger yaratish ham noto‘g‘ri: tovar hujjati bilan haqiqiy pul harakati alohida.

## Tuzatish ketma ketligi va qabul mezonlari

1. **Huquq va xarid yaxlitligi.** MCP JWT RESTga o‘tmaydi; reports-only token mutate/refresh/switch qila olmaydi; login replay throttle ishlaydi; receipt failure hech qanday yarim hujjat qoldirmaydi; yangi mahsulotli va parallel bir xil draft replay bitta natija beradi.
2. **Hisob aniqligi.** Yangi card hisobi oldingi tenderni ko‘rsatadi; dashboard nullable barcodeni qabul qiladi; profit/top-product/daily bir xil revenue va aniq cost manbalari bilan solishtiriladi; checker approved offline factni haqiqiy driftdan ajratadi. Derived figure tekshiruvlari mavjud `consistency_service.py` registriga qo‘shiladi.
3. **O‘qish imkoniyatlari.** Sahifalangan mahsulot va sales ro‘yxati, ID bo‘yicha details, product movement, purchase details, customer ledger, money movement, reconciliation history/findings. Har biri mavjud servis orqali, tenant va module grant bilan.
4. **Klientga tushunarli contract.** Typed schemalar, oshkora pagination, range/custom qoidasi, gross/net, unit/currency/timezone, xatoga keyingi tavsiya etilgan amal. Limitga yetganda to‘liq javob bor degan taassurot bo‘lmaydi.
5. **Faol foydalanishdagi ishonchlilik.** HTTP initialize → tools/list → tools/call → reconnect/refresh testlari; haqiqiy PostgreSQL transaction/race testlari; 10 ming mahsulotli katalogni sahifalab to‘liq olish; katta tarixda jami paginationdan mustaqil qolishi; real klient timeout/javob hajmi va revoke tajribasi.

Tavsiya etilgan pagination contracti: `items`, `returned_count`, `total_count` yoki oshkora total yo‘qligi, `has_more`, `next_cursor`, `applied_filters`, `sort`. Hujjatlar uchun tafsilotlar alohida tool orqali olinadi. Katta datasetni bitta javobga tiqish o‘rniga agregat savollari uchun serverdagi agregat hisoblar ishlatiladi.

## Diagnostikani takrorlash

PowerShellda backend ichidan:

```powershell
Set-Location D:\Learning\Sellary\sellary-backend
$env:DATABASE_URL = 'sqlite:///:memory:'
$env:SELLARY_ENV = 'development'
.\.venv\Scripts\python.exe -m pytest tests/unit/test_mcp_periods.py tests/unit/test_mcp_drafts.py tests/unit/test_mcp_purchase_resolve.py tests/integration/test_mcp_tools.py tests/integration/test_mcp_oauth_flow.py tests/integration/test_mcp_connector_admin.py -o addopts='' -q -p no:cacheprovider
.\.venv\Scripts\python.exe -m pytest ../docs/audits/mcp_2026_10_01/probes.py -c pytest.ini -o addopts='' -q -s -p no:cacheprovider
```

Audit probes hozirgi nuqsonlarni assert qiladi. Ularni tuzatishdan keyin odatiy regression testlarga kerakli xatti-harakat bilan ko‘chirish kerak. Production bazasi bilan ishga tushirish zarur emas.
