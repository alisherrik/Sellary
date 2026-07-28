"""Writing goods off the shelf.

The `layered_product` fixture holds 5 units across two FIFO layers — 2 @ 10
then 3 @ 20 — which is what makes the cost assertions meaningful: writing off 3
units must cost 2*10 + 1*20 = 40, not 3 * cost_price.
"""

from decimal import Decimal

from models.stock_write_off import StockWriteOff


def _headers(base, key="wo-key-1"):
    # The endpoint requires 16-64 characters, like every other mutating one.
    return {**base, "Idempotency-Key": f"write-off-test-{key}"}


def _payload(product_id, quantity="3", **over):
    body = {
        "disposition": "disposed",
        "reason_code": "spoiled",
        "items": [{"product_id": product_id, "quantity": quantity}],
    }
    body.update(over)
    return body


class TestWriteOffCreation:
    def test_cost_comes_from_the_fifo_layers_not_the_average(
        self, client, manager_headers, layered_product
    ):
        response = client.post(
            "/api/write-offs",
            json=_payload(layered_product.id, "3"),
            headers=_headers(manager_headers, "wo-fifo"),
        )
        assert response.status_code == 200, response.text
        body = response.json()
        assert Decimal(body["total_cost"]) == Decimal("40.0000")
        assert Decimal(body["items"][0]["quantity"]) == Decimal("3.000")
        assert body["reason_code"] == "spoiled"
        assert body["disposition"] == "disposed"

    def test_stock_falls_by_the_written_off_quantity(
        self, client, db_session, manager_headers, layered_product
    ):
        client.post(
            "/api/write-offs",
            json=_payload(layered_product.id, "3"),
            headers=_headers(manager_headers, "wo-stock"),
        )
        db_session.refresh(layered_product)
        assert Decimal(layered_product.stock_quantity) == Decimal("2")

    def test_writing_off_more_than_is_there_is_refused(
        self, client, manager_headers, layered_product
    ):
        response = client.post(
            "/api/write-offs",
            json=_payload(layered_product.id, "99"),
            headers=_headers(manager_headers, "wo-oversell"),
        )
        assert response.status_code == 400
        assert "Insufficient stock" in response.json()["detail"]

    def test_nothing_is_written_when_the_stock_is_short(
        self, client, db_session, manager_headers, layered_product
    ):
        client.post(
            "/api/write-offs",
            json=_payload(layered_product.id, "99"),
            headers=_headers(manager_headers, "wo-oversell-2"),
        )
        assert db_session.query(StockWriteOff).count() == 0

    def test_repeated_product_lines_are_merged(
        self, client, manager_headers, layered_product
    ):
        response = client.post(
            "/api/write-offs",
            json={
                "disposition": "disposed",
                "reason_code": "spoiled",
                "items": [
                    {"product_id": layered_product.id, "quantity": "1"},
                    {"product_id": layered_product.id, "quantity": "2"},
                ],
            },
            headers=_headers(manager_headers, "wo-merge"),
        )
        assert response.status_code == 200, response.text
        body = response.json()
        assert len(body["items"]) == 1
        assert Decimal(body["total_cost"]) == Decimal("40.0000")

    def test_an_empty_document_is_refused(self, client, manager_headers):
        response = client.post(
            "/api/write-offs",
            json={"disposition": "disposed", "reason_code": "spoiled", "items": []},
            headers=_headers(manager_headers, "wo-empty"),
        )
        assert response.status_code == 422

    def test_an_unknown_reason_is_refused(
        self, client, manager_headers, layered_product
    ):
        response = client.post(
            "/api/write-offs",
            json=_payload(layered_product.id, "1", reason_code="because"),
            headers=_headers(manager_headers, "wo-badreason"),
        )
        assert response.status_code == 422


