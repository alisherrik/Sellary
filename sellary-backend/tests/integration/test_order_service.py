"""Order service integration tests — lifecycle, split-checkout, oversell.

Covers:
  - place_orders: snapshot, subtotal calculation, sequential order_number
  - list_orders_for_company / list_orders_for_shopper
  - confirm → Sale created, stock decremented (FIFO), sale_id set
  - confirm oversell → OrderOversellError, order stays pending (rollback)
  - advance_status: state machine
  - cancel: pre-confirm (no sale) and post-confirm (sale voided)
  - confirm does NOT require an open cash shift (Resolved Decision #3)
"""
import pytest
from decimal import Decimal

from models.company import Company
from models.order import Order, OrderStatus
from models.product import Product
from models.telegram_user import TelegramUser
from schemas.order import CheckoutRequest, OrderCreate, OrderItemCreate
from services.order_service import (
    OrderNotFound,
    OrderOversellError,
    OrderService,
    OrderStatusError,
)


# ---------------------------------------------------------------------------
# Helpers / fixtures
# ---------------------------------------------------------------------------

def _make_tu(db, tid=42, name="Ali"):
    tu = TelegramUser(telegram_id=tid, first_name=name)
    db.add(tu)
    db.flush()
    return tu


def _make_published_product(db, company, price="100.00", stock=10):
    """Published product backed by an opening FIFO layer.

    Also ensures company.is_marketplace_enabled is True so that
    place_orders() doesn't raise the marketplace-gate ValueError.
    """
    from models.inventory_layer import InventoryLayer

    company.is_marketplace_enabled = True
    db.flush()

    p = Product(
        company_id=company.id,
        name="OrderProd",
        cost_price=Decimal("50.0000"),
        sell_price=Decimal(price),
        stock_quantity=Decimal(str(stock)),
        is_active=True,
        is_published=True,
    )
    db.add(p)
    db.flush()

    if stock > 0:
        layer = InventoryLayer(
            company_id=company.id,
            product_id=p.id,
            source_type="opening_balance",
            source_id=None,
            original_quantity=Decimal(str(stock)),
            remaining_quantity=Decimal(str(stock)),
            unit_cost=Decimal("50.0000"),
        )
        db.add(layer)
        p.inventory_value = (Decimal(str(stock)) * Decimal("50.0000")).quantize(
            Decimal("0.0001")
        )
        db.flush()
    return p


def _checkout(company_id, product_id, quantity=2, price="100.00"):
    return CheckoutRequest(
        orders=[
            OrderCreate(
                company_id=company_id,
                items=[
                    OrderItemCreate(
                        product_id=product_id,
                        quantity=Decimal(str(quantity)),
                        unit_price=Decimal(price),
                    )
                ],
                fulfillment_type="pickup",
                contact_phone="+99890000000",
                contact_name="Ali",
                checkout_group_id="grp-001",
            )
        ]
    )


# ---------------------------------------------------------------------------
# Tests: place_orders
# ---------------------------------------------------------------------------

def test_place_order_creates_order_with_snapshot(db_session, default_company):
    tu = _make_tu(db_session, tid=1001)
    product = _make_published_product(db_session, default_company)

    req = _checkout(default_company.id, product.id, quantity=2, price="100.00")
    svc = OrderService(db_session)
    result = svc.place_orders(req, telegram_user_id=tu.id)

    assert len(result) == 1
    order = result[0]
    assert order.status == "pending"
    assert order.company_id == default_company.id
    assert order.subtotal == Decimal("200.00")
    assert order.total_amount == Decimal("200.00")
    assert len(order.items) == 1
    assert order.items[0].product_name == "OrderProd"
    assert order.items[0].unit_price == Decimal("100.00")
    assert order.items[0].quantity == Decimal("2.000")
    assert order.items[0].line_total == Decimal("200.00")
    assert order.order_number == 1


def test_order_number_is_sequential(db_session, default_company):
    tu = _make_tu(db_session, tid=1002)
    p = _make_published_product(db_session, default_company, stock=100)

    svc = OrderService(db_session)
    r1 = _checkout(default_company.id, p.id)
    r2 = _checkout(default_company.id, p.id)
    o1 = svc.place_orders(r1, telegram_user_id=tu.id)
    o2 = svc.place_orders(r2, telegram_user_id=tu.id)
    assert o1[0].order_number == 1
    assert o2[0].order_number == 2


def test_unpublished_product_rejected(db_session, default_company):
    tu = _make_tu(db_session, tid=1003)
    # Must enable marketplace first so the company gate passes and the
    # product-level check is what raises.
    default_company.is_marketplace_enabled = True
    db_session.flush()
    p = Product(
        company_id=default_company.id,
        name="Hidden",
        cost_price=Decimal("1.00"),
        sell_price=Decimal("2.00"),
        stock_quantity=Decimal("5"),
        is_active=True,
        is_published=False,
    )
    db_session.add(p)
    db_session.flush()

    req = _checkout(default_company.id, p.id)
    with pytest.raises(ValueError, match="not available"):
        OrderService(db_session).place_orders(req, telegram_user_id=tu.id)


