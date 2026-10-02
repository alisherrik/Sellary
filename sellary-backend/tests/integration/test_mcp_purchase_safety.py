"""Purchase previews and commits against isolated data, including real commits."""

from decimal import Decimal

import pytest
from fastmcp.exceptions import ToolError
from mcp.server.auth.provider import AccessToken
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from core.database import Base
from core.modules import MODULES
from mcp_server import SCOPE_PURCHASING, SCOPE_REPORTS
from mcp_server import context as mcp_context
from mcp_server import tools_purchase
from models.company import Company
from models.company_membership import CompanyMembership
from models.company_module import CompanyModule
from models.idempotency_key import IdempotencyKey
from models.inventory_layer import InventoryLayer
from models.product import Product
from models.purchase_order import PurchaseOrder
from models.purchase_receipt import PurchaseReceipt
from models.supplier import Supplier
from models.user import User
from schemas.purchase_order import PurchaseOrderCreate
from services.purchase_order_service import PurchaseOrderService
from services.inventory_ledger_service import InventoryLedgerService
from tests.integration.test_mcp_tools import as_user, catalogue  # noqa: F401


@pytest.mark.parametrize("mixed", [False, True])
def test_created_product_commit_replays_original_order(
    as_user, db_session, admin_user, default_company, catalogue, mixed
):
    as_user(admin_user, default_company)
    items = [{"query": "Entirely new oats", "quantity": 2, "unit_cost": "10"}]
    if mixed:
        items.append({"query": catalogue["products"][0].name, "quantity": 1, "unit_cost": "5"})
    preview = tools_purchase.purchase_preview(supplier="Ромашка", items=items)
    first = tools_purchase.purchase_commit(preview["draft_token"])
    second = tools_purchase.purchase_commit(preview["draft_token"])
    assert second["purchase_order_id"] == first["purchase_order_id"]
    assert second["replayed"] is True
    assert db_session.query(PurchaseOrder).count() == 1
    created = db_session.query(Product).filter_by(name="Entirely new oats").one()
    assert created.stock_quantity == Decimal("2")


@pytest.fixture
def committed_purchase_engine(monkeypatch):
    """Own engine: repository commits must really persist for these regressions."""
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as setup:
        company = Company(name="Purchase tests", slug="purchase-tests", is_active=True)
        user = User(username="purchase-tests", email="purchase@example.test", hashed_password="unused", role="admin", is_active=True)
        setup.add_all([company, user])
        setup.flush()
        company_id, user_id = company.id, user.id
        setup.add(CompanyMembership(company_id=company_id, user_id=user_id, role="admin", is_active=True))
        setup.add_all([CompanyModule(company_id=company_id, module=module) for module in MODULES])
        setup.add(Supplier(company_id=company_id, name="Purchase Supplier", phone="123", is_active=True))
        setup.add(Product(company_id=company_id, name="Existing item", cost_price=1, sell_price=2, stock_quantity=0, min_stock_level=0, is_active=True))
        setup.commit()
    token = AccessToken(token="test", client_id="test", scopes=[SCOPE_REPORTS, SCOPE_PURCHASING],
                        claims={"user_id": user_id, "company_id": company_id, "mcp": True})
    monkeypatch.setattr(mcp_context, "get_access_token", lambda: token)
    monkeypatch.setattr(mcp_context, "SessionLocal", lambda: Session(engine))
    try:
        yield engine, company_id
    finally:
        engine.dispose()


@pytest.mark.no_auto_shift
@pytest.mark.parametrize("failure", ["receipt", "idempotency"])
def test_failed_commit_rolls_back_order_products_and_receipt(
    committed_purchase_engine, monkeypatch, failure
):
    from core.idempotency import IdempotencyService

    engine, _ = committed_purchase_engine
    preview = tools_purchase.purchase_preview(supplier="Purchase Supplier", items=[
        {"query": "Existing item", "quantity": 1, "unit_cost": "1"},
        {"query": "New rice product", "quantity": 2, "unit_cost": "3"},
    ])
    def fail(*args, **kwargs):
        raise ValueError("Injected purchase failure")
    if failure == "receipt":
        monkeypatch.setattr(PurchaseOrderService, "receive_items", fail)
    else:
        monkeypatch.setattr(IdempotencyService, "store_response", fail)
    for _ in range(2):
        with pytest.raises(ToolError, match="Injected purchase failure"):
            tools_purchase.purchase_commit(preview["draft_token"])
        with Session(engine) as check:
            assert check.query(PurchaseOrder).count() == 0
            assert check.query(Product).count() == 1
            assert check.query(PurchaseReceipt).count() == 0
            assert check.query(InventoryLayer).count() == 0
            assert check.query(IdempotencyKey).count() == 0
            assert check.query(Product).one().stock_quantity == 0


