"""C3: GET /api/sync/bootstrap ships active customers with derived balances."""
from decimal import Decimal

from models.customer import Customer
from models.customer_ledger_entry import CustomerLedgerEntry
from tests.conftest import create_auth_headers


def _headers(cashier_user, default_company):
    return create_auth_headers(
        cashier_user.username,
        cashier_user.id,
        default_company.id,
        cashier_user.role,
    )


def test_bootstrap_includes_active_customer_with_balance(
    client, db_session, default_company, cashier_user
):
    customer = Customer(
        company_id=default_company.id,
        name="Должник",
        phone="+99290200001",
        client_customer_id="cc-boot-1",
    )
    db_session.add(customer)
    db_session.flush()
    # A raw credit_sale ledger entry gives a derived balance of 30.00.
    db_session.add(
        CustomerLedgerEntry(
            company_id=default_company.id,
            customer_id=customer.id,
            sale_id=None,
            entry_type="credit_sale",
            amount=Decimal("30.00"),
            created_by_user_id=cashier_user.id,
        )
    )
    db_session.flush()

    resp = client.get(
        "/api/sync/bootstrap", headers=_headers(cashier_user, default_company)
    )
    assert resp.status_code == 200
    customers = resp.json()["customers"]
    match = [c for c in customers if c["client_customer_id"] == "cc-boot-1"]
    assert len(match) == 1
    assert match[0]["balance"] == "30.00"
    assert match[0]["name"] == "Должник"
    assert match[0]["is_active"] is True


def test_bootstrap_excludes_inactive_customers(
    client, db_session, default_company, cashier_user
):
    inactive = Customer(
        company_id=default_company.id,
        name="Ушёл",
        phone="+99290200002",
        is_active=False,
    )
    db_session.add(inactive)
    db_session.flush()

    resp = client.get(
        "/api/sync/bootstrap", headers=_headers(cashier_user, default_company)
    )
    names = [c["name"] for c in resp.json()["customers"]]
    assert "Ушёл" not in names