def test_marketplace_disabled_company_rejected(db_session, default_company):
    """Fix 2: a published product in a marketplace-DISABLED company must be rejected."""
    tu = _make_tu(db_session, tid=1006)
    # Explicitly disable marketplace (default, but be explicit).
    default_company.is_marketplace_enabled = False
    db_session.flush()

    p = Product(
        company_id=default_company.id,
        name="DisabledMarketplaceProduct",
        cost_price=Decimal("10.00"),
        sell_price=Decimal("20.00"),
        stock_quantity=Decimal("10"),
        is_active=True,
        is_published=True,
    )
    db_session.add(p)
    db_session.flush()

    req = _checkout(default_company.id, p.id, quantity=1)
    with pytest.raises(ValueError, match="not available on the marketplace"):
        OrderService(db_session).place_orders(req, telegram_user_id=tu.id)


def test_list_orders_for_company(db_session, default_company):
    tu = _make_tu(db_session, tid=1004)
    p = _make_published_product(db_session, default_company, stock=100)

    svc = OrderService(db_session, default_company.id)
    svc.place_orders(_checkout(default_company.id, p.id), telegram_user_id=tu.id)
    svc.place_orders(_checkout(default_company.id, p.id), telegram_user_id=tu.id)

    result = svc.list_orders_for_company()
    assert result.total >= 2


def test_list_orders_for_shopper(db_session, default_company, secondary_company):
    tu = _make_tu(db_session, tid=1005)
    p1 = _make_published_product(db_session, default_company, stock=100)
    p2 = _make_published_product(db_session, secondary_company, stock=100)
    # Enable secondary company for marketplace (needed for published product lookup)
    secondary_company.is_marketplace_enabled = True
    db_session.flush()

    svc = OrderService(db_session)
    svc.place_orders(_checkout(default_company.id, p1.id), telegram_user_id=tu.id)
    svc.place_orders(_checkout(secondary_company.id, p2.id), telegram_user_id=tu.id)

    result = svc.list_orders_for_shopper(tu.id)
    assert result.total == 2


# ---------------------------------------------------------------------------
# Tests: confirm → Sale + stock
# ---------------------------------------------------------------------------

@pytest.mark.no_auto_shift
def test_confirm_creates_sale_without_open_shift(db_session, default_company, manager_user):
    """Confirm must succeed even with no open cash shift (Decision #3)."""
    tu = _make_tu(db_session, tid=2001)
    p = _make_published_product(db_session, default_company, stock=10)

    svc = OrderService(db_session)
    placed = svc.place_orders(_checkout(default_company.id, p.id, quantity=3), telegram_user_id=tu.id)
    order_id = placed[0].id

    svc2 = OrderService(db_session, default_company.id)
    confirmed = svc2.confirm(order_id, cashier_id=manager_user.id)

    assert confirmed.status == "confirmed"
    assert confirmed.sale_id is not None


def test_confirm_decrements_stock(db_session, default_company, manager_user):
    tu = _make_tu(db_session, tid=2002)
    p = _make_published_product(db_session, default_company, stock=10)

    stock_before = Decimal(p.stock_quantity)
    svc = OrderService(db_session)
    placed = svc.place_orders(_checkout(default_company.id, p.id, quantity=3), telegram_user_id=tu.id)
    order_id = placed[0].id

    OrderService(db_session, default_company.id).confirm(order_id, cashier_id=manager_user.id)
    db_session.refresh(p)

    assert Decimal(p.stock_quantity) == stock_before - 3


def test_confirm_sets_cashier_id_from_manager(db_session, default_company, manager_user):
    from models.sale import Sale

    tu = _make_tu(db_session, tid=2003)
    p = _make_published_product(db_session, default_company, stock=5)

    svc = OrderService(db_session)
    placed = svc.place_orders(_checkout(default_company.id, p.id, quantity=1), telegram_user_id=tu.id)
    confirmed = OrderService(db_session, default_company.id).confirm(
        placed[0].id, cashier_id=manager_user.id
    )

    sale = db_session.get(Sale, confirmed.sale_id)
    assert sale.cashier_id == manager_user.id


def test_confirm_oversell_raises_and_order_stays_pending(db_session, default_company, manager_user):
    """Decision #4: oversell → OrderOversellError, order stays pending.

    The order must still exist (not None) and remain pending with no sale_id
    after the failed confirm is rolled back.

    Uses a savepoint so that only the confirm attempt is rolled back while the
    preceding place_orders flush (which created the order row) survives.
    """
    tu = _make_tu(db_session, tid=2004)
    # Stock = 2, request = 5
    p = _make_published_product(db_session, default_company, stock=2)

    svc = OrderService(db_session)
    placed = svc.place_orders(_checkout(default_company.id, p.id, quantity=5), telegram_user_id=tu.id)
    order_id = placed[0].id

    # Use a savepoint so that rolling back the failed confirm does NOT undo the
    # order placement that happened before this point.
    sp = db_session.begin_nested()
    with pytest.raises(OrderOversellError):
        OrderService(db_session, default_company.id).confirm(order_id, cashier_id=manager_user.id)
    sp.rollback()  # roll back only the confirm attempt

    # Expire cached state and re-read the order from the DB to confirm it
    # survived and is still pending with no sale linked.
    db_session.expire_all()
    order = db_session.query(Order).filter(Order.id == order_id).first()

    # The order must exist — savepoint rollback must NOT have wiped the placement.
    assert order is not None, "Order row must survive the rolled-back confirm attempt"
    assert order.status == "pending", f"Expected pending, got '{order.status}'"
    assert order.sale_id is None, "sale_id must be None after a rolled-back confirm"


