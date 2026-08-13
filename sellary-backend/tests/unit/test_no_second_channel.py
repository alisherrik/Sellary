"""One fact, one writer — enforced statically, because greps go stale.

Every drift this codebase has paid for came from a second place writing a fact that
already had one: a product edit form nudging `stock_quantity` behind the FIFO ledger,
a migration inventing `sale_payments` rows from the wrong ledger type. The allowlist
below is the point of this test — adding a file to it is a deliberate act, and a new
writer that is not in it fails CI naming the fact it duplicates.
"""
import ast
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[2]
SCANNED = ("api", "services", "repositories", "mcp_server")

# fact -> the files allowed to write it, and why
BALANCE_WRITERS = {
    # `_apply_balance` is the arithmetic; `writeoff_all_stock` is the documented
    # override that drains a product outright.
    "services/inventory_ledger_service.py": "the ledger owns the balance",
    # Initialises a brand-new row to zero before the ledger fills it in.
    "services/product_service.py": "zero on create, before the first layer",
}
GUARDED_ATTRIBUTES = {"stock_quantity", "inventory_value", "cost_price"}

CONSTRUCTOR_WRITERS = {
    "SalePayment": {
        "services/sale_tender_service.py": "tenders are the truth about money",
    },
    "MoneyMovement": {
        "services/money_service.py": "deliberate movements",
        # Writes the counted-vs-ledger correction directly, because
        # `_guard_till_shift` refuses a till movement while a shift is closing.
        "services/cash_shift_service.py": "the physical count correction",
    },
}


def _sources():
    for package in SCANNED:
        for path in (BACKEND / package).rglob("*.py"):
            yield path.relative_to(BACKEND).as_posix(), ast.parse(path.read_text(encoding="utf-8"))


def _attribute_writers():
    found = {}
    for relative, tree in _sources():
        for node in ast.walk(tree):
            targets = []
            if isinstance(node, ast.Assign):
                targets = node.targets
            elif isinstance(node, (ast.AugAssign, ast.AnnAssign)):
                targets = [node.target]
            for target in targets:
                if isinstance(target, ast.Attribute) and target.attr in GUARDED_ATTRIBUTES:
                    found.setdefault(target.attr, set()).add(relative)
    return found


def _constructor_writers(name):
    found = set()
    for relative, tree in _sources():
        for node in ast.walk(tree):
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == name:
                found.add(relative)
    return found


@pytest.mark.parametrize("attribute", sorted(GUARDED_ATTRIBUTES))
def test_the_product_balance_has_one_writer(attribute):
    writers = _attribute_writers().get(attribute, set())
    unexpected = writers - set(BALANCE_WRITERS)
    assert not unexpected, (
        f"{attribute} is written outside the ledger: {sorted(unexpected)}. "
        "The FIFO layers and this column are one fact; a second writer is how they drift."
    )


@pytest.mark.parametrize("name", sorted(CONSTRUCTOR_WRITERS))
def test_money_rows_have_one_constructor(name):
    allowed = set(CONSTRUCTOR_WRITERS[name])
    unexpected = _constructor_writers(name) - allowed
    assert not unexpected, (
        f"{name} is constructed outside {sorted(allowed)}: {sorted(unexpected)}."
    )
