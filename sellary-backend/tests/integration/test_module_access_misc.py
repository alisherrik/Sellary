"""Module-access enforcement on purchasing / shop-orders / reports routers."""


class TestPurchasingModuleAccess:
    def test_no_grant_cannot_list_suppliers(self, client, no_module_headers):
        assert client.get("/api/suppliers", headers=no_module_headers).status_code == 403

    def test_purchasing_user_can_list_pos(
        self, client, cashier_user, default_company, grant_module, cashier_headers
    ):
        grant_module(cashier_user, default_company, "purchasing", "user")
        assert client.get("/api/purchase-orders", headers=cashier_headers).status_code == 200

    def test_purchasing_user_cannot_receive(
        self, client, cashier_user, default_company, grant_module, cashier_headers
    ):
        grant_module(cashier_user, default_company, "purchasing", "user")
        resp = client.post(
            "/api/purchase-orders/999999/receive",
            headers={**cashier_headers, "Idempotency-Key": "modtest-receive-0001"},
            json={},
        )
        assert resp.status_code == 403


class TestShopOrdersModuleAccess:
    def test_no_grant_cannot_list_orders(self, client, no_module_headers):
        assert client.get("/api/orders", headers=no_module_headers).status_code == 403

    def test_shop_user_can_list_orders(
        self, client, cashier_user, default_company, grant_module, cashier_headers
    ):
        grant_module(cashier_user, default_company, "shop", "user")
        assert client.get("/api/orders", headers=cashier_headers).status_code == 200

    def test_shop_user_cannot_cancel(
        self, client, cashier_user, default_company, grant_module, cashier_headers
    ):
        grant_module(cashier_user, default_company, "shop", "user")
        resp = client.post(
            "/api/orders/999999/cancel",
            headers=cashier_headers,
            json={"reason": "test"},
        )
        assert resp.status_code == 403


class TestReportsModuleAccess:
    def test_no_grant_cannot_read_reports(self, client, no_module_headers):
        assert client.get("/api/reports/dashboard", headers=no_module_headers).status_code == 403

    def test_reports_user_can_read(
        self, client, cashier_user, default_company, grant_module, cashier_headers
    ):
        grant_module(cashier_user, default_company, "reports", "user")
        assert client.get("/api/reports/dashboard", headers=cashier_headers).status_code == 200
