"""Module-access enforcement on POS routers.

cashier fixture has pos:user (backfill); manager has all modules at manager.
"""


class TestPosModuleAccess:
    def test_no_grant_cannot_list_sales(self, client, no_module_headers):
        resp = client.get("/api/sales", headers=no_module_headers)
        assert resp.status_code == 403
        assert resp.json()["detail"]["code"] == "module_access_denied"

    def test_pos_user_can_list_sales(self, client, cashier_headers):
        assert client.get("/api/sales", headers=cashier_headers).status_code == 200

    def test_pos_user_cannot_cancel_sale(self, client, cashier_headers):
        resp = client.post(
            "/api/sales/999999/cancel",
            headers={**cashier_headers, "Idempotency-Key": "modtest-cancel-0001"},
            json={},
        )
        # 403 module check must fire BEFORE 404 lookup
        assert resp.status_code == 403

    def test_manager_cancel_reaches_lookup(self, client, manager_headers):
        resp = client.post(
            "/api/sales/999999/cancel",
            headers={**manager_headers, "Idempotency-Key": "modtest-cancel-0002"},
            json={"reason": "Тестовая отмена"},
        )
        assert resp.status_code == 404

    def test_no_grant_cannot_list_customers(self, client, no_module_headers):
        assert client.get("/api/customers", headers=no_module_headers).status_code == 403

    def test_no_grant_cannot_open_shift(self, client, no_module_headers):
        resp = client.post(
            "/api/shifts/open", headers=no_module_headers, json={"opening_cash": 0}
        )
        assert resp.status_code == 403