class TestUnits:
    def test_a_pack_is_converted_to_base_units(
        self, client, db_session, manager_headers, layered_product
    ):
        from models.product_unit import ProductUnit

        pack = ProductUnit(
            product_id=layered_product.id,
            name="упак",
            factor=Decimal("2"),
            sell_price=Decimal("60"),
        )
        db_session.add(pack)
        db_session.flush()

        response = client.post(
            "/api/write-offs",
            json=_payload(
                layered_product.id, "1", items=[
                    {
                        "product_id": layered_product.id,
                        "product_unit_id": pack.id,
                        "quantity": "1",
                    }
                ]
            ),
            headers=_headers(manager_headers, "wo-unit"),
        )
        assert response.status_code == 200, response.text
        item = response.json()["items"][0]
        # One pack of two units, both from the 10-layer.
        assert Decimal(item["unit_quantity"]) == Decimal("1.000")
        assert Decimal(item["quantity"]) == Decimal("2.000")
        assert Decimal(item["line_cost"]) == Decimal("20.0000")


class TestSupplierReturn:
    def test_return_records_the_supplier(
        self, client, manager_headers, layered_product, test_supplier
    ):
        response = client.post(
            "/api/write-offs",
            json=_payload(
                layered_product.id,
                "1",
                disposition="returned_to_supplier",
                reason_code="defective",
                supplier_id=test_supplier.id,
            ),
            headers=_headers(manager_headers, "wo-return"),
        )
        assert response.status_code == 200, response.text
        assert response.json()["supplier_name"] == test_supplier.name

    def test_a_return_moves_no_money(
        self, client, db_session, manager_headers, layered_product, test_supplier
    ):
        from models.money_account import MoneyMovement

        before = db_session.query(MoneyMovement).count()
        client.post(
            "/api/write-offs",
            json=_payload(
                layered_product.id,
                "1",
                disposition="returned_to_supplier",
                reason_code="defective",
                supplier_id=test_supplier.id,
            ),
            headers=_headers(manager_headers, "wo-return-money"),
        )
        assert db_session.query(MoneyMovement).count() == before

    def test_return_without_a_supplier_is_refused(
        self, client, manager_headers, layered_product
    ):
        response = client.post(
            "/api/write-offs",
            json=_payload(
                layered_product.id, "1", disposition="returned_to_supplier"
            ),
            headers=_headers(manager_headers, "wo-nosupplier"),
        )
        assert response.status_code == 422

    def test_disposal_with_a_supplier_is_refused(
        self, client, manager_headers, layered_product, test_supplier
    ):
        response = client.post(
            "/api/write-offs",
            json=_payload(layered_product.id, "1", supplier_id=test_supplier.id),
            headers=_headers(manager_headers, "wo-strays"),
        )
        assert response.status_code == 422

    def test_another_companys_supplier_is_refused(
        self, client, db_session, manager_headers, layered_product, secondary_company
    ):
        from models.supplier import Supplier

        foreign = Supplier(
            company_id=secondary_company.id, name="Foreign", phone="+992000000"
        )
        db_session.add(foreign)
        db_session.flush()

        response = client.post(
            "/api/write-offs",
            json=_payload(
                layered_product.id,
                "1",
                disposition="returned_to_supplier",
                supplier_id=foreign.id,
            ),
            headers=_headers(manager_headers, "wo-foreign"),
        )
        assert response.status_code == 400


class TestIdempotency:
    def test_replay_returns_the_same_document_and_consumes_once(
        self, client, db_session, manager_headers, layered_product
    ):
        headers = _headers(manager_headers, "wo-replay")
        first = client.post(
            "/api/write-offs", json=_payload(layered_product.id, "2"), headers=headers
        )
        second = client.post(
            "/api/write-offs", json=_payload(layered_product.id, "2"), headers=headers
        )
        assert first.status_code == 200, first.text
        assert second.status_code == 200, second.text
        assert first.json()["id"] == second.json()["id"]
        assert db_session.query(StockWriteOff).count() == 1
        db_session.refresh(layered_product)
        assert Decimal(layered_product.stock_quantity) == Decimal("3")


