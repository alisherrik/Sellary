param(
    [string]$Owner = "alisherrik",
    [string]$Repo = "alisherrik/Sellary",
    [string]$ProjectTitle = "Sellary MVP"
)

$ErrorActionPreference = "Stop"

function Assert-GhAvailable {
    if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
        throw "GitHub CLI topilmadi. Avval gh o'rnatilishi kerak."
    }
}

function Assert-GhAuth {
    $null = gh auth token 2>$null
    if ($LASTEXITCODE -ne 0) {
        throw "gh auth topilmadi yoki token yaroqsiz. Avval 'gh auth login' yoki 'gh auth refresh -s project' qiling."
    }
}

function Ensure-Label {
    param(
        [string]$Name,
        [string]$Color,
        [string]$Description
    )

    gh label create $Name `
        --repo $Repo `
        --color $Color `
        --description $Description `
        --force | Out-Null
}

function Get-OrCreate-Project {
    $projectsJson = gh project list --owner $Owner --format json
    $projects = $projectsJson | ConvertFrom-Json
    $existing = $projects | Where-Object { $_.title -eq $ProjectTitle } | Select-Object -First 1

    if ($existing) {
        return [int]$existing.number
    }

    $createdJson = gh project create --owner $Owner --title $ProjectTitle --format json
    $created = $createdJson | ConvertFrom-Json
    return [int]$created.number
}

function Ensure-Project-Link {
    param(
        [int]$ProjectNumber
    )

    gh project link $ProjectNumber --owner $Owner --repo $Repo | Out-Null
}

function Get-Existing-Issues {
    $issuesJson = gh issue list --repo $Repo --state all --limit 200 --json number,title,url
    return $issuesJson | ConvertFrom-Json
}

function New-IssueBodyFile {
    param(
        [string]$Body
    )

    $tempFile = [System.IO.Path]::GetTempFileName()
    Set-Content -Path $tempFile -Value $Body -Encoding UTF8
    return $tempFile
}

Assert-GhAvailable
Assert-GhAuth

$labels = @(
    @{ Name = "mvp"; Color = "1D76DB"; Description = "Sellary MVP work items" },
    @{ Name = "priority:P0"; Color = "B60205"; Description = "Critical before MVP release" },
    @{ Name = "priority:P1"; Color = "D93F0B"; Description = "Important MVP work" },
    @{ Name = "priority:P2"; Color = "FBCA04"; Description = "Useful but not blocking" },
    @{ Name = "phase:1"; Color = "0E8A16"; Description = "Phase 1 stabilization" },
    @{ Name = "phase:2"; Color = "5319E7"; Description = "Phase 2 pilot preparation" },
    @{ Name = "area:product"; Color = "0052CC"; Description = "Product and scope decisions" },
    @{ Name = "area:frontend"; Color = "C5DEF5"; Description = "Frontend work" },
    @{ Name = "area:backend"; Color = "F9D0C4"; Description = "Backend work" },
    @{ Name = "area:infra"; Color = "BFDADC"; Description = "Infra and config work" },
    @{ Name = "area:qa"; Color = "E4E669"; Description = "QA and validation work" },
    @{ Name = "area:docs"; Color = "D4C5F9"; Description = "Documentation work" }
)

foreach ($label in $labels) {
    Ensure-Label -Name $label.Name -Color $label.Color -Description $label.Description
}

$projectNumber = Get-OrCreate-Project
Ensure-Project-Link -ProjectNumber $projectNumber