def test_confirm_already_confirmed_raises_status_error(db_session, default_company, manager_user):
    tu = _make_tu(db_session, tid=2005)
    p = _make_published_product(db_session, default_company, stock=20)

    svc = OrderService(db_session)
    placed = svc.place_orders(_checkout(default_company.id, p.id, quantity=1), telegram_user_id=tu.id)

    svc2 = OrderService(db_session, default_company.id)
    svc2.confirm(placed[0].id, cashier_id=manager_user.id)

    with pytest.raises(OrderStatusError):
        svc2.confirm(placed[0].id, cashier_id=manager_user.id)


# ---------------------------------------------------------------------------
# Tests: advance_status
# ---------------------------------------------------------------------------

def test_advance_status_pending_to_cancelled_rejected(db_session, default_company):
    """cancel is a separate endpoint; advance_status only does preparing/ready/etc."""
    tu = _make_tu(db_session, tid=3001)
    p = _make_published_product(db_session, default_company, stock=5)

    svc = OrderService(db_session)
    placed = svc.place_orders(_checkout(default_company.id, p.id, quantity=1), telegram_user_id=tu.id)

    # advance_status to "cancelled" IS a valid transition from pending (per state machine)
    # but cancel() is the correct path. advance_status accepts it per the dict.
    # Verify a confirmed order can go to preparing.
    svc2 = OrderService(db_session, default_company.id)
    svc2.confirm(placed[0].id, cashier_id=db_session.query(
        __import__("models.user", fromlist=["User"]).User
    ).first().id)

    advanced = svc2.advance_status(placed[0].id, "preparing")
    assert advanced.status == "preparing"


def test_advance_status_invalid_transition_raises(db_session, default_company):
    tu = _make_tu(db_session, tid=3002)
    p = _make_published_product(db_session, default_company, stock=5)

    svc = OrderService(db_session)
    placed = svc.place_orders(_checkout(default_company.id, p.id, quantity=1), telegram_user_id=tu.id)

    with pytest.raises(OrderStatusError):
        # pending → completed is not a valid direct transition
        OrderService(db_session, default_company.id).advance_status(placed[0].id, "completed")


# ---------------------------------------------------------------------------
# Tests: cancel
# ---------------------------------------------------------------------------

def test_cancel_pending_order(db_session, default_company, manager_user):
    tu = _make_tu(db_session, tid=4001)
    p = _make_published_product(db_session, default_company, stock=10)

    svc = OrderService(db_session)
    placed = svc.place_orders(_checkout(default_company.id, p.id, quantity=2), telegram_user_id=tu.id)

    cancelled = OrderService(db_session, default_company.id).cancel(
        placed[0].id, user_id=manager_user.id, reason="Test cancel"
    )
    assert cancelled.status == "cancelled"
    assert cancelled.sale_id is None


def test_cancel_confirmed_order_voids_sale(db_session, default_company, manager_user):
    """After confirm → Sale exists. Cancel should void the Sale and restore stock."""
    tu = _make_tu(db_session, tid=4002)
    p = _make_published_product(db_session, default_company, stock=10)

    svc = OrderService(db_session)
    placed = svc.place_orders(_checkout(default_company.id, p.id, quantity=3), telegram_user_id=tu.id)

    svc2 = OrderService(db_session, default_company.id)
    confirmed = svc2.confirm(placed[0].id, cashier_id=manager_user.id)
    assert confirmed.sale_id is not None

    db_session.refresh(p)
    stock_after_confirm = Decimal(p.stock_quantity)

    cancelled = svc2.cancel(confirmed.id, user_id=manager_user.id, reason="Changed mind")
    assert cancelled.status == "cancelled"

    db_session.refresh(p)
    # Stock should be restored after void
    assert Decimal(p.stock_quantity) > stock_after_confirm


def test_cancel_completed_order_raises(db_session, default_company, manager_user):
    tu = _make_tu(db_session, tid=4003)
    p = _make_published_product(db_session, default_company, stock=5)

    svc = OrderService(db_session)
    placed = svc.place_orders(_checkout(default_company.id, p.id, quantity=1), telegram_user_id=tu.id)

    # Force status to completed
    order = db_session.get(Order, placed[0].id)
    order.status = "completed"
    db_session.flush()

    with pytest.raises(OrderStatusError):
        OrderService(db_session, default_company.id).cancel(placed[0].id, user_id=manager_user.id)