class TestReads:
    def test_the_list_and_the_document_agree(
        self, client, manager_headers, layered_product
    ):
        created = client.post(
            "/api/write-offs",
            json=_payload(layered_product.id, "1"),
            headers=_headers(manager_headers, "wo-read"),
        ).json()

        listing = client.get("/api/write-offs", headers=manager_headers).json()
        assert listing["total"] == 1
        assert listing["items"][0]["id"] == created["id"]

        one = client.get(
            f"/api/write-offs/{created['id']}", headers=manager_headers
        ).json()
        assert one["items"][0]["product_id"] == layered_product.id

    def test_summary_splits_by_reason_and_disposition(
        self, client, manager_headers, layered_product, test_supplier
    ):
        client.post(
            "/api/write-offs",
            json=_payload(layered_product.id, "2", reason_code="spoiled"),
            headers=_headers(manager_headers, "wo-sum-1"),
        )
        client.post(
            "/api/write-offs",
            json=_payload(
                layered_product.id,
                "1",
                reason_code="defective",
                disposition="returned_to_supplier",
                supplier_id=test_supplier.id,
            ),
            headers=_headers(manager_headers, "wo-sum-2"),
        )

        summary = client.get(
            "/api/write-offs/summary", headers=manager_headers
        ).json()
        assert summary["document_count"] == 2
        # 2 units off the 10-layer, then 1 off the 20-layer.
        assert Decimal(summary["total_cost"]) == Decimal("40.0000")
        by_reason = {row["key"]: Decimal(row["total_cost"]) for row in summary["by_reason"]}
        assert by_reason == {"spoiled": Decimal("20.0000"), "defective": Decimal("20.0000")}
        by_disposition = {
            row["key"]: Decimal(row["total_cost"]) for row in summary["by_disposition"]
        }
        assert by_disposition == {
            "disposed": Decimal("20.0000"),
            "returned_to_supplier": Decimal("20.0000"),
        }

    def test_another_companys_documents_are_invisible(
        self, client, db_session, manager_headers, layered_product, secondary_company
    ):
        client.post(
            "/api/write-offs",
            json=_payload(layered_product.id, "1"),
            headers=_headers(manager_headers, "wo-tenant"),
        )
        other = (
            db_session.query(StockWriteOff)
            .filter(StockWriteOff.company_id == secondary_company.id)
            .count()
        )
        assert other == 0


class TestAccess:
    def test_a_plain_inventory_member_cannot_create(
        self,
        client,
        cashier_headers,
        cashier_user,
        default_company,
        grant_module,
        layered_product,
    ):
        grant_module(cashier_user, default_company, "inventory", "user")
        response = client.post(
            "/api/write-offs",
            json=_payload(layered_product.id, "1"),
            headers=_headers(cashier_headers, "wo-forbidden"),
        )
        assert response.status_code == 403

    def test_a_plain_inventory_member_can_read(
        self, client, cashier_headers, cashier_user, default_company, grant_module
    ):
        grant_module(cashier_user, default_company, "inventory", "user")
        assert client.get("/api/write-offs", headers=cashier_headers).status_code == 200

    def test_a_member_without_inventory_sees_nothing(self, client, cashier_headers):
        assert client.get("/api/write-offs", headers=cashier_headers).status_code == 403


class TestProfitReport:
    def test_write_off_cost_sits_beside_profit_not_inside_it(
        self, client, manager_headers, layered_product
    ):
        before = client.get("/api/reports/profit", headers=manager_headers).json()
        client.post(
            "/api/write-offs",
            json=_payload(layered_product.id, "3"),
            headers=_headers(manager_headers, "wo-profit"),
        )
        after = client.get("/api/reports/profit", headers=manager_headers).json()

        assert Decimal(after["profit"]) == Decimal(before["profit"])
        assert Decimal(after["write_off_cost"]) == Decimal("40.0000")
        assert Decimal(after["profit_after_write_offs"]) == Decimal(
            after["profit"]
        ) - Decimal("40.0000")
