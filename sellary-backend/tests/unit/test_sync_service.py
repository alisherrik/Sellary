"""
Unit tests for SyncService.
"""
import pytest
from datetime import datetime, timezone
from decimal import Decimal

from services.sync_service import SyncService
from models.category import Category as CategoryModel
from models.customer import Customer
from models.idempotency_key import IdempotencyKey
from models.product import Product
from models.sale import Sale
from models.user import User
from schemas.sync import (
    SyncSaleCreate,
    SyncSaleItemCreate,
    SyncSalesRequest,
)
from core.security import get_password_hash
from core.idempotency import IdempotencyService


class TestBootstrap:
    """Tests for sync bootstrap."""

    def test_bootstrap_returns_scoped_catalog(
        self, db_session, default_company, admin_user, test_product, test_category
    ):
        service = SyncService(db_session)
        result = service.bootstrap(default_company, admin_user)

        assert result.company_id == default_company.id
        assert result.company_name == default_company.name
        assert result.user_id == admin_user.id
        assert result.user_username == admin_user.username
        assert result.user_role == admin_user.role
        assert result.server_time is not None
        assert len(result.products) >= 1
        assert len(result.categories) >= 1

        product = result.products[0]
        assert product.id == test_product.id
        assert product.name == test_product.name
        assert product.sell_price == test_product.sell_price
        assert product.stock_quantity == test_product.stock_quantity

    def test_bootstrap_excludes_other_company_products(
        self, db_session, default_company, secondary_company, admin_user, test_product
    ):
        secondary_product = Product(
            company_id=secondary_company.id,
            name="Other Co Product",
            barcode="OTHER001",
            cost_price=Decimal("5.00"),
            sell_price=Decimal("10.00"),
            stock_quantity=50,
        )
        db_session.add(secondary_product)
        db_session.flush()

        service = SyncService(db_session)
        result = service.bootstrap(default_company, admin_user)

        product_ids = {p.id for p in result.products}
        assert secondary_product.id not in product_ids
        assert test_product.id in product_ids


