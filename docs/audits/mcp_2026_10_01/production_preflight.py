"""Print deployment metadata only, using Railway-injected credentials."""

import json
import os
import sys

import psycopg2


try:
    connection = psycopg2.connect(
        os.environ["DATABASE_PUBLIC_URL"], connect_timeout=15,
        options="-c default_transaction_read_only=on -c statement_timeout=10000",
    )
    with connection, connection.cursor() as cursor:
        cursor.execute("SELECT version_num FROM alembic_version ORDER BY version_num")
        versions = [row[0] for row in cursor.fetchall()]
        cursor.execute("SELECT EXISTS (SELECT 1 FROM information_schema.columns "
                       "WHERE table_name='cash_shifts' AND column_name='opening_notes')")
        opening_notes = cursor.fetchone()[0]
    connection.close()
    print(json.dumps({"migrations": versions, "cash_shift_opening_notes": opening_notes}))
except Exception as exc:
    # Connection errors can include credentials. Print only the error class.
    print(json.dumps({"error_type": type(exc).__name__}))
    sys.exit(1)
