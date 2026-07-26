import importlib.util
from pathlib import Path
from typing import get_args

from core.modules import BUSINESS_TYPE_PRESETS, LEVEL_RANK, LEVELS, MODULES


class TestModuleRegistry:
    def test_modules_are_the_eight_business_domains(self):
        assert MODULES == (
            "register",
            "sales",
            "customers",
            "inventory",
            "purchasing",
            "shop",
            "reports",
            "finance",
        )

    def test_levels_rank_manager_above_user(self):
        assert LEVELS == ("user", "manager")
        assert LEVEL_RANK["manager"] > LEVEL_RANK["user"]

    def test_every_preset_names_only_real_modules(self):
        for business_type, modules in BUSINESS_TYPE_PRESETS.items():
            unknown = set(modules) - set(MODULES)
            assert not unknown, f"{business_type} names unknown modules: {unknown}"

    def test_online_preset_has_no_register(self):
        # The whole point of the split: an online store has no till.
        assert "register" not in BUSINESS_TYPE_PRESETS["online"]
        assert "shop" in BUSINESS_TYPE_PRESETS["online"]

    def test_every_preset_includes_finance(self):
        # Any business that takes money has to record when it moves: cash to
        # the bank, card takings withdrawn, a supplier paid.
        for business_type, modules in BUSINESS_TYPE_PRESETS.items():
            assert "finance" in modules, business_type

    def test_every_preset_includes_inventory(self):
        # Every vertical sells or moves stock.
        for business_type, modules in BUSINESS_TYPE_PRESETS.items():
            assert "inventory" in modules, business_type


def _load_migration():
    path = (
        Path(__file__).resolve().parents[2]
        / "alembic"
        / "versions"
        / "20260725_1000-c0d1e2f3a4b5_add_company_modules.py"
    )
    spec = importlib.util.spec_from_file_location("migration_c0d1e2f3a4b5", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class TestCompanyModulesMigrationConstants:
    """The suite runs on an already-migrated schema, so the backfill SQL is
    verified by an upgrade/downgrade round-trip. What a test catches cheaply is
    a later rename leaving the migration backfilling a dead key."""

    def test_backfill_names_only_real_modules(self):
        migration = _load_migration()
        assert set(migration.BASE_MODULES) <= set(MODULES)
        assert set(migration.POS_SPLIT) <= set(MODULES)

    def test_backfill_covers_every_module_that_existed_then(self):
        # shop stayed conditional on is_marketplace_enabled; everything else was
        # granted to every existing company so nobody lost a screen. `finance`
        # arrived later and is backfilled by its own migration, d1e2f3a4b5c6.
        migration = _load_migration()
        assert set(migration.BASE_MODULES) == set(MODULES) - {"shop", "finance"}

    def test_pos_split_is_the_three_domains_that_replaced_it(self):
        migration = _load_migration()
        assert migration.POS_SPLIT == ("register", "sales", "customers")


class TestBusinessTypeLiteral:
    def test_business_type_literal_matches_registry(self):
        # schemas/admin.py spells the types out because Literal cannot take a
        # tuple; this keeps the duplicate honest.
        from schemas.admin import BusinessType

        assert set(get_args(BusinessType)) == set(BUSINESS_TYPE_PRESETS)
