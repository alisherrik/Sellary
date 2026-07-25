"""Canonical module registry.

A module is a business domain, not a screen group. Access is two-layered:
`company_modules` says what a company has (owner-controlled, a commercial
decision), `membership_module_access` says what a user may open within it.

This tuple is the single source of truth on the backend. `lib/modules.ts`
mirrors it on the frontend; `scripts/check_module_parity.py` fails CI if the
two drift.
"""

MODULES = (
    "register",     # Касса, Смена
    "sales",        # История продаж, возвраты, аннулирование
    "customers",    # Клиенты, долги
    "inventory",    # Товары, категории
    "purchasing",   # Поставщики, Заказы поставщикам
    "shop",         # Telegram-магазин, Заказы
    "reports",      # Дашборд, Аналитика
)

LEVELS = ("user", "manager")

LEVEL_RANK = {"user": 1, "manager": 2}

# A business type is a label and a starting point, never a lock. The owner
# edits the resulting module set freely afterwards.
#
# `kitchen` and `production` are composed from modules that exist today. They
# do not yet carry recipes, stations, BOMs or work orders — those arrive with
# their own specs and extend the preset then.
BUSINESS_TYPE_PRESETS: dict[str, tuple[str, ...]] = {
    "retail": ("register", "sales", "customers", "inventory", "purchasing", "reports"),
    "online": ("sales", "customers", "inventory", "shop", "reports"),
    "warehouse": ("inventory", "purchasing", "reports"),
    "kitchen": ("register", "sales", "inventory", "purchasing", "reports"),
    "production": ("sales", "customers", "inventory", "purchasing", "reports"),
}

BUSINESS_TYPES = tuple(BUSINESS_TYPE_PRESETS)
