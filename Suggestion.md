# Sellary loyihasi bo'yicha MVP tavsiya hisoboti

Sana: 2026-03-17

## Qisqa xulosa

Mening bahom:

- Retail POS MVP sifatida: `6.5/10`
- Restaurant MVP sifatida: `3/10`
- Offline-first MVP sifatida: `2.5/10`

Asosiy tavsiya:

Bu loyihani hozircha **bitta yo'nalishga** olib kirish kerak. Kod bazaga qarab eng pishgan yo'nalish bu:

**1 do'konlik retail POS + inventory + supplier + basic reports**

Shu sabab men MVP uchun aynan mana shu scope'ni tavsiya qilaman. Restaurant va offline-sync qismlarini hozircha chetga chiqarish kerak.

## Loyiha bo'yicha umumiy baho

Kuchli tomonlari:

- Backendda asosiy retail modullar bor: auth, products, sales, inventory, suppliers, purchase orders, reports.
- Frontendda ham shu modullar uchun sahifalar tayyor.
- Sales, returns va purchase order tarafda idempotency ishlatilgan, bu yaxshi belgi.
- Dashboard, sales history, products, purchase order qismi MVP uchun kerakli bazani beradi.

Zaif tomonlari:

- Loyiha scope'i chalkash: retail POS, restaurant va offline/PWA bir joyga qo'shilgan.
- Restaurant qismi haqiqiy backend flow emas, ko'proq local-state demo ko'rinishida.
- Offline sync arxitekturasi xavfli va release uchun hali tayyor emas.
- Ba'zi joylarda demo/logik tavakkallar bor.
- Testlarni ishonchli ishga tushirish ham hozircha silliq emas.

## MVP uchun to'g'ri yo'nalish

Menimcha MVP quyidagicha bo'lishi kerak:

**Sellary = kichik do'kon uchun sodda POS va ombor nazorati**

Ya'ni MVP savolga javob berishi kerak:

1. Kassir tez sotuv qila oladimi?
2. Ombordagi qoldiq to'g'ri kamayadimi?
3. Tovar qo'shish va narxni boshqarish osonmi?
4. Yetkazib beruvchidan kelgan mahsulotni qabul qilish mumkinmi?
5. Egasi kunlik savdo va foydani ko'ra oladimi?

Shu 5 ta savolga yaxshi javob bera olsa, MVP yaxshi bo'ladi.

## MVP da juda yaxshi ishlashi shart bo'lgan narsalar

### 1. Login va rol

Ishlashi kerak:

- Login
- Logout
- Admin / manager / cashier rol ajratish
- Sessiya yo'qolsa qayta login qilish

Nega muhim:

Kassaga kim kirgani va kim amal qilayotgani aniq bo'lishi kerak.

### 2. Product katalog

Ishlashi kerak:

- Mahsulot qo'shish
- Mahsulot tahrirlash
- Barcode bo'yicha topish
- Search
- Stock quantity
- Min stock level

Nega muhim:

POS ishlashi uchun product katalog eng toza modul bo'lishi kerak.

### 3. POS sotuv oqimi

Ideal MVP flow:

1. Mahsulot qidiriladi yoki barcode bilan topiladi
2. Savatga qo'shiladi
3. Miqdor o'zgartiriladi
4. To'lov turi tanlanadi
5. Sotuv yakunlanadi
6. Stock avtomatik kamayadi
7. Sale history'da ko'rinadi

Bu modul eng silliq modul bo'lishi kerak. Agar bitta joyga eng ko'p e'tibor bersak, shu yerga beramiz.

### 4. Inventory nazorat

Ishlashi kerak:

- Sotuvdan keyin stock kamayishi
- Purchase order receive qilinganda stock ko'payishi
- Manual adjust
- Low stock ko'rinishi

Nega muhim:

POS tizimda eng tez buziladigan narsa pul emas, stock haqiqatdan uzilib ketishi.

### 5. Supplier + purchase order qismi

Ishlashi kerak:

- Supplier yaratish
- Purchase order draft
- Send
- Receive
- Partial receive yoki to'liq receive

Bu retail MVP uchun foydali, chunki ombor oqimini tartibga soladi.

