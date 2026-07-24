from decimal import Decimal

from fastapi.testclient import TestClient


def with_idempotency(headers: dict, key: str) -> dict:
    return {**headers, "Idempotency-Key": key}


def credit_sale_payload(customer_id: int | None, product_id: int) -> dict:
    payload = {
        "customer_id": customer_id,
        "items": [
            {
                "product_id": product_id,
                "quantity": "2",
                "unit_price": "15.00",
                "tax_percent": "0.00",
                "discount_amount": "0.00",
            }
        ],
        "payment_method": "credit",
        "discount_amount": "0.00",
    }
    if customer_id is None:
        payload.pop("customer_id")
    return payload


def test_credit_sale_requires_customer_endpoint(
    client: TestClient,
    cashier_headers,
    test_product,
):
    response = client.post(
        "/api/sales",
        headers=with_idempotency(cashier_headers, "credit-no-customer-001"),
        json=credit_sale_payload(None, test_product.id),
    )

    assert response.status_code == 400
    assert "Customer is required" in response.json()["detail"]


def test_credit_sale_creates_customer_balance_and_ledger(
    client: TestClient,
    cashier_headers,
    test_customer,
    test_product,
):
    sale_response = client.post(
        "/api/sales",
        headers=with_idempotency(cashier_headers, "credit-sale-creates-ledger-001"),
        json=credit_sale_payload(test_customer.id, test_product.id),
    )

    assert sale_response.status_code == 201
    sale = sale_response.json()
    assert sale["payment_method"] == "credit"
    assert sale["payment_status"] == "unpaid"
    assert sale["credit_amount"] == "30.00"
    assert sale["credit_paid_amount"] == "0.00"
    assert sale["credit_remaining_amount"] == "30.00"

    customer_response = client.get(f"/api/customers/{test_customer.id}", headers=cashier_headers)
    assert customer_response.status_code == 200
    assert customer_response.json()["balance"] == "30.00"

    ledger_response = client.get(
        f"/api/customers/{test_customer.id}/ledger",
        headers=cashier_headers,
    )
    assert ledger_response.status_code == 200
    ledger = ledger_response.json()
    assert ledger["balance"] == "30.00"
    assert ledger["entries"][0]["entry_type"] == "credit_sale"
    assert ledger["entries"][0]["sale_id"] == sale["id"]


def test_credit_sale_accepts_initial_partial_payment(
    client: TestClient,
    cashier_headers,
    test_customer,
    test_product,
):
    sale_response = client.post(
        "/api/sales",
        headers=with_idempotency(cashier_headers, "credit-sale-initial-payment-001"),
        json={
            **credit_sale_payload(test_customer.id, test_product.id),
            "paid_amount": "10.00",
            "initial_payment_method": "cash",
        },
    )

    assert sale_response.status_code == 201
    sale = sale_response.json()
    assert sale["payment_method"] == "credit"
    assert sale["payment_status"] == "partial"
    assert sale["credit_amount"] == "30.00"
    assert sale["credit_paid_amount"] == "10.00"
    assert sale["credit_remaining_amount"] == "20.00"

    customer_response = client.get(f"/api/customers/{test_customer.id}", headers=cashier_headers)
    assert customer_response.status_code == 200
    assert customer_response.json()["balance"] == "20.00"

    ledger_response = client.get(
        f"/api/customers/{test_customer.id}/ledger",
        headers=cashier_headers,
    )
    assert ledger_response.status_code == 200
    ledger = ledger_response.json()
    assert ledger["balance"] == "20.00"
    assert [entry["entry_type"] for entry in ledger["entries"]] == ["credit_sale", "payment"]
    assert ledger["entries"][0]["amount"] == "30.00"
    assert ledger["entries"][1]["amount"] == "-10.00"
    assert ledger["entries"][1]["payment_method"] == "cash"
    assert ledger["entries"][1]["sale_id"] == sale["id"]


