"""Matching a dictated delivery against the catalogue.

Pure resolution: nothing here writes. That is deliberate — this is the part
most likely to be wrong, and keeping it free of side effects means it can be
tested exhaustively without a purchase order in sight.

The output is a plan, not a decision. Every line comes back labelled with what
would happen to it and why, so the preview can show the owner exactly what they
are approving.
"""

import logging
from dataclasses import dataclass, field
from decimal import Decimal, ROUND_HALF_UP
from typing import Any, Literal

from rapidfuzz import fuzz, process, utils as fuzz_utils
from sqlalchemy.orm import Session

from models.product import Product
from models.supplier import Supplier

logger = logging.getLogger(__name__)

# Above this, two names are the same product. Chosen high: proposing a merge
# that is wrong costs a corrupted catalogue, while proposing a new product that
# turns out to be a duplicate costs one visible line in the preview.
FUZZY_THRESHOLD = 88

# A purchase price this far from the recorded cost is worth mentioning. It is
# usually a real price change, occasionally a unit mix-up (a case priced as a
# piece), and the owner is the only one who can tell which.
COST_DRIFT_WARN = Decimal("0.20")

DEFAULT_MARKUP = Decimal("0.30")

# Lower-cases and strips punctuation before comparing. Without it "ромашка"
# would not match "ООО Ромашка" — rapidfuzz compares raw strings, and people
# dictate names in whatever case they please.
_PREPROCESS = fuzz_utils.default_process

Status = Literal["matched", "ambiguous", "new"]


@dataclass
class ResolvedLine:
    status: Status
    query: str
    quantity: Decimal
    unit_cost: Decimal
    uom: str
    product_id: int | None = None
    product_name: str = ""
    barcode: str | None = None
    sell_price: Decimal | None = None
    sell_price_guessed: bool = False
    current_cost: Decimal | None = None
    current_stock: Decimal | None = None
    candidates: list[dict[str, Any]] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "status": self.status,
            "query": self.query,
            "product_id": self.product_id,
            "product_name": self.product_name,
            "barcode": self.barcode,
            "quantity": str(self.quantity),
            "uom": self.uom,
            "unit_cost": str(self.unit_cost),
            "line_total": str((self.quantity * self.unit_cost).quantize(Decimal("0.01"))),
            "sell_price": str(self.sell_price) if self.sell_price is not None else None,
            "sell_price_guessed": self.sell_price_guessed,
            "current_cost": str(self.current_cost) if self.current_cost is not None else None,
            "current_stock": str(self.current_stock) if self.current_stock is not None else None,
            "candidates": self.candidates,
            "warnings": self.warnings,
        }


class LineError(ValueError):
    """The line cannot be read at all — a missing quantity, an unusable price."""


def _decimal(value: Any, field_name: str, line_no: int) -> Decimal:
    try:
        return Decimal(str(value).replace(",", ".").strip())
    except Exception:
        raise LineError(
            f"Строка {line_no}: не удалось прочитать «{field_name}» = «{value}»."
        )


def _quantize_price(value: Decimal) -> Decimal:
    return value.quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)


def _quantize_qty(value: Decimal) -> Decimal:
    return value.quantize(Decimal("0.001"), rounding=ROUND_HALF_UP)


# ------------------------------------------------------------------ supplier


def resolve_supplier(db: Session, company_id: int, query: str) -> Supplier | None:
    """Exact name, then case-insensitive, then fuzzy. Never creates.

    A supplier is a relationship with payment terms and a history, not a label
    on a delivery, so an unrecognised name is a question for the owner rather
    than something to invent.
    """
    suppliers = (
        db.query(Supplier)
        .filter(Supplier.company_id == company_id, Supplier.is_active == True)  # noqa: E712
        .all()
    )
    if not suppliers:
        return None

    needle = (query or "").strip()
    for supplier in suppliers:
        if supplier.name == needle:
            return supplier
    for supplier in suppliers:
        if supplier.name.lower() == needle.lower():
            return supplier

    match = process.extractOne(
        needle,
        {supplier.id: supplier.name for supplier in suppliers},
        scorer=fuzz.token_set_ratio,
        processor=_PREPROCESS,
        score_cutoff=FUZZY_THRESHOLD,
    )
    if match is None:
        return None
    return next(s for s in suppliers if s.id == match[2])


# ------------------------------------------------------------------ products


def _candidates(products: list[Product], query: str) -> list[tuple[Product, float]]:
    needle = (query or "").strip()
    if not needle:
        return []
    scored = process.extract(
        needle,
        {product.id: product.name for product in products},
        scorer=fuzz.token_set_ratio,
        processor=_PREPROCESS,
        score_cutoff=FUZZY_THRESHOLD,
        limit=5,
    )
    by_id = {product.id: product for product in products}
    return [(by_id[product_id], score) for _, score, product_id in scored]