class TestSyncSales:
    """Tests for sync sales processing."""

    def _make_sale(
        self,
        client_sale_id="offline-001",
        idempotency_key="ik-sync-001",
        product_id=1,
        quantity=2,
        sell_price=Decimal("15.00"),
        payment_method="cash",
        **kwargs,
    ) -> SyncSaleCreate:
        defaults = dict(
            client_sale_id=client_sale_id,
            idempotency_key=idempotency_key,
            created_at_client=datetime.now(timezone.utc),
            payment_method=payment_method,
            discount_amount=Decimal("0"),
            paid_amount=Decimal("30.00"),
            change_amount=Decimal("0"),
            items=[
                SyncSaleItemCreate(
                    product_id=product_id,
                    quantity=quantity,
                    sell_price=sell_price,
                )
            ],
        )
        defaults.update(kwargs)
        return SyncSaleCreate(**defaults)

    def _make_sync_request(self, **kwargs) -> SyncSalesRequest:
        return SyncSalesRequest(sales=[self._make_sale(**kwargs)])

    def test_synced_sale_creates_fifo_allocations_and_reduces_value(
        self, db_session, default_company, cashier_user, layered_product
    ):
        request = self._make_sync_request(
            product_id=layered_product.id,
            quantity=Decimal("3"),
            sell_price=Decimal("30.00"),
        )

        service = SyncService(db_session)
        result = service.sync_sales(default_company, cashier_user, request)

        r = result.results[0]
        assert r.status == "synced"

        from models.sale_item import SaleItem

        sale_item = db_session.query(SaleItem).filter_by(sale_id=r.sale_id).one()
        assert sum(a.quantity for a in sale_item.allocations) == Decimal("3")
        assert [a.layer.unit_cost for a in sale_item.allocations] == [
            Decimal("10.00"),
            Decimal("20.00"),
        ]
        assert sale_item.cost_total_at_sale == Decimal("40.00")

        db_session.refresh(layered_product)
        assert layered_product.inventory_value == Decimal("40.0000")

    def test_synced_sale_tolerates_unallocated_oversell(
        self, db_session, default_company, cashier_user, layered_product
    ):
        # C1: offline sales are immutable historical facts — a sync that
        # oversells (999 requested vs 5 available across two FIFO layers) is
        # recorded as "synced" with an oversell warning, driving stock
        # negative instead of being rejected.
        request = self._make_sync_request(
            product_id=layered_product.id,
            quantity=Decimal("999"),
            sell_price=Decimal("30.00"),
        )

        service = SyncService(db_session)
        result = service.sync_sales(default_company, cashier_user, request)

        r = result.results[0]
        assert r.status == "synced"
        assert r.error is None
        assert r.warnings is not None and len(r.warnings) == 1
        warning = r.warnings[0]
        assert warning.type == "oversell"
        assert warning.product_id == layered_product.id
        assert warning.requested == Decimal("999")
        assert warning.available == Decimal("5")
        assert warning.new_balance == Decimal("-994")

        db_session.refresh(layered_product)
        assert layered_product.stock_quantity == Decimal("-994")

    def test_synced_oversell_synced_regardless_of_flag_enabled(
        self, monkeypatch, db_session, default_company, cashier_user, layered_product
    ):
        # SYNC_ALLOW_OVERSELL is deprecated and no longer consulted: the sync
        # path tolerates oversell the same way whether the flag is True or
        # False.
        monkeypatch.setattr(
            "services.sync_service.settings.SYNC_ALLOW_OVERSELL", True
        )
        request = self._make_sync_request(
            product_id=layered_product.id,
            quantity=Decimal("999"),
            sell_price=Decimal("30.00"),
        )

        service = SyncService(db_session)
        result = service.sync_sales(default_company, cashier_user, request)

        r = result.results[0]
        assert r.status == "synced"
        assert r.warnings is not None and r.warnings[0].type == "oversell"
        db_session.refresh(layered_product)
        # Ledger tolerates oversell: stock goes negative rather than being
        # rejected, regardless of the (deprecated) flag value.
        assert layered_product.stock_quantity == Decimal("-994")

    def test_sync_creates_sale(
        self, db_session, default_company, cashier_user, test_product
    ):
        sale_create = self._make_sale(
            product_id=test_product.id,
            quantity=2,
            sell_price=test_product.sell_price,
        )

        service = SyncService(db_session)
        result = service.sync_sales(
            default_company, cashier_user,
            SyncSalesRequest(sales=[sale_create]),
        )

        assert len(result.results) == 1
        r = result.results[0]
        assert r.status == "synced"
        assert r.sale_id is not None
        assert r.error is None

        from models.sale import Sale
        sale = db_session.query(Sale).filter(Sale.id == r.sale_id).first()
        assert sale is not None
        assert sale.cashier_id == cashier_user.id
        assert sale.company_id == default_company.id
        assert sale.payment_method.value == "cash"
        assert sale.status.value == "completed"

    def test_sync_deducts_stock(
        self, db_session, default_company, cashier_user, test_product
    ):
        original_stock = test_product.stock_quantity

        sale_create = self._make_sale(
            product_id=test_product.id,
            quantity=5,
            sell_price=test_product.sell_price,
        )

        service = SyncService(db_session)
        service.sync_sales(
            default_company, cashier_user,
            SyncSalesRequest(sales=[sale_create]),
        )

        db_session.refresh(test_product)
        assert test_product.stock_quantity == original_stock - 5

    def test_sync_retry_is_idempotent(
        self, db_session, default_company, cashier_user, test_product
    ):
        sale_create = self._make_sale(
            client_sale_id="offline-002",
            idempotency_key="ik-sync-002",
            product_id=test_product.id,
            quantity=3,
            sell_price=test_product.sell_price,
        )
        request = SyncSalesRequest(sales=[sale_create])

        service = SyncService(db_session)
        result1 = service.sync_sales(default_company, cashier_user, request)
        db_session.flush()

        result2 = service.sync_sales(default_company, cashier_user, request)
        db_session.flush()

        assert result1.results[0].status == "synced"
        assert result2.results[0].status == "duplicate"
        assert result2.results[0].sale_id == result1.results[0].sale_id

        db_session.refresh(test_product)
        assert test_product.stock_quantity == 100 - 3

    def test_failed_sale_does_not_cache_and_can_succeed_after_customer_sync(
        self, db_session, default_company, cashier_user, test_product
    ):
        sale_create = self._make_sale(
            client_sale_id="offline-credit-retry",
            idempotency_key="ik-credit-retry-001",
            product_id=test_product.id,
            quantity=1,
            sell_price=test_product.sell_price,
            payment_method="credit",
            paid_amount=Decimal("0.00"),
            client_customer_id="offline-customer-retry",
        )
        request = SyncSalesRequest(sales=[sale_create])
        service = SyncService(db_session)

        failed = service.sync_sales(default_company, cashier_user, request)

        assert failed.results[0].status == "failed"
        assert "customer not synced" in failed.results[0].error.lower()
        assert (
            db_session.query(IdempotencyKey)
            .filter(IdempotencyKey.key == sale_create.idempotency_key)
            .count()
            == 0
        )

        db_session.add(
            Customer(
                company_id=default_company.id,
                client_customer_id=sale_create.client_customer_id,
                name="Offline retry customer",
                phone="+998900001234",
                is_active=True,
            )
        )
        db_session.flush()

        retried = service.sync_sales(default_company, cashier_user, request)

        assert retried.results[0].status == "synced"
        assert retried.results[0].sale_id is not None
        assert (
            db_session.query(Sale)
            .filter(
                Sale.company_id == default_company.id,
                Sale.client_sale_id == sale_create.client_sale_id,
            )
            .count()
            == 1
        )

    def test_legacy_null_sale_cache_is_reprocessed(
        self, db_session, default_company, cashier_user, test_product
    ):
        sale_create = self._make_sale(
            client_sale_id="offline-legacy-null",
            idempotency_key="ik-legacy-null-001",
            product_id=test_product.id,
            quantity=1,
            sell_price=test_product.sell_price,
        )
        IdempotencyService(db_session).store_response(
            key=sale_create.idempotency_key,
            company_id=default_company.id,
            user_id=cashier_user.id,
            endpoint="/api/sync/sales",
            request_body=sale_create.model_dump(),
            response_body={
                "sale_id": None,
                "client_sale_id": sale_create.client_sale_id,
            },
            status_code=201,
        )

        result = SyncService(db_session).sync_sales(
            default_company,
            cashier_user,
            SyncSalesRequest(sales=[sale_create]),
        )

        assert result.results[0].status == "synced"
        assert result.results[0].sale_id is not None
        assert (
            db_session.query(Sale)
            .filter(
                Sale.company_id == default_company.id,
                Sale.client_sale_id == sale_create.client_sale_id,
            )
            .count()
            == 1
        )

    def test_sync_oversell_is_tolerated_by_ledger(
        self, db_session, default_company, cashier_user, test_product
    ):
        # C1: a synced sale that exceeds available layer stock (200 requested
        # vs 100 available) is recorded as "synced" with an oversell warning
        # instead of being rejected — offline sales are immutable facts.
        sale_create = self._make_sale(
            product_id=test_product.id,
            quantity=200,
            sell_price=test_product.sell_price,
        )

        service = SyncService(db_session)
        result = service.sync_sales(
            default_company, cashier_user,
            SyncSalesRequest(sales=[sale_create]),
        )

        r = result.results[0]
        assert r.status == "synced"
        assert r.error is None
        assert r.warnings is not None and len(r.warnings) == 1
        warning = r.warnings[0]
        assert warning.type == "oversell"
        assert warning.product_id == test_product.id
        assert warning.requested == Decimal("200")
        assert warning.available == Decimal("100")
        assert warning.new_balance == Decimal("-100")

        db_session.refresh(test_product)
        assert test_product.stock_quantity == Decimal("-100")

    def test_sync_sale_tolerates_oversell_when_flag_disabled(
        self, monkeypatch, db_session, default_company, cashier_user, layered_product
    ):
        # SYNC_ALLOW_OVERSELL is deprecated and no longer consulted by the
        # sync path: oversell is tolerated even with the flag explicitly off.
        monkeypatch.setattr("services.sync_service.settings.SYNC_ALLOW_OVERSELL", False)

        sale_create = self._make_sale(
            client_sale_id="client-oversell",
            idempotency_key="oversell-key-0001",
            product_id=layered_product.id,
            quantity=6,  # only 5 units across layers
            sell_price=Decimal("30.00"),
            paid_amount=Decimal("200.00"),
        )

        service = SyncService(db_session)
        result = service.sync_sales(
            default_company, cashier_user,
            SyncSalesRequest(sales=[sale_create]),
        )

        r = result.results[0]
        assert r.status == "synced"
        assert r.error is None
        assert r.warnings is not None and len(r.warnings) == 1
        warning = r.warnings[0]
        assert warning.type == "oversell"
        assert warning.product_id == layered_product.id
        assert warning.requested == Decimal("6")
        assert warning.available == Decimal("5")
        assert warning.new_balance == Decimal("-1")
        db_session.refresh(layered_product)
        assert layered_product.stock_quantity == Decimal("-1")

    def test_sync_sale_duplicate_product_oversell_tolerated(
        self, monkeypatch, db_session, default_company, cashier_user, layered_product
    ):
        monkeypatch.setattr("services.sync_service.settings.SYNC_ALLOW_OVERSELL", False)

        sale_create = SyncSaleCreate(
            client_sale_id="client-dup-oversell",
            idempotency_key="dup-oversell-key-0001",
            created_at_client=datetime.now(timezone.utc),
            payment_method="cash",
            discount_amount=Decimal("0"),
            paid_amount=Decimal("200.00"),
            change_amount=Decimal("0"),
            items=[
                SyncSaleItemCreate(
                    product_id=layered_product.id,
                    quantity=3,
                    sell_price=Decimal("30.00"),
                ),
                SyncSaleItemCreate(
                    product_id=layered_product.id,
                    quantity=3,  # 3 + 3 = 6 > 5 available
                    sell_price=Decimal("30.00"),
                ),
            ],
        )

        service = SyncService(db_session)
        result = service.sync_sales(
            default_company, cashier_user,
            SyncSalesRequest(sales=[sale_create]),
        )

        r = result.results[0]
        assert r.status == "synced"
        assert r.error is None
        # First line (3 units) is fully allocated from FIFO layers with no
        # shortfall; the second line (3 units, only 2 remain) oversells by 1
        # and is the only one that produces a warning.
        assert r.warnings is not None and len(r.warnings) == 1
        warning = r.warnings[0]
        assert warning.type == "oversell"
        assert warning.product_id == layered_product.id
        assert warning.requested == Decimal("3")
        assert warning.available == Decimal("2")
        assert warning.new_balance == Decimal("-1")
        db_session.refresh(layered_product)
        assert layered_product.stock_quantity == Decimal("-1")

    def test_sync_sale_oversell_tolerated_even_when_flag_enabled(
        self, monkeypatch, db_session, default_company, cashier_user, layered_product
    ):
        # The SYNC_ALLOW_OVERSELL flag no longer changes ledger behavior:
        # an oversell is tolerated the same way whether the flag is True or
        # False.
        monkeypatch.setattr("services.sync_service.settings.SYNC_ALLOW_OVERSELL", True)

        sale_create = self._make_sale(
            client_sale_id="client-allow",
            idempotency_key="allow-key-0001",
            product_id=layered_product.id,
            quantity=6,  # only 5 units across layers
            sell_price=Decimal("30.00"),
            paid_amount=Decimal("200.00"),
        )

        service = SyncService(db_session)
        result = service.sync_sales(
            default_company, cashier_user,
            SyncSalesRequest(sales=[sale_create]),
        )

        r = result.results[0]
        assert r.status == "synced"
        assert r.error is None
        assert r.warnings is not None and len(r.warnings) == 1
        warning = r.warnings[0]
        assert warning.type == "oversell"
        assert warning.product_id == layered_product.id
        assert warning.requested == Decimal("6")
        assert warning.available == Decimal("5")
        assert warning.new_balance == Decimal("-1")
        db_session.refresh(layered_product)
        assert layered_product.stock_quantity == Decimal("-1")

    def test_sync_missing_product_fails(
        self, db_session, default_company, cashier_user
    ):
        sale_create = self._make_sale(
            client_sale_id="offline-missing",
            idempotency_key="ik-missing",
            product_id=99999,
            quantity=1,
        )

        service = SyncService(db_session)
        result = service.sync_sales(
            default_company, cashier_user,
            SyncSalesRequest(sales=[sale_create]),
        )

        r = result.results[0]
        assert r.status == "failed"
        assert "not found" in r.error.lower()

    def test_sync_invalid_payment_method_fails(
        self, db_session, default_company, cashier_user, test_product
    ):
        sale_create = self._make_sale(
            product_id=test_product.id,
            payment_method="bitcoin",
        )

        service = SyncService(db_session)
        result = service.sync_sales(
            default_company, cashier_user,
            SyncSalesRequest(sales=[sale_create]),
        )

        r = result.results[0]
        assert r.status == "failed"
        assert "payment_method" in r.error.lower()

    def test_sync_card_without_card_type_fails(
        self, db_session, default_company, cashier_user, test_product
    ):
        sale_create = self._make_sale(
            product_id=test_product.id,
            payment_method="card",
            card_type=None,
        )

        service = SyncService(db_session)
        result = service.sync_sales(
            default_company, cashier_user,
            SyncSalesRequest(sales=[sale_create]),
        )

        r = result.results[0]
        assert r.status == "failed"
        assert "card_type" in r.error.lower()

    def test_sync_empty_items_fails(
        self, db_session, default_company, cashier_user
    ):
        sale_create = SyncSaleCreate(
            client_sale_id="offline-empty",
            idempotency_key="ik-empty",
            created_at_client=datetime.now(timezone.utc),
            payment_method="cash",
            discount_amount=Decimal("0"),
            paid_amount=Decimal("0"),
            change_amount=Decimal("0"),
            items=[],
        )

        service = SyncService(db_session)
        result = service.sync_sales(
            default_company, cashier_user,
            SyncSalesRequest(sales=[sale_create]),
        )

        r = result.results[0]
        assert r.status == "failed"
        assert "at least one item" in r.error.lower()

    def test_sync_creates_inventory_log(
        self, db_session, default_company, cashier_user, test_product
    ):
        sale_create = self._make_sale(
            product_id=test_product.id,
            quantity=3,
            sell_price=test_product.sell_price,
        )

        service = SyncService(db_session)
        result = service.sync_sales(
            default_company, cashier_user,
            SyncSalesRequest(sales=[sale_create]),
        )

        from models.inventory_log import InventoryLog
        logs = (
            db_session.query(InventoryLog)
            .filter(InventoryLog.product_id == test_product.id)
            .all()
        )
        assert len(logs) == 1
        assert logs[0].quantity_change == -3
        assert logs[0].previous_quantity == 100
        assert logs[0].new_quantity == 97
        assert logs[0].reference_type == "sale"
        assert logs[0].reference_id == result.results[0].sale_id

    def test_sync_batch_multiple_sales(
        self, db_session, default_company, cashier_user, test_product
    ):
        sale1 = self._make_sale(
            client_sale_id="batch-001",
            idempotency_key="ik-batch-001",
            product_id=test_product.id,
            quantity=2,
            sell_price=test_product.sell_price,
        )
        sale2 = self._make_sale(
            client_sale_id="batch-002",
            idempotency_key="ik-batch-002",
            product_id=test_product.id,
            quantity=3,
            sell_price=test_product.sell_price,
        )

        service = SyncService(db_session)
        result = service.sync_sales(
            default_company, cashier_user,
            SyncSalesRequest(sales=[sale1, sale2]),
        )

        assert len(result.results) == 2
        assert result.results[0].status == "synced"
        assert result.results[1].status == "synced"
        assert result.results[0].sale_id != result.results[1].sale_id

        db_session.refresh(test_product)
        assert test_product.stock_quantity == 95

    def test_sync_batch_second_fails_first_succeeds(
        self, db_session, default_company, cashier_user, test_product
    ):
        sale1 = self._make_sale(
            client_sale_id="batch-ok",
            idempotency_key="ik-batch-ok",
            product_id=test_product.id,
            quantity=1,
        )
        sale2 = self._make_sale(
            client_sale_id="batch-bad",
            idempotency_key="ik-batch-bad",
            product_id=99999,
            quantity=1,
        )

        service = SyncService(db_session)
        result = service.sync_sales(
            default_company, cashier_user,
            SyncSalesRequest(sales=[sale1, sale2]),
        )

        assert len(result.results) == 2
        assert result.results[0].status == "synced"
        assert result.results[1].status == "failed"

    def test_sync_calculates_totals(
        self, db_session, default_company, cashier_user, test_product
    ):
        sale_create = self._make_sale(
            product_id=test_product.id,
            quantity=3,
            sell_price=Decimal("20.00"),
            discount_amount=Decimal("5.00"),
        )

        service = SyncService(db_session)
        result = service.sync_sales(
            default_company, cashier_user,
            SyncSalesRequest(sales=[sale_create]),
        )

        from models.sale import Sale
        sale = db_session.query(Sale).filter(
            Sale.id == result.results[0].sale_id
        ).first()
        assert sale.subtotal == Decimal("60.00")
        assert sale.tax_amount == Decimal("6.00")
        assert sale.discount_amount == Decimal("5.00")
        assert sale.total_amount == Decimal("61.00")

    def test_sync_with_card_payment(
        self, db_session, default_company, cashier_user, test_product
    ):
        sale_create = self._make_sale(
            product_id=test_product.id,
            payment_method="card",
            card_type="alif",
        )

        service = SyncService(db_session)
        result = service.sync_sales(
            default_company, cashier_user,
            SyncSalesRequest(sales=[sale_create]),
        )

        r = result.results[0]
        assert r.status == "synced"

        from models.sale import Sale
        sale = db_session.query(Sale).filter(Sale.id == r.sale_id).first()
        assert sale.payment_method.value == "card"
        assert sale.card_type.value == "alif"

    def test_sync_preserves_client_timestamp(
        self, db_session, default_company, cashier_user, test_product
    ):
        client_time = datetime(2026, 5, 1, 10, 30, 0)

        sale_create = self._make_sale(
            product_id=test_product.id,
            created_at_client=client_time,
        )

        service = SyncService(db_session)
        result = service.sync_sales(
            default_company, cashier_user,
            SyncSalesRequest(sales=[sale_create]),
        )

        from models.sale import Sale
        sale = db_session.query(Sale).filter(
            Sale.id == result.results[0].sale_id
        ).first()
        assert sale.created_at == client_time
