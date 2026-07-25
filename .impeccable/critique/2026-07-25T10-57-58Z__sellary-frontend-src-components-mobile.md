---
target: sellary-frontend/src/components/mobile (module-first mobile shell)
total_score: 12
max_score: 40
na_heuristics: 
p0_count: 2
p1_count: 2
timestamp: 2026-07-25T10-57-58Z
slug: sellary-frontend-src-components-mobile
---
Method: dual-agent (A: afb93661376003686 · B: a8af48726f50661f4)

Target: `sellary-frontend/src/components/mobile/` (module-first mobile shell) + `/apps`, `/pos` mobil tarmoqlari. Rejim: **Operate**.

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 1 | `/shifts`, `/orders` `headerTitles` da yo'q (`MobileShell.tsx:13-23`) → sarlavha "Sellary". Smena/ulanish holati mobil shellda umuman yo'q |
| 2 | Match System / Real World | 2 | Modul nomlari to'g'ri, lekin "Ещё" — arxiv tili; mobil launcher barcha tagline'ni o'chiradi (`apps/page.tsx:31-46`) |
| 3 | User Control and Freedom | 0 | `/pos` da chiqish yo'q: back tugma yo'q, tab bar ustidan bo'yalgan, escape link kesilgan. Logout yo'q, kompaniya almashtirish yo'q |
| 4 | Consistency and Standards | 1 | `DESIGN.md` bilan ziddiyat: accent, radius, type. `MobileShell` o'z title map'ini saqlaydi, `moduleNav.ts:16-19` esa "single source of nav truth" deb yozilgan |
| 5 | Error Prevention | 2 | POS cart bar `pb-safe` siz (`pos/page.tsx:1211`); `router.back()` (`MobileShell.tsx:52`) deep link'da ilovadan chiqarib yuboradi |
| 6 | Recognition Rather Than Recall | 1 | "Ещё" — belgisiz qop: Отчеты, Настройки, Смена, Клиенты, Заказы. 9px label = amalda icon-only. MoreSheet 11 bir xil qator, ikonkasiz |
| 7 | Flexibility and Efficiency | 1 | `MOBILE_MAX_TABS = 4` `MODULE_NAV` ni e'lon tartibida kesadi (`BottomTabBar.tsx:24`) — Отчеты hech qachon tab olmaydi. Har tabda `prefetch={false}` |
| 8 | Aesthetic and Minimalist Design | 2 | Ovoz izchil, lekin ma'lumot polidan past: 44px header bitta so'z uchun, 58px bar 20px glyph + 9px type uchun |
| 9 | Error Recovery | 1 | `ConnectionStatus` faqat desktopda (`Layout.tsx:157`). Mobilda offline holat, xato yuzasi, toast yo'q |
| 10 | Help and Documentation | 1 | Mobil launcher tushuntirish paragrafi, tagline va access badge'ni o'chiradi (`apps/page.tsx:60-63, 79-94`) |
| **Total** | | **12/40** | **Poor — major UX overhaul required** |

## Design Specificity Verdict

**LLM baho: category-interchangeable.** Rus so'zlarini olib tashlasang — istalgan B2B SaaS mobil shelli. Markazlashgan 44px title bar, 5 ta icon+mikrolabel tab, ellipsis sheet, 2-ustunli tile launcher. Kompozitsiyada hech narsa "bu kassa apparati" demaydi.

Isbot — nima yo'qligida: shellda pul yo'q, smena holati yo'q, ulanish holati yo'q, savat yo'q. `PRODUCT.md:58-61`: "the register is sacred… unmistakable totals". Shellning eng baland elementi — 15px extrabold so'z (`MobileHeader.tsx:32`), u pastdagi allaqachon yoritilgan tab nomini takrorlaydi.

Brifga zid: accent `#e2452f` (`globals.css:17`), `DESIGN.md:150` esa Register Blue `#2563eb` talab qiladi; `DESIGN.md:279` — "Red is a warning, not an accent". Barcha radius tokenlari (6/8/12/16/24px) tashlab yuborilgan, 0px burchak. 9px/10px type type-scale'da umuman yo'q.

