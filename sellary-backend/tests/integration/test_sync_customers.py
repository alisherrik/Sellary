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
