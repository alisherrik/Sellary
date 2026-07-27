"""Fail the build when the backend and frontend module lists drift.

The registry lives in core/modules.py. lib/modules.ts mirrors it so the
frontend keeps a real union type instead of fetching the list at runtime.
Nothing enforces that mirror but this script.
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BACKEND = ROOT / "sellary-backend" / "core" / "modules.py"
FRONTEND = ROOT / "sellary-frontend" / "src" / "lib" / "modules.ts"


def _without_comments(source: str, marker: str) -> str:
    """Drop trailing comments so their punctuation cannot end a block early.

    A comment closed the MODULES tuple once: `# Счета (касса, банк)` put a `)`
    inside the block, the non-greedy match stopped there, and every module
    declared after `finance` became invisible to this check — which is the one
    thing it exists to notice.
    """
    return "\n".join(line.split(marker, 1)[0] for line in source.splitlines())


def backend_modules() -> list[str]:
    source = _without_comments(BACKEND.read_text(encoding="utf-8"), "#")
    # The closing paren is anchored to the start of a line, so only the real
    # end of the tuple can terminate the block.
    block = re.search(r"^MODULES\s*=\s*\((.*?)^\)", source, re.S | re.M)
    if not block:
        raise SystemExit(f"MODULES tuple not found in {BACKEND}")
    return re.findall(r'"([a-z_]+)"', block.group(1))


def frontend_modules() -> list[str]:
    source = _without_comments(FRONTEND.read_text(encoding="utf-8"), "//")
    block = re.search(r"export type ModuleKey\s*=(.*?);", source, re.S)
    if not block:
        raise SystemExit(f"ModuleKey union not found in {FRONTEND}")
    return re.findall(r"'([a-z_]+)'", block.group(1))


def main() -> int:
    backend = backend_modules()
    frontend = frontend_modules()
    if backend == frontend:
        print(f"OK: {len(backend)} modules match — {', '.join(backend)}")
        return 0
    print("Module lists have drifted.")
    print(f"  core/modules.py : {backend}")
    print(f"  lib/modules.ts  : {frontend}")
    only_backend = [m for m in backend if m not in frontend]
    only_frontend = [m for m in frontend if m not in backend]
    if only_backend:
        print(f"  missing from the frontend: {only_backend}")
    if only_frontend:
        print(f"  missing from the backend : {only_frontend}")
    return 1


if __name__ == "__main__":
    sys.exit(main())