**Deterministik skan:** `detect.mjs` → exit 2, **5 ta finding**, hammasi `gray-on-color` qoidasi, hammasi `pos/page.tsx:617,768,921`. **Beshtasi ham false positive** — qoida ternary shoxlari va `dark:`/`hover:`/`disabled:` variant prefikslarini ajratmaydi. `components/mobile/` va `apps/page.tsx` — 0 finding, exit 0. Toza deterministik signal: **0 ta amaliy finding**. Ya'ni detektor bu dizaynning muammolarini ko'rmaydi — ular struktura va konformans darajasida, qoida darajasida emas.

**Vizual overlay:** yo'q. Dev server ishlamayapti (`localhost:3000` → HTTP 000), skop bo'yicha ishga tushirilmadi.

## Overall Impression

Konsepsiya to'g'ri, ijro sinadi. Module-first tab modeli — do'kon tuzilishiga mos, `moduleNav.ts` — haqiqiy yaxshi IA ishi. Lekin shell asosiy foydalanuvchini asosiy ekranida qamab qo'yadi va `DESIGN.md` bilan rang/radius/target bo'yicha ochiq ziddiyatda.

Eng katta imkoniyat: shell chrome'ini modul almashtirgichdan **kassa holati indikatoriga** aylantirish — savat summasi, smena holati, ulanish. Hozir 44px header bir so'zga sarflanadi.

## What's Working

1. **`moduleNav.ts` yagona IA registri.** `grantedModuleDefs` / `shouldShowMoreTab` / `pageForPath` (`moduleNav.ts:85-138`) — ruxsatlar, tab bar, sheet, launcher va desktop rail bitta jadvaldan kelib chiqadi. `shouldShowMoreTab` (99-102) ko'rinadigan modulning yashirin ichki sahifalari holatini to'g'ri ushlaydi.
2. **Module-first tablar — to'g'ri mental model.** Tab modulning birinchi sahifasiga, sheet modulning to'liq sahifa ro'yxatiga. Bitta shell ikkala personani rejim almashtirmasdan xizmat qiladi.
3. **Flat hairline tili — authored, template emas.** 2px divider, nol radius, extrabold uppercase eyebrow — `MobileHeader`, `BottomTabBar`, `MoreSheet`, `apps/page.tsx` bo'ylab izchil. Ovoz `DESIGN.md` bo'yicha noto'g'ri, lekin bu *qaror* — qayta qurish emas, yo'naltirish kifoya.

## Priority Issues

### [P0] Mobil shell kassirni `/pos` da qamaydi va smena holatini yashiradi
- **Nima:** `(protected)/layout.tsx:46-48` `/pos` ni `MobileShell` ga o'raydi; `Layout.tsx:103` dagi desktop bypass mobilda ishlamaydi. Natijada: POS cart bar `fixed inset-x-0 bottom-0 z-30` (`pos/page.tsx:1211`) tab bar ustidan bo'yaydi; `showBack` 1-segmentli yo'lda false (`MobileShell.tsx:45`) — back tugma yo'q; POS'ning 52px top bari `overflow-x-hidden` bilan kesiladi (`MobileShell.tsx:54`) — smena pill'i, username va yagona chiqish linki (`Приложения`, 992) ko'rinmaydi; `h-screen` (949) ikki marta skroll qiladi.
- **Nega muhim:** Asosiy personaning asosiy ekrani — chiqishsiz tupik. Yomoni: "Смена открыта / закрыта" — savdo mumkinligini hal qiladigan holat — ekrandan tashqarida. `POST /api/sales` ochiq smenasiz 409 qaytaradi.
- **Fix:** `src/app/(protected)/layout.tsx` da desktop bypass'ni takrorlash: `if (isMobile && pathname.startsWith('/pos')) return <>{children}</>;`. Keyin `pos/page.tsx` ga haqiqiy mobil top bar: link qatorini wrap qilish, smena pill + Приложения doim ko'rinadi, `pb-safe` (1211), `h-screen` → `h-dvh` (949).
- **Command:** `/impeccable harden`, keyin `/impeccable layout`