@pytest.mark.no_auto_shift
def test_service_create_default_still_commits_for_rest(committed_purchase_engine):
    engine, company_id = committed_purchase_engine
    with Session(engine) as session:
        supplier_id = session.query(Supplier.id).scalar()
        product_id = session.query(Product.id).scalar()
        order = PurchaseOrderService(session, company_id).create(PurchaseOrderCreate(
            supplier_id=supplier_id,
            items=[{"product_id": product_id, "quantity_ordered": 1, "unit_cost": 1}],
        ))
        order_id = order.id
    with Session(engine) as check:
        assert check.get(PurchaseOrder, order_id) is not None


def test_exact_duplicate_names_need_product_id(
    as_user, db_session, admin_user, default_company, catalogue
):
    sugar = catalogue["products"][0]
    other = Product(company_id=default_company.id, name=sugar.name, barcode="OTHER-SUGAR", cost_price=5, sell_price=7, stock_quantity=0, is_active=True)
    db_session.add(other)
    db_session.flush()
    as_user(admin_user, default_company)
    preview = tools_purchase.purchase_preview(supplier="Ромашка", items=[
        {"query": sugar.name, "quantity": 1, "unit_cost": "5"}])
    assert preview["can_commit"] is False
    assert preview["draft_token"] is None
    assert {c["product_id"] for c in preview["lines"][0]["candidates"]} == {sugar.id, other.id}
    selected = tools_purchase.purchase_preview(supplier="Ромашка", items=[
        {"query": sugar.name, "product_id": sugar.id, "quantity": 1, "unit_cost": "5"}])
    assert selected["can_commit"] is True
    assert selected["lines"][0]["product_id"] == sugar.id


def test_supplier_tie_returns_candidates_and_accepts_explicit_id(
    as_user, db_session, admin_user, default_company, catalogue
):
    suppliers = [Supplier(company_id=default_company.id, name=name, phone="123", is_active=True)
                 for name in ("North Foods", "North Foods Import")]
    db_session.add_all(suppliers)
    db_session.flush()
    as_user(admin_user, default_company)
    items = [{"query": catalogue["products"][0].name, "quantity": 1, "unit_cost": "5"}]
    preview = tools_purchase.purchase_preview(supplier="North", items=items)
    assert preview["can_commit"] is False
    assert preview["draft_token"] is None
    assert {c["supplier_id"] for c in preview["supplier_candidates"]} == {s.id for s in suppliers}
    selected = tools_purchase.purchase_preview(supplier="North", supplier_id=suppliers[1].id, items=items)
    assert selected["can_commit"] is True
    assert selected["supplier"] == "North Foods Import"


@pytest.mark.parametrize("invalid", [
    {"sell_price": "-1"}, {"sell_price": "NaN"}, {"sell_price": "Infinity"},
    {"quantity": "NaN"}, {"quantity": "Infinity"},
    {"unit_cost": "NaN"}, {"unit_cost": "Infinity"},
    {"query": ""}, {"query": "a" * 201}, {"uom": "a" * 21},
    {"barcode": "a" * 51}, {"product_id": "not-an-id"},
])
def test_invalid_purchase_lines_are_refused_before_draft(
    as_user, admin_user, default_company, catalogue, invalid
):
    as_user(admin_user, default_company)
    item = {"query": "New rice product", "quantity": 1, "unit_cost": "3", **invalid}
    with pytest.raises(ToolError):
        tools_purchase.purchase_preview(supplier="Ромашка", items=[item])


def test_unknown_barcode_requires_a_new_product_name(
    as_user, admin_user, default_company, catalogue
):
    as_user(admin_user, default_company)
    with pytest.raises(ToolError):
        tools_purchase.purchase_preview(supplier="Ромашка", items=[
            {"barcode": "UNKNOWN", "quantity": 1, "unit_cost": "3"}])