$issues = @(
    @{
        Title = "[P0] Freeze MVP scope to retail-only"
        Labels = @("mvp", "priority:P0", "phase:1", "area:product")
        Body = @"
## Context
`Suggestion.md` tavsiyasi bo'yicha hozirgi repo ichida retail POS, restaurant va offline yo'nalishlar aralashib ketgan.

## Goal
MVP scope'ni aniq qilib, retail-only product sifatida freeze qilish.

## Acceptance Criteria
- MVP scope hujjatda aniq yozilgan
- Restaurant MVP scope'dan chiqarilgan
- Offline-first MVP scope'dan chiqarilgan
- Core MVP modullar ro'yxati yakuniy ko'rinishga kelgan
"@
    },
    @{
        Title = "[P0] Hide restaurant module from MVP surface"
        Labels = @("mvp", "priority:P0", "phase:1", "area:frontend")
        Body = @"
## Context
Restaurant UI navigatsiyada ochiq turibdi, lekin flow production-ready emas.

## Goal
MVP release'da restaurant modulini foydalanuvchi ko'rmaydigan qilish.

## Acceptance Criteria
- Sidebar'da restaurant ko'rinmaydi
- Restaurant route'lar MVP build'da yashirilgan
- Retail flow'ga ta'sir qilmaydi
"@
    },
    @{
        Title = "[P0] Disable offline sync and PWA-specific MVP flows"
        Labels = @("mvp", "priority:P0", "phase:1", "area:frontend", "area:infra")
        Body = @"
## Context
Offline queue va auto-sync qismi hozircha release uchun xavfli.

## Goal
Birinchi MVP'ni online-only qilish.

## Acceptance Criteria
- Offline queue UI yashirilgan
- Auto sync o'chirilgan
- PWA/offline marketing MVP ichida ishlatilmaydi
- Online-only flow aniq ko'rsatilgan
"@
    },
    @{
        Title = "[P0] Block overselling and negative stock in sales flow"
        Labels = @("mvp", "priority:P0", "phase:1", "area:backend")
        Body = @"
## Context
Backend `sale_service.py` ichida overselling demo uchun ruxsat qilingan.

## Goal
Stock noto'g'ri manfiy ketishining oldini olish.

## Acceptance Criteria
- Stock yetmasa sale yaratilmaydi
- User aniq xatolik ko'radi
- Negative stock holati yopilgan
- Sales flow race condition'da ham xavfsiz ishlaydi
"@
    },
    @{
        Title = "[P0] Remove startup schema creation and enforce Alembic-only migrations"
        Labels = @("mvp", "priority:P0", "phase:1", "area:backend", "area:infra")
        Body = @"
## Context
App startup paytida `Base.metadata.create_all(...)` ishlayapti.

## Goal
Schema boshqaruvini faqat migration intizomiga o'tkazish.

## Acceptance Criteria
- App import/startup paytida schema create bo'lmaydi
- Alembic yagona schema management yo'li bo'ladi
- Test va startup jarayoni DB environment bo'lmasa ham boshqariladigan holatga keladi
"@
    },
    @{
        Title = "[P1] Standardize backend URL and health check configuration"
        Labels = @("mvp", "priority:P1", "phase:1", "area:frontend", "area:infra")
        Body = @"
## Context
Frontend va health check tarafida hardcoded localhost ishlatilgan.

## Goal
Backend URL va health check konfiguratsiyasini env-driven qilish.

## Acceptance Criteria
- Hardcoded localhost'lar kamaytirilgan
- API va health check bir xil config manbadan foydalanadi
- Dev/prod muhitlari uchun boshqariladigan sozlama mavjud
"@
    },
    @{
        Title = "[P1] Simplify POS to single active cart for MVP"
        Labels = @("mvp", "priority:P1", "phase:1", "area:frontend")
        Body = @"
## Context
POS ichida multi-session cart bor, lekin MVP uchun bu ortiqcha murakkablik bo'lishi mumkin.

## Goal
Birinchi release'ni kassir uchun sodda qilish.

## Acceptance Criteria
- Single active cart strategiyasi qabul qilingan
- `Yangi chek` flow MVP holatiga mos ravishda soddalashgan yoki yashirilgan
- POS checkout user flow ancha tushunarli bo'lgan
"@
    },
    @{
        Title = "[P1] Reduce reports and settings to MVP-safe surface"
        Labels = @("mvp", "priority:P1", "phase:1", "area:product", "area:frontend")
        Body = @"
## Context
Reports va settings ichida MVP uchun kritik bo'lmagan elementlar bor.

## Goal
Foydalanuvchiga faqat kerakli yuzalarni qoldirish.

## Acceptance Criteria
- Dashboard va basic reports qoldirilgan
- MVP uchun ortiqcha settings elementlari yashirilgan
- Product owner bilan yakuniy minimal surface kelishilgan
"@
    },
    @{
        Title = "[P1] Unify frontend API and store layers"
        Labels = @("mvp", "priority:P1", "phase:1", "area:frontend")
        Body = @"
## Context
Repo ichida duplicate API/store layer'lar bor va ular chalkashlik keltirishi mumkin.

## Goal
Canonical frontend layer tanlash.

## Acceptance Criteria
- API layer bo'yicha bitta canonical yo'l belgilangan
- Store layer bo'yicha bitta canonical yo'l belgilangan
- Qo'shimcha cleanup tasklari aniqlangan
"@
    },
    @{
        Title = "[P1] Uzbek copy pass for core retail screens"
        Labels = @("mvp", "priority:P1", "phase:2", "area:frontend")
        Body = @"
## Context
Core retail ekranlarida ko'p joy ruscha matnlar ishlatilgan.

## Goal
Target user uchun oson tushuniladigan asosiy tilni birxillashtirish.

## Acceptance Criteria
- POS screen asosiy matnlari o'zbekcha
- Products screen asosiy matnlari o'zbekcha
- Sales screen asosiy matnlari o'zbekcha
- Purchase Orders screen asosiy matnlari o'zbekcha
"@
    },
    @{
        Title = "[P1] Create MVP smoke-test checklist for retail flow"
        Labels = @("mvp", "priority:P1", "phase:2", "area:qa")
        Body = @"
## Context
MVP tayyor bo'lganda tez smoke test qilinadigan checklist kerak bo'ladi.

## Goal
Retail MVP uchun takror ishlatiladigan validation checklist yaratish.

## Acceptance Criteria
- Login flow checklist mavjud
- POS checkout checklist mavjud
- Stock update checklist mavjud
- Purchase receive checklist mavjud
- Sales history/dashboard smoke test checklist mavjud
"@
    },
    @{
        Title = "[P2] Prepare pilot release checklist and operator guide"
        Labels = @("mvp", "priority:P2", "phase:2", "area:docs")
        Body = @"
## Context
Pilotga chiqishdan oldin ishlatish qo'llanmasi va release checklist kerak.

## Goal
Pilot release uchun operator darajasidagi tayyorgarlik ko'rish.

## Acceptance Criteria
- Release checklist tayyor
- Operator guide draft tayyor
- Setup notes tayyor
- Rollback yoki support notes tayyor
"@
    }
)

$existingIssues = Get-Existing-Issues

foreach ($issue in $issues) {
    $alreadyExists = $existingIssues | Where-Object { $_.title -eq $issue.Title } | Select-Object -First 1
    if ($alreadyExists) {
        Write-Host "Skip: issue allaqachon mavjud -> $($issue.Title)"
        continue
    }

    $bodyFile = New-IssueBodyFile -Body $issue.Body

    try {
        $args = @(
            "issue", "create",
            "--repo", $Repo,
            "--title", $issue.Title,
            "--body-file", $bodyFile,
            "--project", $ProjectTitle
        )

        foreach ($label in $issue.Labels) {
            $args += @("--label", $label)
        }

        $createdUrl = & gh @args
        Write-Host "Created: $createdUrl"
    }
    finally {
        Remove-Item $bodyFile -ErrorAction SilentlyContinue
    }
}

Write-Host ""
Write-Host "GitHub MVP planning publish qilindi:"
Write-Host "- Repo: $Repo"
Write-Host "- Project: $ProjectTitle"
Write-Host "- Project number: $projectNumber"
