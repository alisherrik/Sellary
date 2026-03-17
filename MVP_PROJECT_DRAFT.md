# Sellary MVP GitHub Project Draft

Bu fayl GitHub publish qilishdan oldingi draft hisoblanadi.

Maqsad:

- `Suggestion.md` asosida GitHub Project yaratish
- MVP scope bo'yicha issues/tasklar ochish
- Hozircha app kodini implement qilmaslik

## GitHub Project

- Project title: `Sellary MVP`
- Repository: `alisherrik/Sellary`
- Format: GitHub Project + repository issues

## Tavsiya etilgan labels

- `mvp`
- `priority:P0`
- `priority:P1`
- `priority:P2`
- `phase:1`
- `phase:2`
- `area:product`
- `area:frontend`
- `area:backend`
- `area:infra`
- `area:qa`
- `area:docs`

## Tavsiya etilgan tasklar

### 1. [P0] Freeze MVP scope to retail-only

Labels:

- `mvp`
- `priority:P0`
- `phase:1`
- `area:product`

Natija:

- MVP scope aniq yoziladi
- Retail-only qarori rasmiylashadi
- Restaurant va offline scope tashqariga olinadi

### 2. [P0] Hide restaurant module from MVP surface

Labels:

- `mvp`
- `priority:P0`
- `phase:1`
- `area:frontend`

Natija:

- Sidebar'dan restaurant yo'qoladi
- Restaurant route'lar MVP build'da ko'rinmaydi

### 3. [P0] Disable offline sync and PWA-specific MVP flows

Labels:

- `mvp`
- `priority:P0`
- `phase:1`
- `area:frontend`
- `area:infra`

Natija:

- Offline queue UI o'chiriladi
- Auto sync MVP dan olinadi
- Release online-only bo'ladi

### 4. [P0] Block overselling and negative stock in sales flow

Labels:

- `mvp`
- `priority:P0`
- `phase:1`
- `area:backend`

Natija:

- Stock yetmasa sotuv bloklanadi
- Negative stock holati yopiladi

### 5. [P0] Remove startup schema creation and enforce Alembic-only migrations

Labels:

- `mvp`
- `priority:P0`
- `phase:1`
- `area:backend`
- `area:infra`

Natija:

- App import paytida DB schema yaratmaydi
- Migration intizomi Alembic orqali yuradi

### 6. [P1] Standardize backend URL and health check configuration

Labels:

- `mvp`
- `priority:P1`
- `phase:1`
- `area:frontend`
- `area:infra`

Natija:

- Hardcoded `localhost` lar kamayadi
- Bitta env-driven config ishlaydi

### 7. [P1] Simplify POS to single active cart for MVP

Labels:

- `mvp`
- `priority:P1`
- `phase:1`
- `area:frontend`

Natija:

- Multi-session POS vaqtincha soddalashadi
- Kassir flow yanada tushunarli bo'ladi

### 8. [P1] Reduce reports and settings to MVP-safe surface

Labels:

- `mvp`
- `priority:P1`
- `phase:1`
- `area:product`
- `area:frontend`

Natija:

- Faqat kerakli hisobotlar qoladi
- Settings sahifasidagi ortiqcha elementlar yashiriladi

### 9. [P1] Unify frontend API and store layers

Labels:

- `mvp`
- `priority:P1`
- `phase:1`
- `area:frontend`

Natija:

- `src/api.ts` va `src/lib/api.ts` bo'yicha aniq canonical layer tanlanadi
- `store` qatlamida chalkashlik kamayadi

### 10. [P1] Uzbek copy pass for core retail screens

Labels:

- `mvp`
- `priority:P1`
- `phase:2`
- `area:frontend`

Natija:

- POS
- Products
- Sales
- Purchase Orders

shu ekranlarda asosiy matnlar o'zbekcha bo'ladi

### 11. [P1] Create MVP smoke-test checklist for retail flow

Labels:

- `mvp`
- `priority:P1`
- `phase:2`
- `area:qa`

Natija:

- Login -> POS -> Sale -> Stock -> History -> Purchase Receive flow uchun checklist bo'ladi

### 12. [P2] Prepare pilot release checklist and operator guide

Labels:

- `mvp`
- `priority:P2`
- `phase:2`
- `area:docs`

Natija:

- Pilot uchun release checklist
- Oddiy operator guide
- Setup va rollback notes

## Publishdan oldingi qaror

Mening tavsiyam:

- Shu 12 ta issue bilan chiqish
- Avval `phase:1` tasklarni ustuvor qilish
- `phase:2` tasklarni phase-1 tugagach olish

## GitHub publish uchun kerak bo'ladigan narsa

Hozir `gh` auth yaroqsiz.
Publish uchun quyidagilardan biri kerak bo'ladi:

- `gh auth login`
- yoki `gh auth refresh -s project`

Auth to'g'rilangach, `scripts/create_github_mvp_project.ps1` ishga tushirib project va issues'larni GitHub'ga chiqarish mumkin.