@pytest.mark.parametrize("markup", [float("nan"), float("inf"), float("-inf")])
def test_nonfinite_markup_is_refused_before_draft(as_user, admin_user, default_company, catalogue, markup):
    as_user(admin_user, default_company)
    with pytest.raises(ToolError):
        tools_purchase.purchase_preview(supplier="Ромашка", markup_percent=markup, items=[
            {"query": "New rice product", "quantity": 1, "unit_cost": "3"}])


def test_typed_purchase_items_keep_comma_decimal_and_name_alias(
    as_user, admin_user, default_company, catalogue
):
    from typing import get_args, get_type_hints
    from pydantic import BaseModel

    item_model = get_args(get_type_hints(tools_purchase.purchase_preview)["items"])[0]
    assert issubclass(item_model, BaseModel)
    as_user(admin_user, default_company)
    preview = tools_purchase.purchase_preview(supplier="Ромашка", items=[
        item_model(name="New rice product", quantity="2,5", unit_cost="3,50")])
    assert preview["can_commit"] is True
    assert preview["lines"][0]["query"] == "New rice product"
    assert preview["total_amount"] == "8.75"


def test_commit_mode_declares_supported_values():
    from typing import get_args, get_type_hints

    assert set(get_args(get_type_hints(tools_purchase.purchase_commit)["mode"])) == {"receive", "draft"}


@pytest.mark.parametrize("query", [None, ""])
def test_empty_query_keeps_legacy_name_fallback(as_user, admin_user, default_company, catalogue, query):
    as_user(admin_user, default_company)
    preview = tools_purchase.purchase_preview(supplier="Ромашка", items=[
        {"query": query, "name": "New rice product", "quantity": "2,5", "unit_cost": "3,50"}])
    assert preview["can_commit"] is True
    assert preview["lines"][0]["product_name"] == "New rice product"


def test_unreadable_markup_is_an_actionable_error(as_user, admin_user, default_company, catalogue):
    as_user(admin_user, default_company)
    with pytest.raises(ToolError):
        tools_purchase.purchase_preview(supplier="Ромашка", markup_percent="unreadable", items=[
            {"query": "New rice product", "quantity": 1, "unit_cost": "3"}])


def _barcode_product_with_stock(engine, company_id, *, active):
    with Session(engine) as db:
        user_id = db.query(User.id).scalar()
        product = Product(
            company_id=company_id,
            name="Original archived card",
            barcode="ARCHIVED-CARD",
            cost_price=Decimal("4"),
            sell_price=Decimal("5"),
            stock_quantity=0,
            inventory_value=0,
            is_active=True,
        )
        db.add(product)
        db.flush()
        InventoryLedgerService(db, company_id).add_layer(
            product=product,
            quantity=Decimal("4"),
            unit_cost=Decimal("4"),
            source_type="product_initial",
            source_id=product.id,
            user_id=user_id,
            reason="Existing stock before MCP purchase",
        )
        product.is_active = active
        product_id = product.id
        db.commit()
    return product_id


def _assert_original_barcode_product_unchanged(engine, product_id, *, active):
    with Session(engine) as db:
        product = db.get(Product, product_id)
        assert product.name == "Original archived card"
        assert product.is_active is active
        assert product.stock_quantity == Decimal("4")
        assert product.inventory_value == Decimal("16")
        assert db.query(InventoryLayer).one().remaining_quantity == Decimal("4")
        assert db.query(PurchaseOrder).count() == 0
        assert db.query(PurchaseReceipt).count() == 0
        assert db.query(IdempotencyKey).count() == 0
        assert db.query(Product).count() == 2


@pytest.mark.no_auto_shift
def test_preview_refuses_archived_barcode_without_reactivating_stock(committed_purchase_engine):
    engine, company_id = committed_purchase_engine
    product_id = _barcode_product_with_stock(engine, company_id, active=False)
    with pytest.raises(ToolError, match="архив"):
        tools_purchase.purchase_preview(
            supplier="Purchase Supplier",
            items=[{
                "query": "Brand new quinoa",
                "barcode": "ARCHIVED-CARD",
                "quantity": 2,
                "unit_cost": "3",
            }],
        )
    _assert_original_barcode_product_unchanged(engine, product_id, active=False)


