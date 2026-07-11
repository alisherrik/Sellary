"""C1/C2: customers.client_customer_id column, partial unique index, sync upsert."""
import pytest
from sqlalchemy.exc import IntegrityError

from models.customer import Customer


class TestClientCustomerIdIndex:
    def test_null_client_customer_ids_coexist(self, db_session, default_company):
        db_session.add(Customer(company_id=default_company.id, name="A", phone="p-a"))
        db_session.add(Customer(company_id=default_company.id, name="B", phone="p-b"))
        db_session.flush()  # two NULL client_customer_id rows are fine

    def test_duplicate_client_customer_id_in_company_collides(
        self, db_session, default_company
    ):
        db_session.add(
            Customer(
                company_id=default_company.id,
                name="A",
                phone="p-1",
                client_customer_id="cc-dup",
            )
        )
        db_session.flush()
        db_session.add(
            Customer(
                company_id=default_company.id,
                name="B",
                phone="p-2",
                client_customer_id="cc-dup",
            )
        )
        with pytest.raises(IntegrityError):
            db_session.flush()
        db_session.rollback()


from tests.conftest import create_auth_headers


def _headers(cashier_user, default_company):
    return create_auth_headers(
        cashier_user.username,
        cashier_user.id,
        default_company.id,
        cashier_user.role,
    )


def _customer_payload(client_customer_id, name, phone=None):
    item = {"client_customer_id": client_customer_id, "name": name}
    if phone is not None:
        item["phone"] = phone
    return {"customers": [item]}


class TestSyncCustomers:
    def test_create_new_customer_returns_server_id(
        self, client, db_session, default_company, cashier_user
    ):
        headers = _headers(cashier_user, default_company)
        resp = client.post(
            "/api/sync/customers",
            json=_customer_payload("cc-new-1", "Иван", "+99290100001"),
            headers=headers,
        )
        assert resp.status_code == 200
        result = resp.json()["results"][0]
        assert result["status"] == "synced"
        assert result["server_id"] is not None

        customer = db_session.get(Customer, result["server_id"])
        assert customer.client_customer_id == "cc-new-1"
        assert customer.name == "Иван"

    def test_replay_same_client_customer_id_is_duplicate(
        self, client, default_company, cashier_user
    ):
        headers = _headers(cashier_user, default_company)
        body = _customer_payload("cc-replay-1", "Пётр", "+99290100002")
        first = client.post("/api/sync/customers", json=body, headers=headers).json()
        second = client.post("/api/sync/customers", json=body, headers=headers).json()
        assert first["results"][0]["status"] == "synced"
        assert second["results"][0]["status"] == "duplicate"
        assert second["results"][0]["server_id"] == first["results"][0]["server_id"]

    def test_merge_by_phone_attaches_client_customer_id(
        self, client, db_session, default_company, cashier_user
    ):
        # A web-created customer (no client_customer_id) already exists.
        existing = Customer(
            company_id=default_company.id, name="Web", phone="+99290100003"
        )
        db_session.add(existing)
        db_session.flush()
        existing_id = existing.id

        headers = _headers(cashier_user, default_company)
        resp = client.post(
            "/api/sync/customers",
            json=_customer_payload("cc-merge-1", "Web", "+99290100003"),
            headers=headers,
        )
        result = resp.json()["results"][0]
        assert result["status"] == "synced"
        assert result["server_id"] == existing_id

        db_session.expire_all()
        assert db_session.get(Customer, existing_id).client_customer_id == "cc-merge-1"

    def test_batch_returns_one_result_per_customer(
        self, client, default_company, cashier_user
    ):
        headers = _headers(cashier_user, default_company)
        body = {
            "customers": [
                {"client_customer_id": "cc-b1", "name": "A", "phone": "+99290100010"},
                {"client_customer_id": "cc-b2", "name": "B", "phone": "+99290100011"},
            ]
        }
        results = client.post("/api/sync/customers", json=body, headers=headers).json()["results"]
        assert len(results) == 2
        assert {r["client_customer_id"] for r in results} == {"cc-b1", "cc-b2"}
        assert all(r["status"] == "synced" for r in results)
