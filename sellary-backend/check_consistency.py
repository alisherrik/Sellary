"""Read-only: recompute every derived figure and print what disagrees.

Each check compares a cached or frozen figure against an independent recomputation —
a product balance against its FIFO layers, a sale total against its tenders, a closed
shift against today's arithmetic, a transfer against its other leg, a credit sale's
status against the customer ledger. Writes nothing.

Exits 1 when anything lands in the `drift` bucket, so it can gate a deploy; a `known`
finding (an offline oversell, say) is a recorded fact and does not fail the run.
"""

import argparse
import json
import sys
from datetime import datetime

from core.database import SessionLocal
from services.consistency_service import CHECKS, ConsistencyService


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--company", type=int, help="one tenant; omit for all of them")
    parser.add_argument(
        "--check",
        action="append",
        choices=[check.key for check in CHECKS],
        help="repeatable; omit to run every check",
    )
    parser.add_argument(
        "--since",
        type=lambda value: datetime.fromisoformat(value),
        help="ISO date; shift_totals walks every closed shift without it",
    )
    parser.add_argument("--json", action="store_true", dest="as_json")
    args = parser.parse_args()

    db = SessionLocal()
    try:
        if args.company is None:
            findings = ConsistencyService.run_all(db, keys=args.check, since=args.since)
        else:
            findings = ConsistencyService(db, args.company).run(keys=args.check, since=args.since)
    finally:
        db.close()

    if args.as_json:
        print(json.dumps([finding.__dict__ for finding in findings], ensure_ascii=False, indent=2))
    else:
        _print_table(findings)

    return 1 if any(finding.bucket == "drift" for finding in findings) else 0


def _print_table(findings) -> None:
    if not findings:
        print("Clean: every figure matches its source.")
        return

    drift = sum(1 for finding in findings if finding.bucket == "drift")
    print(f"{len(findings)} finding(s); {drift} drift, {len(findings) - drift} known.\n")
    print(f"{'company':>7} {'check':<22} {'subject':<40} {'expected':<24} {'actual':<24}")
    for finding in findings:
        note = f"  ({finding.note})" if finding.note else ""
        print(
            f"{finding.company_id:>7} {finding.check:<22} {finding.subject[:40]:<40} "
            f"{finding.expected[:24]:<24} {finding.actual[:24]:<24}{note}"
        )


if __name__ == "__main__":
    sys.exit(main())
