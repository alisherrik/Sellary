"""Recover earlier takings excluded by lazy system-account creation.

Only untouched zero-opening system accounts are identifiable. Accounts with
movements, explicit anchors, counted shifts or reconciliations require review:
moving their anchor could count money already included by a physical count.

Revision ID: f9a0b1c2d3e4
Revises: 3de347509835
Create Date: 2026-10-01 16:00:00
"""
from alembic import op
from datetime import timezone
import sqlalchemy as sa

revision = "f9a0b1c2d3e4"
down_revision = "3de347509835"
branch_labels = None
depends_on = None


def upgrade():
    conn = op.get_bind()
    metadata = sa.MetaData()
    accounts = sa.Table("money_accounts", metadata, autoload_with=conn)
    movements = sa.Table("money_movements", metadata, autoload_with=conn)
    freezes = sa.Table("company_reconciliations", metadata, autoload_with=conn)
    shifts = sa.Table("cash_shifts", metadata, autoload_with=conn)
    companies = sa.Table("companies", metadata, autoload_with=conn)
    documents = [sa.Table(name, metadata, autoload_with=conn) for name in (
        "sales", "sale_returns", "customer_ledger_entries",
    )]
    untouched = sa.select(accounts.c.id, accounts.c.company_id, accounts.c.opening_at).where(
        accounts.c.opening_balance == 0,
        accounts.c.opening_at == accounts.c.created_at,
        sa.or_(accounts.c.is_till.is_(True), accounts.c.card_type.is_not(None),
               accounts.c.is_other_noncash.is_(True)),
        ~sa.exists(sa.select(movements.c.id).where(movements.c.account_id == accounts.c.id)),
        ~sa.exists(sa.select(freezes.c.id).where(freezes.c.company_id == accounts.c.company_id)),
        # A counted drawer has an independent opening fact that this migration
        # must not replace with a zero opening balance.
        sa.or_(accounts.c.is_till.is_(False), ~sa.exists(
            sa.select(shifts.c.id).where(shifts.c.company_id == accounts.c.company_id)
        )),
    )

    def as_utc(moment):
        return moment.astimezone(timezone.utc) if moment.tzinfo else moment.replace(tzinfo=timezone.utc)

    for account_id, company_id, opening_at in conn.execute(untouched).all():
        recorded = [conn.execute(sa.select(sa.func.min(table.c.created_at)).where(
            table.c.company_id == company_id
        )).scalar() for table in documents]
        recorded = [as_utc(moment) for moment in recorded if moment is not None]
        if not recorded or min(recorded) >= as_utc(opening_at):
            continue
        company_created = conn.execute(sa.select(companies.c.created_at).where(
            companies.c.id == company_id
        )).scalar()
        if company_created is not None:
            recorded.append(as_utc(company_created))
        conn.execute(sa.update(accounts).where(accounts.c.id == account_id).values(
            opening_at=min(recorded)
        ))


def downgrade():
    # Reintroducing the missing-money bug would corrupt the recovered balance.
    pass
