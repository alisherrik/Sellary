"""Fail the build when railway.toml's alembic pin is no longer a head.

Railway runs `alembic upgrade <revision>` as its preDeployCommand, pinned to a
specific revision rather than `head` because this repository has two heads and
`head` would be ambiguous.

The cost of that pin is silence: add a migration, forget the pin, and the deploy
still succeeds while the schema stays behind. The application then expects a
column the database does not have.

This check closes that gap without touching a database. It parses the migration
files, computes which revisions are heads, and fails if the pinned one is not
among them — which is exactly what happens the moment someone chains a new
revision onto it.
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAILWAY_TOML = ROOT / "railway.toml"
VERSIONS = ROOT / "sellary-backend" / "alembic" / "versions"

REVISION_RE = re.compile(r"^revision(?:\s*:\s*str)?\s*=\s*[\"']([^\"']+)[\"']", re.M)
DOWN_RE = re.compile(r"^down_revision(?:\s*:[^=]+)?\s*=\s*(.+)$", re.M)
PIN_RE = re.compile(r"alembic\s+upgrade\s+([A-Za-z0-9_]+)")


def read_pin() -> str:
    text = RAILWAY_TOML.read_text(encoding="utf-8")
    match = PIN_RE.search(text)
    if not match:
        raise SystemExit(f"No `alembic upgrade <revision>` found in {RAILWAY_TOML}")
    return match.group(1)


def read_graph() -> tuple[set[str], set[str]]:
    """Returns (all revisions, revisions that some other revision descends from)."""
    revisions: set[str] = set()
    parents: set[str] = set()
    for path in VERSIONS.glob("*.py"):
        source = path.read_text(encoding="utf-8")
        revision = REVISION_RE.search(source)
        if not revision:
            continue
        revisions.add(revision.group(1))
        down = DOWN_RE.search(source)
        if down:
            # down_revision may be None, a string, or a tuple (a merge point).
            for parent in re.findall(r"[\"']([^\"']+)[\"']", down.group(1)):
                parents.add(parent)
    return revisions, parents


def main() -> int:
    pin = read_pin()
    revisions, parents = read_graph()

    if pin == "head" or pin == "heads":
        print(f"OK: railway.toml upgrades to `{pin}` — nothing pinned, nothing to drift.")
        return 0

    if pin not in revisions:
        print(f"railway.toml pins `{pin}`, which is not a revision in {VERSIONS}.")
        return 1

    heads = sorted(revisions - parents)
    if pin in heads:
        print(f"OK: railway.toml pins `{pin}`, still a head. Heads: {', '.join(heads)}")
        return 0

    print(f"railway.toml pins `{pin}`, but that is no longer a head.")
    print(f"  current heads: {', '.join(heads)}")
    print("A migration was added on top of the pin, so the deploy would run the")
    print("old revision and leave the schema behind. Update preDeployCommand in")
    print("railway.toml to the new revision (or merge the heads and use `head`).")
    return 1


if __name__ == "__main__":
    sys.exit(main())