def test_customer_debt_payment_reduces_balance(
    client: TestClient,
    cashier_headers,
    test_customer,
    test_product,
):
    sale_response = client.post(
        "/api/sales",
        headers=with_idempotency(cashier_headers, "credit-sale-payment-001"),
        json=credit_sale_payload(test_customer.id, test_product.id),
    )
    assert sale_response.status_code == 201

    payment_response = client.post(
        f"/api/customers/{test_customer.id}/payments",
        headers=with_idempotency(cashier_headers, "credit-payment-001"),
        json={
            "amount": "10.00",
            "payment_method": "cash",
            "description": "Оплата долга",
        },
    )

    assert payment_response.status_code == 201
    assert payment_response.json()["balance"] == "20.00"

    sale_after_payment = client.get(
        f"/api/sales/{sale_response.json()['id']}",
        headers=cashier_headers,
    )
    assert sale_after_payment.status_code == 200
    assert sale_after_payment.json()["payment_status"] == "partial"
    assert sale_after_payment.json()["credit_paid_amount"] == "10.00"
    assert sale_after_payment.json()["credit_remaining_amount"] == "20.00"


def test_customer_payment_requires_idempotency_key(
    client: TestClient,
    cashier_headers,
    test_customer,
):
    response = client.post(
        f"/api/customers/{test_customer.id}/payments",
        headers=cashier_headers,
        json={"amount": "1.00", "payment_method": "cash"},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "Idempotency-Key header is required for this operation"


def test_credit_sale_return_reduces_customer_debt(
    client: TestClient,
    cashier_headers,
    manager_headers,
    test_customer,
    test_product,
):
    sale_response = client.post(
        "/api/sales",
        headers=with_idempotency(cashier_headers, "credit-sale-return-adjust-001"),
        json=credit_sale_payload(test_customer.id, test_product.id),
    )
    assert sale_response.status_code == 201
    sale = sale_response.json()

    # Returns are a manager-level (pos:manager) action.
    return_response = client.post(
        f"/api/sales/{sale['id']}/return",
        headers=with_idempotency(manager_headers, "credit-return-adjust-001"),
        json={
            "items": [{"sale_item_id": sale["items"][0]["id"], "quantity": "1"}],
            "refund_method": "cash",
        },
    )

    assert return_response.status_code == 201

    customer_response = client.get(f"/api/customers/{test_customer.id}", headers=cashier_headers)
    assert customer_response.status_code == 200
    assert customer_response.json()["balance"] == "15.00"

    sale_after_return = client.get(f"/api/sales/{sale['id']}", headers=cashier_headers)
    assert sale_after_return.status_code == 200
    assert sale_after_return.json()["credit_remaining_amount"] == "15.00"


def test_credit_sale_void_reduces_remaining_customer_debt(
    client: TestClient,
    cashier_headers,
    admin_headers,
    test_customer,
    test_product,
):
    sale_response = client.post(
        "/api/sales",
        headers=with_idempotency(cashier_headers, "credit-sale-void-adjust-001"),
        json=credit_sale_payload(test_customer.id, test_product.id),
    )
    assert sale_response.status_code == 201
    sale = sale_response.json()

    payment_response = client.post(
        f"/api/customers/{test_customer.id}/payments",
        headers=with_idempotency(cashier_headers, "credit-before-void-payment-001"),
        json={"amount": "10.00", "payment_method": "cash"},
    )
    assert payment_response.status_code == 201
    assert payment_response.json()["balance"] == "20.00"

    void_response = client.post(
        f"/api/sales/{sale['id']}/void",
        headers=with_idempotency(admin_headers, "credit-sale-void-adjust-001"),
        json={"reason": "Ошибочная продажа"},
    )

    assert void_response.status_code == 200

    customer_response = client.get(f"/api/customers/{test_customer.id}", headers=cashier_headers)
    assert customer_response.status_code == 200
    assert customer_response.json()["balance"] == "0.00"
