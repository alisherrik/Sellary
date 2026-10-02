# Sellary MCP hardening implementation plan

**Goal:** Fix the verified audit defects and provide complete, paginated, tenant-scoped read access to products, business documents and reconciliation history.

**Spec:** [Approved audit and acceptance criteria](D:/Learning/Sellary/docs/audits/mcp_2026_10_01/AUDIT.md). The user's request to fix the findings authorizes implementation in this session.

**Architecture:** MCP tools validate typed inputs, enforce OAuth/module permissions, call business services and serialize bounded results. Existing REST behavior and safe purchase preview/commit remain compatible. Read operations never bypass tenant or role checks.

**Tech stack:** Python 3.13, FastAPI, SQLAlchemy, FastMCP 3.4, Pydantic 2, PostgreSQL; SQLite for isolated tests.

## Constraints

- Preserve existing Russian UI/tool descriptions and English source comments.
- No live database repairs, deployments or unrelated user-file changes.
- Retain purchase confirmation, signed 15-minute drafts, tenant isolation and reconciliation edit guards.
- Derived consistency checks remain in `services/consistency_service.py`; never automatically choose stock or FIFO as the winner.
- Run backend commands with `.venv/Scripts/python.exe`, from `sellary-backend`, against isolated SQLite.

## Tasks and ownership

- [x] Auth worker: regressions first; block MCP JWTs in REST; bind new MCP audience/type; protect OAuth login against replay; enforce member AI grants; fix secret decryption, grant error/rotation handling and blocking authentication work.
- [x] Purchase worker: regressions with real commits; a single outer purchase transaction; stable draft hashes; explicit ambiguity; final preview validation; typed input contracts.
- [x] Reports worker: regressions for exact FIFO cost, discounted revenue, daily profit, null barcode, lazy money account anchors, oversell provenance and UTC reconciliation boundaries; decide a safe repair mechanism for existing system accounts.
- [x] Root: failing catalog/history/period tests; add bounded pagination and stable ordering; expose service-backed document and ledger reads; preserve historical date ranges and explicit dates; fix unit-price serialization and whole-period shift discrepancy.
- [x] Root: typed schemas and read annotations; transport discovery tests, role/tenant rejection tests, all affected regressions, full backend unit/integration suite and compile checks.
- [x] Root: review worker diffs, update audit status and connector guide, record test evidence and remaining production-only limitations.

## Review focus

- More than one page: no missing/duplicate static rows, trustworthy totals and continuation.
- Historical reads crossing reconciliation: exact requested range, lookup by ID remains possible.
- Failed/replayed purchases: no partial products, orders, receipts or stock changes.
- Token boundaries: a reports-only delegated token cannot become a web session or reach another company.
- Monetary invariants: split tenders, partial refunds, weighted FIFO, discounts and manually anchored accounts preserve their established meaning.

## Verification

Each owner adds the regression before changing production behavior and runs its focused pytest files with `-o addopts='' -p no:cacheprovider`. Root then runs `pytest tests/integration tests/unit`, compileall, module parity and migration-pin checks. Existing audit probes are historical evidence and are not treated as regression tests asserting desired behavior.

Final verification: 1175 backend integration/unit tests passed; compileall, 9-module parity, migration pin and diff checks passed. The implementation report records production-only checks and intentional limits.