### 6. Basic hisobotlar

MVP uchun qoldirish mumkin:

- Dashboard
- Kunlik savdo summasi
- Kunlik transaction soni
- Low stock ro'yxati
- Eng ko'p sotilgan mahsulotlar

Lekin bu hisobotlar "advanced BI" bo'lishi shart emas. Tez va ishonchli bo'lsa bo'ldi.

## Hozircha disable qilishni tavsiya qilaman

### 1. Restaurant modulini to'liq yashirish

Sabab:

- Frontendda restaurant alohida navigatsiyada turibdi.
- Restaurant store local persist bilan ishlayapti.
- `completePayment` ichida backendga yozish yo'q, izohning o'zida `TODO: Save to backend` deb turibdi.
- Demak bu production flow emas.

Tavsiya:

- Sidebar'dan `Restaurant` ni olib tashlash
- `restaurant/*` route'larni MVP build'da yashirish
- Restaurantni alohida phase-2 ga chiqarish

### 2. Offline sync / auto-sync / PWA murakkab qismlarini disable qilish

Sabab:

- Server health check hardcoded `http://localhost:8000/`
- Queue ichida `url: '/api/sales'` saqlanyapti
- Sync paytida `fetch(item.url)` ishlayapti, ya'ni environment/proxy noto'g'ri bo'lsa backendga emas, frontend origin'ga urilishi mumkin
- Bu qism data loss yoki duplicate flow xavfini oshiradi

Tavsiya:

- Hozircha offline queue UI'ni yashirish
- Auto sync'ni o'chirish
- Service worker/PWA marketingini MVP da ishlatmaslik
- Birinchi release'ni online-only qiling

### 3. Multi-session POS ni soddalashtirish

Hozir POS ichida bir nechta chek session'lari bor. Bu foydali bo'lishi mumkin, lekin MVP uchun kassirni chalg'itadi.

Tavsiya:

- Birinchi MVP da bitta aktiv savat qoldirish
- `Yangi chek` session tugmasini vaqtincha disable qilish

### 4. Advanced reports ni kesish

Tavsiya:

- Dashboard qolsin
- Sales report qolsin
- Profit va top-products tablari qolishi mumkin, lekin ular critical emas
- Agar vaqt siqsa, bitta dashboard sahifaga qisqartiring

### 5. Currency va advanced settings ni minimal qilish

Tavsiya:

- Bitta asosiy valyuta bilan chiqing
- Sync controls va murakkab settings'larni hozircha ko'rsatmaslik mumkin

## MVP da hozircha qilmaslik kerak bo'lgan narsalar

Quyidagilarni qo'shmaslik kerak:

- Multi-store
- Mobile app
- Loyalty / bonus
- Discount campaign engine
- Barcode print
- Receipt print integratsiyasi
- Telegram yoki email notification
- Complex analytics
- Restaurant + retail ni bitta release'da birga sotish
- Offline-first release

Eng katta xato bo'ladi:

**Bir vaqtning o'zida 3 ta product bo'lishga urinish: retail POS + restaurant POS + offline POS**

Bu MVP ni cho'zadi, sifatini tushiradi va pilotni yiqitadi.

## Juda muhim texnik risklar

### 1. Stock negative ketishi mumkin

Backendda `sale_service.py` ichida `Allow overselling for demo purposes` degan joy bor. Bu production uchun yaramaydi.

Nima qilish kerak:

- Stock yetmasa sotuvni bloklash
- Kassada aniq error ko'rsatish
- Race condition bo'lsa ham stock manfiy bo'lmasligi kerak

Bu MVP release oldidan yopilishi shart bo'lgan issue.

### 2. Backend import paytida DB ga ulanib ketmoqda

`main.py` ichida `Base.metadata.create_all(bind=engine)` bor.

Muammo:

- App import bo'lishi bilan DB ga ulanadi
- Testlar environment bo'lmasa yiqiladi
- Migration intizomi buziladi

Tavsiya:

- Productionda faqat Alembic bilan schema boshqarish
- `create_all` ni app import'dan olib tashlash

### 3. Environment qattiq hardcoded

Ko'rilgan signal:

- Health check URL `http://localhost:8000/`
- API default ham localhost