### [P0] Asosiy navigatsiya AA kontrastdan yiqiladi va taqiqlangan accent ishlatadi
- **Nima:** `BottomTabBar.tsx:53,56-58` — nofaol ikonka va label `text-gray-400` (#9ca3af = **2.54:1** oq fonda), o'lcham `text-[9px]`. Faol holat `--erp-accent` #e2452f (`globals.css:17`) = **4.10:1**. `DESIGN.md:280` `gray-400` ni aniq taqiqlaydi (Muted Floor Rule); `DESIGN.md:279` — qizil accent emas; `DESIGN.md:150` — Register Blue `#2563eb`.
- **Nega muhim:** Butun mobil nav AA dan yiqiladi — aynan `PRODUCT.md:76-77` aytgan do'kon yorug'ligi sharoitida. Xavf uchun ajratilgan rang "siz shu yerdasiz" deb turibdi.
- **Fix:** `BottomTabBar.tsx` — nofaol `text-[#4b5563]`, faol `text-[#2563eb]`, ustiga 2px top indicator (faollik faqat rang bilan berilmasin), `text-[9px]` → `text-[11px]`. Keyin `globals.css:17` dagi `--erp-accent` ni `DESIGN.md` bilan yarashtirish — hozir ikkisi ochiq ziddiyatda.
- **Command:** `/impeccable colorize` (+ `/impeccable typeset`)

### [P1] Mobilda logout yo'q, kompaniya almashtirish yo'q, connection status yo'q, `/apps` ga yo'l yo'q
- **Nima:** `ConnectionStatus` (`Layout.tsx:157`), kompaniya `<select>` (159-176), logout (192-206) — faqat desktop layoutda. `MobileShell.tsx` hech birini render qilmaydi. Hech bir mobil yuza `/apps` ga link bermaydi (faqat `?? '/apps'` fallback).
- **Nega muhim:** Kassir umumiy planshet/telefonda smena oxirida chiqa olmaydi — bu xavfsizlik va topshirish muammosi. Ko'p kompaniyali foydalanuvchi login paytidagi tenantda qulflanadi.
- **Fix:** `MobileHeader` ning ishlatilmayotgan `actions` slotini (`MobileHeader.tsx:10,33`, `MobileShell.tsx:49-53` uzatmaydi) avatar/overflow tugma bilan to'ldirish → kompaniya nomi + switcher + Выйти sheet. Header chap slotiga `/apps` ga grid affordance. `ConnectionStatus` ni headerga ko'chirish.
- **Command:** `/impeccable audit`, keyin `/impeccable layout`

### [P1] Header qayerdaligi haqida yolg'on gapiradi — dublikat manbadan
- **Nima:** `MobileShell.tsx:13-37` shaxsiy `headerTitles` map saqlaydi. `/shifts` va `/orders` yo'q → ikkalasi "Sellary" ko'rsatadi, launcher bilan bir xil. `moduleNav.ts:119` allaqachon `pageForPath()` eksport qiladi.
- **Nega muhim:** Смена sahifasida — kassir kassasi ochiqligini tekshirayotgan paytda — header "Sellary" deydi. Nielsen #1 ning eng so'zma-so'z yiqilishi.
- **Fix:** `getHeaderTitle` ni `pageForPath(pathname)?.label ?? moduleForPath(pathname)?.label ?? 'Sellary'` bilan almashtirish, map'ni o'chirish. Bu 32-qatordagi chegarasiz `startsWith` ni ham yo'qotadi (hozir `/salesXYZ` ga ham mos keladi).
- **Command:** `/impeccable clarify`

### [P2] MoreSheet — 17 qatorli ro'yxat, dialog semantikasi yo'q, soxta drag handle
- **Nima:** `MoreSheet.tsx:33-78` — `role="dialog"` / `aria-modal` yo'q, focus trap yo'q, Escape yo'q, body scroll lock yo'q, close tugma yo'q; trigger'da `aria-expanded` yo'q (`BottomTabBar.tsx:67`). `h-1 w-8 bg-gray-300` (37) grabber'ga o'xshaydi, lekin hech narsa tortilmaydi. Scrim `animate-scale-in` (scale .9→1) ishlatadi — ochilishda chetlarda ~5% qorong'ilashmagan halqa chaqnaydi. `prefers-reduced-motion` repoda **nol marta** uchraydi, `PRODUCT.md:82-84` va `DESIGN.md:273` talab qilsa ham.
- **Nega muhim:** Klaviatura foydalanuvchisi kira ham, chiqa ham olmaydi. Swipe ishlamaydi. Hamma zoom qiladigan scrim ko'radi.
- **Fix:** `role="dialog" aria-modal="true" aria-labelledby`, Escape listener, focus trap + fokusni Ещё tugmasiga qaytarish; scrim'ni fade'ga almashtirish; handle'ni yo drag-to-dismiss bilan ulash yo real Закрыть tugmasiga almashtirish. `globals.css` ga `@media (prefers-reduced-motion: reduce)` bloki.
- **Command:** `/impeccable harden` (+ `/impeccable animate`)

## Cognitive Load: 6/8 FAIL (critical)

FAIL: single focus (`/pos` da ikkita header + ikkita bottom bar bitta 60px da), grouping (`mb-1` 4px guruh sarlavhasi vs `space-y-4` 16px guruhlar orasi), visual hierarchy (shellda hech narsa baland emas), ≤4 variant, working memory ("Ещё" qaysi modul nimani egallashini eslashni talab qiladi), progressive disclosure (sheet orqadagi 4 ta tabni ham qayta ko'rsatadi).
PASS: chunking, one-thing-at-a-time.

**4 dan ortiq variantli qaror nuqtalari:** BottomTabBar — 5 (admin uchun); **MoreSheet — 11 tugma + 6 guruh sarlavhasi = 17 skan qilinadigan qator** (eng yomoni); mobil launcher — 6 tile, taglinesiz, badge'siz.

## Emotional Journey

**Cho'qqi yo'q.** Cho'qqi bo'lishi kerak bo'lgan lahza — summa chiqadi, "Оплатить" bosiladi — eng buzuq lahza. Mobil cart bar (`pos/page.tsx:1211-1228`) summani `text-[24px]` `--erp-success` yashilda, pay tugmasini esa aynan shu yashilda beradi — pul va harakat bitta rang uchun kurashadi. `DESIGN.md:258-262`: Register Total = Register Blue, `font-black`, `text-3xl`–`text-5xl`, "a fixed law". Money-Is-Blue Rule va signature component — ikkisi ham pul asosiy bo'lgan yagona ekranda buzilgan.

**4 ta chuqurlik:** (1) Касса tab → chiqish yo'q; (2) Отчеты ni ellipsis ortidan qidirish, ichidan yana Касса topish; (3) Смена sahifasida header "Sellary" deydi — pul-kritik holatni tekshirayotgan aniq lahzada; (4) smena oxirida chiqish yo'q.

## Persona Red Flags

**Casey (chalg'igan, bir qo'lli, telefonda):** 9px label (`BottomTabBar.tsx:56`) — u to'rtta deyarli bir xil 20px kulrang outline glyph bo'yicha yuradi (`CubeIcon` / `TruckIcon` / `BuildingStorefrontIcon`). MoreSheet grabber (37) swipe'ga chaqiradi, hech narsa qilmaydi. MoreSheet qatorlari `py-2.5` + 14px ≈ **40px**, `space-y-0.5` (2px) — `PRODUCT.md:79-80` dagi 44px poldan past va Смена ga urinib Клиенты ga tegadi. Back tugma `h-9 w-9` = **36px** (`MobileHeader.tsx:25`). `Оплатить` bar `pb-safe` siz — pul tugmasi iOS home-indicator zonasida. `router.back()` (`MobileShell.tsx:52`) deep link'da Sellary'dan butunlay chiqarib yuboradi.

**Sam (a11y, klaviatura, screen reader):** MoreSheet'da dialog semantikasi, focus trap, Escape, fokus qaytishi yo'q; scrim — yalang'och `<div onClick>` (35). Ещё tugmasida `aria-expanded`/`aria-haspopup`/`aria-controls` yo'q. `<nav>` da `aria-label` yo'q, faol tabda `aria-current="page"` yo'q — faollik **faqat rang bilan** (SC 1.4.1 + 1.4.3 birga yiqiladi). **Shellning hech bir elementida `focus-visible` yo'q**, `DESIGN.md:235` doim ko'rinadigan 2px ring talab qilsa ham va `DESIGN.md:285` "Don't remove focus outlines; the POS is operated by keyboard and barcode scanner" desa ham. Skip link yo'q, tab bar — oxirgi DOM tugun. `prefers-reduced-motion` yo'q. 200% zoomda `h-[58px]` qat'iy bar `text-[9px]` label'ni kesadi.

**Jordan (birinchi marta):** `/apps` ga tushadi — desktop versiya o'zini tushuntiradi ("Выберите модуль…" `apps/page.tsx:60-63` + tagline + access badge 79-94), mobil shoxi (24-49) **uchalasini ham** o'chiradi. Касса bosadi — tab bar yo'q, back yo'q, tadqiqot tugadi. "Ещё" hech nima demaydi; `MOBILE_MAX_TABS = 4` e'lon tartibida kesgani uchun Отчеты va **Настройки** ellipsis ortida. Ещё ni ochadi — ichida yana Касса, orqada Касса tab. Смена ni ochadi — header "Sellary", boshlagan ekran bilan bir xil.

## Minor Observations

- `MobileHeader.tsx:21,33` ikkita `w-10` slot band qiladi, deyarli doim bo'sh — 375px header'ning 80px'i hech narsaga, markazlangan sarlavha esa pastdagi tab nomini takrorlaydi.
- Har tabda `prefetch={false}` (`BottomTabBar.tsx:48`) va tile'da (`apps/page.tsx:37`); `Layout.tsx:55-80` dagi `handlePrefetch` ning mobil ekvivalenti yo'q. Sekinroq tarmoq — sovuqroq navigatsiya.
- `useMediaQuery` mount'gacha `false` qaytaradi (`useMediaQuery.ts:18`) — telefonda har sovuq yuklashda avval **to'liq desktop `Layout`** chiziladi (74px rail + 216px sidebar + 56px header), keyin `MobileShell` ga remount. Ko'rinadigan chaqnash, bolalar unmount bo'lib state yo'qotadi.
- **Breakpoint mos emas:** shell `max-width: 767px` da almashadi (`(protected)/layout.tsx:18`), POS ichki split esa `lg:` = 1024px (`pos/page.tsx:1194,1202,1211`). 768–1023px orasida desktop Layout + POS mobil cart bar + cart aside yo'q.
- `--erp-*` tokenlari faqat light (`globals.css:5-19`), body qoidasi esa hali `dark:bg-gray-900` (23) e'lon qiladi. `PRODUCT.md:85` ikki temani birinchi darajali deydi.
- MoreSheet guruh sarlavhalari `text-gray-500` (#6b7280) — `DESIGN.md` Muted polidan (#4b5563) yengil — 10px uppercase, 0.1em tracking (`MoreSheet.tsx:47`).
- `MODULE_ICONS` faqat Heroicons **outline**. iOS ham, Android ham faol tabda *filled* ishlatadi; filled variant yo'qligi uchun faol holat platforma konvensiyasini ishlata olmaydi va faqat rangga tushib qoladi.
- Sheet o'zini "Ещё" deb ataydi (`MoreSheet.tsx:40`) — mazmuni bo'yicha emas, uni ochgan tugma bo'yicha.
- `shouldShowMoreTab` deyarli har foydalanuvchi uchun true, ya'ni `MOBILE_MAX_TABS = 4` amalda "4 tab va doim ellipsis" — overflow shoxi mo'ljallangandek hech qachon ishlamaydi.

## Questions to Consider

1. Kassirga kerak bo'lgan yagona raqam — joriy summa — shellda umuman yo'q, lekin modul launcher alohida ekran oladi. Mobilda `/apps` ni butunlay o'chirib, o'sha 44px header'ni har sahifada jonli savat summasi + smena holatiga bersang — kim nima yo'qotadi?
2. `DESIGN.md` repoda Register Blue pul, 8–24px radius, 44px target'ga majburiyat oladi. Bu shell qizil-to'q sariq accent, 0px burchak, 36–40px target jo'natadi. Qaysi hujjat endi yolg'on — va agar javob `DESIGN.md` bo'lsa, nega u hali ham har agent mos kelishi kerak bo'lgan artefakt?
3. Kassir sakkiz soat davomida aynan bitta moduldan foydalanadi. Nega mobil tajriba umuman modul *almashtirgich* — kassa + toza chiqish yo'li emas? Va desktop rail'i bor menejer hisobotlar uchun telefonni tanlaydimi?