def resolve_lines(
    db: Session,
    company_id: int,
    items: list[dict[str, Any]],
    *,
    markup: Decimal = DEFAULT_MARKUP,
) -> tuple[list[ResolvedLine], list[str]]:
    """Resolve every line, merge duplicates, and report everything that was done.

    Returns the lines and a list of delivery-level notes. Nothing is silently
    corrected: if two lines were merged or a price was guessed, it is said.
    """
    if not items:
        raise LineError("Список товаров пуст.")

    products = (
        db.query(Product)
        .filter(Product.company_id == company_id, Product.is_active == True)  # noqa: E712
        .all()
    )
    by_barcode = {p.barcode: p for p in products if p.barcode}
    by_name = {p.name.strip().lower(): p for p in products}

    notes: list[str] = []
    resolved: list[ResolvedLine] = []

    for index, raw in enumerate(items, start=1):
        if not isinstance(raw, dict):
            raise LineError(f"Строка {index}: ожидается объект с полями товара.")

        query = str(raw.get("query") or raw.get("name") or "").strip()
        barcode = (str(raw.get("barcode")).strip() or None) if raw.get("barcode") else None
        if not query and not barcode:
            raise LineError(f"Строка {index}: не указано название товара.")

        quantity = _quantize_qty(_decimal(raw.get("quantity"), "quantity", index))
        if quantity <= 0:
            raise LineError(f"Строка {index}: количество должно быть больше нуля.")

        unit_cost = _quantize_price(_decimal(raw.get("unit_cost"), "unit_cost", index))
        if unit_cost < 0:
            raise LineError(f"Строка {index}: закупочная цена не может быть отрицательной.")

        uom = str(raw.get("uom") or "dona").strip() or "dona"
        line = ResolvedLine(
            status="new",
            query=query or barcode or "",
            quantity=quantity,
            unit_cost=unit_cost,
            uom=uom,
            barcode=barcode,
        )
        if unit_cost == 0:
            line.warnings.append("Закупочная цена равна нулю.")

        product = None

        # An explicit id wins over any guessing — it is how the model answers
        # an ambiguity the previous preview reported.
        explicit_id = raw.get("product_id")
        if explicit_id:
            product = next((p for p in products if p.id == int(explicit_id)), None)
            if product is None:
                raise LineError(
                    f"Строка {index}: товар с id {explicit_id} не найден."
                )

        if product is None and barcode and barcode in by_barcode:
            product = by_barcode[barcode]

        if product is None and query:
            product = by_name.get(query.lower())

        if product is None and query:
            matches = _candidates(products, query)
            if len(matches) == 1:
                product = matches[0][0]
            elif len(matches) > 1:
                # A clear winner is still a match; several close names are not.
                best, second = matches[0], matches[1]
                if best[1] - second[1] >= 8:
                    product = best[0]
                else:
                    line.status = "ambiguous"
                    line.candidates = [
                        {
                            "product_id": candidate.id,
                            "name": candidate.name,
                            "barcode": candidate.barcode,
                            "stock": str(candidate.stock_quantity),
                            "score": round(score),
                        }
                        for candidate, score in matches
                    ]
                    line.warnings.append(
                        "Несколько подходящих товаров — укажите product_id."
                    )
                    resolved.append(line)
                    continue

        if product is not None:
            line.status = "matched"
            line.product_id = product.id
            line.product_name = product.name
            line.barcode = product.barcode
            line.uom = product.uom
            line.current_cost = Decimal(str(product.cost_price))
            line.current_stock = Decimal(str(product.stock_quantity))
            if line.current_cost > 0:
                drift = abs(unit_cost - line.current_cost) / line.current_cost
                if drift >= COST_DRIFT_WARN:
                    direction = "выше" if unit_cost > line.current_cost else "ниже"
                    line.warnings.append(
                        f"Цена закупки на {round(drift * 100)}% {direction} "
                        f"прежней ({line.current_cost})."
                    )
        else:
            line.status = "new"
            line.product_name = query
            sell_price_raw = raw.get("sell_price")
            if sell_price_raw not in (None, ""):
                line.sell_price = _quantize_price(
                    _decimal(sell_price_raw, "sell_price", index)
                )
            else:
                line.sell_price = _quantize_price(unit_cost * (Decimal("1") + markup))
                line.sell_price_guessed = True
                line.warnings.append(
                    f"Цена продажи рассчитана как закупка +{round(markup * 100)}%. "
                    "Проверьте её."
                )

        resolved.append(line)

    merged, merge_notes = _merge_duplicates(resolved)
    notes.extend(merge_notes)
    return merged, notes


def _merge_duplicates(
    lines: list[ResolvedLine],
) -> tuple[list[ResolvedLine], list[str]]:
    """Two lines for the same product are one line, and the merge is reported.

    Cost is weighted by quantity, which is what the delivery actually cost —
    averaging the two prices would be wrong whenever the quantities differ.
    """
    result: list[ResolvedLine] = []
    seen: dict[int, ResolvedLine] = {}
    notes: list[str] = []

    for line in lines:
        if line.status != "matched" or line.product_id is None:
            result.append(line)
            continue

        existing = seen.get(line.product_id)
        if existing is None:
            seen[line.product_id] = line
            result.append(line)
            continue

        total_quantity = existing.quantity + line.quantity
        weighted = (
            existing.unit_cost * existing.quantity + line.unit_cost * line.quantity
        ) / total_quantity
        existing.quantity = _quantize_qty(total_quantity)
        existing.unit_cost = _quantize_price(weighted)
        note = (
            f"«{existing.product_name}» встречался несколько раз — строки "
            f"объединены: {existing.quantity} по средней цене {existing.unit_cost}."
        )
        existing.warnings.append(note)
        notes.append(note)

    return result, notes