@pytest.mark.no_auto_shift
@pytest.mark.parametrize("mode", ["draft", "receive"])
@pytest.mark.parametrize("active", [False, True])
def test_commit_refuses_new_barcode_conflict_after_preview(
    committed_purchase_engine, mode, active
):
    engine, company_id = committed_purchase_engine
    preview = tools_purchase.purchase_preview(
        supplier="Purchase Supplier",
        items=[{
            "query": "Brand new quinoa",
            "barcode": "ARCHIVED-CARD",
            "quantity": 2,
            "unit_cost": "3",
        }],
    )
    assert preview["can_commit"] is True
    assert preview["lines"][0]["status"] == "new"
    product_id = _barcode_product_with_stock(engine, company_id, active=active)
    with pytest.raises(ToolError):
        tools_purchase.purchase_commit(preview["draft_token"], mode=mode)
    _assert_original_barcode_product_unchanged(engine, product_id, active=active)


@pytest.mark.parametrize("second_name", ["New quinoa flakes zzzz", "New rice flakes yyyy"])
def test_preview_refuses_repeated_new_barcode_before_issuing_a_draft(
    as_user, db_session, admin_user, default_company, catalogue, second_name
):
    as_user(admin_user, default_company)
    with pytest.raises(ToolError, match="штрихкод"):
        tools_purchase.purchase_preview(supplier="Ромашка", items=[
            {"query": "New quinoa flakes zzzz", "barcode": "DUP-IN-DRAFT", "quantity": 1, "unit_cost": "3"},
            {"query": second_name, "barcode": " DUP-IN-DRAFT ", "quantity": 2, "unit_cost": "3"},
        ])
    assert db_session.query(PurchaseOrder).count() == 0
    assert db_session.query(Product).count() == 2


def test_preview_refuses_more_than_200_lines(as_user, admin_user, default_company, catalogue):
    as_user(admin_user, default_company)
    with pytest.raises(ToolError):
        tools_purchase.purchase_preview(supplier="Ромашка", items=[
            {"query": catalogue["products"][0].name, "quantity": 1, "unit_cost": "5"}
            for _ in range(201)
        ])


def test_purchase_tools_describe_side_effects_bounded_items_and_output_shapes():
    import asyncio
    from mcp_server.server import mcp

    tools = {tool.name: tool for tool in asyncio.run(mcp.list_tools())}
    preview, commit = tools["purchase_preview"], tools["purchase_commit"]
    assert preview.annotations.readOnlyHint is True
    assert preview.annotations.destructiveHint is False
    assert preview.annotations.openWorldHint is False
    assert commit.annotations.readOnlyHint is False
    assert commit.annotations.destructiveHint is False
    assert commit.annotations.idempotentHint is True
    assert commit.annotations.openWorldHint is False
    assert preview.parameters["properties"]["items"]["minItems"] == 1
    assert preview.parameters["properties"]["items"]["maxItems"] == 200
    assert preview.output_schema["properties"]["lines"]["type"] == "array"
    assert preview.output_schema["properties"]["can_commit"]["type"] == "boolean"
    assert commit.output_schema["properties"]["purchase_order_id"]["type"] == "integer"


def test_purchase_wire_results_match_declared_schemas(
    as_user, db_session, admin_user, default_company, catalogue
):
    import asyncio
    from mcp_server.server import mcp
    from schemas.mcp_purchase import PurchaseCommitResult, PurchasePreviewResult

    as_user(admin_user, default_company)
    tools = {tool.name: tool for tool in asyncio.run(mcp.list_tools())}
    preview = asyncio.run(tools["purchase_preview"].run({
        "supplier": "Ромашка",
        "items": [{"query": "New quinoa flakes zzzz", "quantity": "2,5", "unit_cost": "3,50"}],
    })).structured_content
    assert PurchasePreviewResult.model_validate(preview).total_amount == "8.75"
    committed = asyncio.run(tools["purchase_commit"].run({"draft_token": preview["draft_token"]})).structured_content
    assert PurchaseCommitResult.model_validate(committed).received is True
    replayed = asyncio.run(tools["purchase_commit"].run({"draft_token": preview["draft_token"]})).structured_content
    assert PurchaseCommitResult.model_validate(replayed).replayed is True

    db_session.add_all([
        Supplier(company_id=default_company.id, name=name, phone="123", is_active=True)
        for name in ("North Foods", "North Foods Import")
    ])
    db_session.flush()
    ambiguous = asyncio.run(tools["purchase_preview"].run({
        "supplier": "North", "items": [{"query": "New oats zzzz", "quantity": 1, "unit_cost": "3"}],
    })).structured_content
    parsed = PurchasePreviewResult.model_validate(ambiguous)
    assert parsed.can_commit is False and parsed.draft_token is None
    assert len(parsed.supplier_candidates) == 2