Tavsiya:

- Barcha backend URL'larni env orqali boshqarish
- Frontend va sync logikada bitta source of truth bo'lsin

### 4. Restaurant qismi haqiqiy transactional flow emas

Restaurant local storage'da yashayapti. To'lov yakunlanganda real sale yaratish to'liq yopilmagan.

Bu shuni anglatadi:

- UI chiroyli bo'lishi mumkin
- Lekin biznes natija yo'qolishi mumkin

Shuning uchun bu qism MVP da bo'lmasligi kerak.

### 5. Kod bazada duplicate layer'lar bor

Ko'rinib turibdi:

- `src/api.ts` va `src/lib/api.ts`
- `src/store/*` va `src/lib/store.ts`

Bu chalkashlik keltiradi. Hozircha katta refactor shart emas, lekin MVP oldidan bitta canonical layer tanlab olish kerak.

### 6. Til masalasi

Frontend matnlarining katta qismi ruscha. Agar target foydalanuvchi o'zbek tilida ishlasa:

- POS
- Products
- Sales
- Purchase orders

kamida shu ekranlar o'zbekcha bo'lishi kerak.

MVP uchun full i18n shart emas, lekin asosiy ekranlar bitta aniq tilda bo'lishi kerak.

## Product qarori: nimani qoldiramiz, nimani kesamiz

### Qoldiramiz

- Login
- POS
- Products
- Sales history
- Supplier
- Purchase orders
- Inventory adjust
- Dashboard

### Ehtiyotkorlik bilan qoldiramiz

- Return/refund
- Profit report
- Top products report

### Hozircha kesamiz

- Restaurant
- Offline sync
- Auto sync controls
- Multi-session POS
- Advanced settings
- Har qanday "demo" flow

## 2 bosqichli amaliy reja

### Bosqich 1: MVP stabilizatsiya

Birinchi navbatda:

1. Retail scope'ni freeze qilish
2. Restaurant navigation va route'larni yashirish
3. Offline sync'ni disable qilish
4. Oversell'ni bloklash
5. `create_all` ni olib tashlash
6. Env konfiguratsiyani tozalash
7. POS -> sale -> stock -> history flow ni qo'l bilan test qilish

Natija:

- Soddaroq, aniqroq, boshqariladigan product paydo bo'ladi

### Bosqich 2: Pilot release tayyorlash

Keyin:

1. O'zbekcha matnlarni tozalash
2. Demo data yoki seed data tayyorlash
3. Manager uchun oddiy foydalanish qo'llanmasi yozish
4. Backup strategiya qilish
5. Pilot mijoz bilan real test

Natija:

- Foydalanuvchi tushunadigan va ishlatadigan versiya chiqadi

## Menimcha eng to'g'ri MVP paketi

Quyidagi paket bilan chiqish eng sog'lom:

**Sellary Retail MVP**

Ichida:

- 1 do'kon
- 1 valuta
- Login
- Mahsulotlar
- POS sotuv
- Ombor qoldiq
- Supplier
- Zakupka qabul qilish
- Basic dashboard

Tashqarida:

- Restaurant
- Offline mode
- Advanced automation
- Complex analytics

## Verification holati

Men lokal verification urindim va quyidagi signal chiqdi:

- Frontend test ishga tushganda `vitest` config yuklashda `spawn EPERM` xatosi berdi
- Backend test ishga tushganda app import paytida DB connection ochilib, `sellary_db` mavjud emasligi sabab yiqildi

Bu nimani anglatadi:

- Kod bazada ishlaydigan qismlar bor
- Lekin release oldidan environment va startup intizomini tozalash shart

## Yakuniy tavsiya

MVP ni tez va to'g'ri chiqarish uchun:

**Retail POS'ni bitta aniq product sifatida chiqaring.**

Hozir eng to'g'ri qaror:

- restaurant'ni kesish
- offline'ni kesish
- stock correctness'ni mustahkamlash
- POS flow'ni juda silliq qilish
- supplier/purchase qismni qoldirish
- dashboard'ni basic ushlab turish

Shu yo'l bilan product tezroq chiqadi, kamroq buziladi va pilotda ishonch uyg'otadi.
