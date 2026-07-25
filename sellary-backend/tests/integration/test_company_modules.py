"""Company-level module enablement: storage, enforcement, session shape, owner API."""

from models.company_module import CompanyModule
from repositories.company_module_repository import CompanyModuleRepository


def _disable(db_session, company_id: int, module: str) -> None:
    db_session.query(CompanyModule).filter(
        CompanyModule.company_id == company_id,
        CompanyModule.module == module,
    ).delete(synchronize_session=False)
    db_session.flush()


class TestCompanyModuleRepository:
    def test_set_modules_replaces_the_whole_set(self, db_session, default_company):
        repo = CompanyModuleRepository(db_session)
        repo.set_modules(default_company.id, ["inventory", "shop"])
        db_session.flush()
        assert repo.enabled_modules(default_company.id) == ["inventory", "shop"]

        repo.set_modules(default_company.id, ["reports"])
        db_session.flush()
        assert repo.enabled_modules(default_company.id) == ["reports"]

    def test_has_module_is_true_only_for_enabled(self, db_session, default_company):
        repo = CompanyModuleRepository(db_session)
        repo.set_modules(default_company.id, ["inventory"])
        db_session.flush()
        assert repo.has_module(default_company.id, "inventory") is True
        assert repo.has_module(default_company.id, "shop") is False

    def test_set_modules_rejects_an_unknown_module(self, db_session, default_company):
        repo = CompanyModuleRepository(db_session)
        try:
            repo.set_modules(default_company.id, ["inventory", "teleportation"])
        except ValueError as exc:
            assert "teleportation" in str(exc)
        else:
            raise AssertionError("expected ValueError for an unknown module")

    def test_enabled_modules_returns_registry_order(self, db_session, default_company):
        repo = CompanyModuleRepository(db_session)
        repo.set_modules(default_company.id, ["reports", "inventory", "register"])
        db_session.flush()
        assert repo.enabled_modules(default_company.id) == ["register", "inventory", "reports"]


class TestCompanyModuleEnforcement:
    def test_company_without_module_blocks_a_granted_user(
        self, client, db_session, default_company, manager_headers
    ):
        _disable(db_session, default_company.id, "inventory")
        resp = client.get("/api/products", headers=manager_headers)
        assert resp.status_code == 403
        assert resp.json()["detail"]["code"] == "module_not_enabled"
        assert resp.json()["detail"]["module"] == "inventory"

    def test_company_without_module_blocks_the_admin_too(
        self, client, db_session, default_company, admin_headers
    ):
        # The admin bypass covers the membership layer only. A company that did
        # not buy a module must be closed to its own admin.
        _disable(db_session, default_company.id, "inventory")
        resp = client.get("/api/products", headers=admin_headers)
        assert resp.status_code == 403
        assert resp.json()["detail"]["code"] == "module_not_enabled"

    def test_company_with_module_still_needs_the_membership_grant(
        self, client, no_module_headers
    ):
        # Regression: the company layer must not open anything on its own.
        resp = client.get("/api/products", headers=no_module_headers)
        assert resp.status_code == 403
        assert resp.json()["detail"]["code"] == "module_access_denied"


class TestSessionModuleShape:
    def test_session_drops_modules_the_company_lost(
        self, client, db_session, default_company, manager_headers
    ):
        _disable(db_session, default_company.id, "shop")
        body = client.get("/api/auth/me", headers=manager_headers).json()

        assert "shop" not in body["company_modules"]
        # The manager fixture is granted every module, but the company no
        # longer has shop — the intersection must drop it.
        assert "shop" not in body["modules"]
        assert body["modules"]["inventory"] == "manager"

    def test_admin_gets_manager_on_exactly_the_company_modules(
        self, client, db_session, default_company, admin_headers
    ):
        _disable(db_session, default_company.id, "purchasing")
        body = client.get("/api/auth/me", headers=admin_headers).json()

        assert "purchasing" not in body["modules"]
        assert "purchasing" not in body["company_modules"]
        assert body["modules"]["inventory"] == "manager"


class TestOwnerCompanyModuleEndpoints:
    def test_owner_reads_and_replaces_the_module_set(
        self, client, owner_headers, default_company
    ):
        resp = client.put(
            f"/api/owner/companies/{default_company.id}/modules",
            headers=owner_headers,
            json={"business_type": "online", "modules": ["inventory", "shop", "sales"]},
        )
        assert resp.status_code == 200
        assert resp.json()["modules"] == ["sales", "inventory", "shop"]  # registry order
        assert resp.json()["business_type"] == "online"

        read = client.get(
            f"/api/owner/companies/{default_company.id}/modules", headers=owner_headers
        )
        assert read.json()["modules"] == ["sales", "inventory", "shop"]

    def test_company_admin_cannot_touch_company_modules(
        self, client, admin_headers, default_company
    ):
        resp = client.get(
            f"/api/owner/companies/{default_company.id}/modules", headers=admin_headers
        )
        assert resp.status_code in (401, 403)

    def test_unknown_module_is_rejected(self, client, owner_headers, default_company):
        resp = client.put(
            f"/api/owner/companies/{default_company.id}/modules",
            headers=owner_headers,
            json={"modules": ["inventory", "teleportation"]},
        )
        assert resp.status_code == 422

    def test_creating_a_company_applies_the_business_type_preset(
        self, client, owner_headers
    ):
        resp = client.post(
            "/api/owner/companies",
            headers=owner_headers,
            json={"name": "Онлайн Магазин", "business_type": "online"},
        )
        assert resp.status_code == 201
        company_id = resp.json()["id"]

        read = client.get(
            f"/api/owner/companies/{company_id}/modules", headers=owner_headers
        )
        assert read.json()["modules"] == [
            "sales",
            "customers",
            "inventory",
            "shop",
            "reports",
        ]
        assert "register" not in read.json()["modules"]

    def test_creating_a_company_without_a_type_enables_nothing(
        self, client, owner_headers
    ):
        resp = client.post(
            "/api/owner/companies", headers=owner_headers, json={"name": "Пустая"}
        )
        company_id = resp.json()["id"]
        read = client.get(
            f"/api/owner/companies/{company_id}/modules", headers=owner_headers
        )
        assert read.json()["modules"] == []


class TestMembershipGrantIsBoundedByTheCompany:
    def test_admin_cannot_grant_a_module_the_company_lacks(
        self, client, admin_headers, db_session, default_company, cashier_user
    ):
        from models.company_membership import CompanyMembership

        _disable(db_session, default_company.id, "shop")
        membership = (
            db_session.query(CompanyMembership)
            .filter(
                CompanyMembership.user_id == cashier_user.id,
                CompanyMembership.company_id == default_company.id,
            )
            .first()
        )
        resp = client.put(
            f"/api/admin/memberships/{membership.id}/modules",
            headers=admin_headers,
            json={"modules": {"shop": "user"}},
        )
        assert resp.status_code == 400
        assert "shop" in resp.json()["detail"]
