"""Module-access enforcement on inventory routers (products, categories, inventory)."""


class TestInventoryModuleAccess:
    def test_no_grant_cannot_list_products(self, client, no_module_headers):
        assert client.get("/api/products", headers=no_module_headers).status_code == 403

    def test_cashier_pos_only_cannot_list_products(self, client, cashier_headers):
        # cashier backfill = pos:user only -> inventory closed
        assert client.get("/api/products", headers=cashier_headers).status_code == 403

    def test_inventory_user_can_list_products(
        self, client, cashier_user, default_company, grant_module, cashier_headers
    ):
        grant_module(cashier_user, default_company, "inventory", "user")
        assert client.get("/api/products", headers=cashier_headers).status_code == 200

    def test_inventory_user_cannot_adjust(
        self, client, cashier_user, default_company, grant_module, cashier_headers, test_product
    ):
        grant_module(cashier_user, default_company, "inventory", "user")
        resp = client.post(
            "/api/inventory/adjust",
            headers={**cashier_headers, "Idempotency-Key": "modtest-adjust-0001"},
            json={"product_id": test_product.id, "quantity_change": 1, "reason": "test"},
        )
        assert resp.status_code == 403

    def test_manager_can_adjust(self, client, manager_headers, test_product):
        resp = client.post(
            "/api/inventory/adjust",
            headers={**manager_headers, "Idempotency-Key": "modtest-adjust-0002"},
            json={"product_id": test_product.id, "quantity_change": 1, "reason": "test"},
        )
        assert resp.status_code in (200, 201)
