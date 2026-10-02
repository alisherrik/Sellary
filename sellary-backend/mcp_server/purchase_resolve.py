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
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import Annotated, Any, Literal

from rapidfuzz import fuzz, process, utils as fuzz_utils
from pydantic import AliasChoices, BaseModel, Field, ValidationError, field_validator, model_validator
from sqlalchemy import func
from sqlalchemy.orm import Session

from models.product import Product
from models.supplier import Supplier
from schemas.product import ProductCreate

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


class PurchaseItem(BaseModel):
    """The wire contract; plain dict callers are validated through the same model."""

    query: str | None = Field(default=None, max_length=200, validation_alias=AliasChoices("query", "name"))
    quantity: Decimal = Field(..., gt=0, allow_inf_nan=False)
    unit_cost: Decimal = Field(..., ge=0, allow_inf_nan=False)
    sell_price: Decimal | None = Field(default=None, ge=0, allow_inf_nan=False)
    barcode: str | None = Field(default=None, max_length=50)
    uom: str | None = Field(default="dona", max_length=20)
    product_id: int | None = Field(default=None, gt=0)

    @model_validator(mode="before")
    @classmethod
    def keep_name_fallback(cls, value):
        if isinstance(value, dict) and not value.get("query") and value.get("name"):
            return {**value, "query": value["name"]}
        return value

    @field_validator("quantity", "unit_cost", "sell_price", mode="before")
    @classmethod
    def parse_decimal(cls, value):
        if isinstance(value, str):
            return value.replace(",", ".").strip() or None
        return value

    @field_validator("barcode", mode="before")
    @classmethod
    def clean_barcode(cls, value):
        return str(value).strip() or None if value is not None else None


PurchaseItems = Annotated[list[PurchaseItem], Field(min_length=1, max_length=200)]


def validate_items_count(items: list) -> None:
    if not items:
        raise LineError("Список товаров пуст.")
    if len(items) > 200:
        raise LineError("В одной закупке может быть не больше 200 строк.")


class SupplierAmbiguity(LineError):
    def __init__(self, suppliers: list[Supplier]):
        super().__init__("Несколько подходящих поставщиков — укажите supplier_id.")
        self.candidates = [
            {"supplier_id": supplier.id, "name": supplier.name, "phone": supplier.phone}
            for supplier in suppliers
        ]


def _read_item(raw: PurchaseItem | dict[str, Any], line_no: int) -> dict[str, Any]:
    if not isinstance(raw, (dict, PurchaseItem)):
        raise LineError(f"Строка {line_no}: ожидается объект с полями товара.")
    try:
        item = raw if isinstance(raw, PurchaseItem) else PurchaseItem.model_validate(raw)
    except ValidationError as exc:
        field = exc.errors()[0]["loc"][0]
        label = {"quantity": "количество", "unit_cost": "закупочная цена", "sell_price": "цена продажи"}.get(field, field)
        raise LineError(f"Строка {line_no}: неверное значение «{label}».") from exc
    return item.model_dump()


def _decimal(value: Any, field_name: str, line_no: int) -> Decimal:
    try:
        result = Decimal(str(value).replace(",", ".").strip())
        if not result.is_finite():
            raise ValueError("Nonfinite number")
        return result
    except Exception:
        raise LineError(
            f"Строка {line_no}: не удалось прочитать «{field_name}» = «{value}»."
        )


def _quantize_price(value: Decimal) -> Decimal:
    try:
        return value.quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)
    except InvalidOperation as exc:
        raise LineError("Цена должна быть конечным числом допустимого размера.") from exc


def _quantize_qty(value: Decimal) -> Decimal:
    try:
        return value.quantize(Decimal("0.001"), rounding=ROUND_HALF_UP)
    except InvalidOperation as exc:
        raise LineError("Количество должно быть конечным числом допустимого размера.") from exc


# ------------------------------------------------------------------ supplier


def resolve_supplier(
    db: Session, company_id: int, query: str, *, supplier_id: int | None = None
) -> Supplier | None:
    """Exact name, then case-insensitive, then fuzzy. Never creates.

    A supplier is a relationship with payment terms and a history, not a label
    on a delivery, so an unrecognised name is a question for the owner rather
    than something to invent.
    """
    suppliers = (
        db.query(Supplier)
        .filter(Supplier.company_id == company_id, Supplier.is_active == True)  # noqa: E712
        .order_by(Supplier.id)
        .all()
    )
    if supplier_id is not None:
        try:
            selected_id = int(supplier_id)
        except (TypeError, ValueError) as exc:
            raise LineError("Неверный supplier_id.") from exc
        return next((s for s in suppliers if s.id == selected_id), None)
    if not suppliers:
        return None

    needle = (query or "").strip()
    exact = [s for s in suppliers if s.name.strip().lower() == needle.lower()]
    if len(exact) > 1:
        raise SupplierAmbiguity(exact)
    if exact:
        return exact[0]

    matches = process.extract(
        needle,
        {supplier.id: supplier.name for supplier in suppliers},
        scorer=fuzz.token_set_ratio,
        processor=_PREPROCESS,
        score_cutoff=FUZZY_THRESHOLD,
        limit=5,
    )
    if not matches:
        return None
    by_id = {s.id: s for s in suppliers}
    if len(matches) > 1 and matches[0][1] - matches[1][1] < 8:
        raise SupplierAmbiguity([by_id[match[2]] for match in matches])
    return by_id[matches[0][2]]


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


def _mark_ambiguous(line: ResolvedLine, matches: list[tuple[Product, float]]) -> None:
    line.status = "ambiguous"
    line.candidates = [
        {"product_id": candidate.id, "name": candidate.name, "barcode": candidate.barcode,
         "stock": str(candidate.stock_quantity), "score": round(score)}
        for candidate, score in matches
    ]
    line.warnings.append("Несколько подходящих товаров — укажите product_id.")


def resolve_lines(
    db: Session,
    company_id: int,
    items: list[PurchaseItem] | list[dict[str, Any]],
    *,
    markup: Decimal = DEFAULT_MARKUP,
) -> tuple[list[ResolvedLine], list[str]]:
    """Resolve every line, merge duplicates, and report everything that was done.

    Returns the lines and a list of delivery-level notes. Nothing is silently
    corrected: if two lines were merged or a price was guessed, it is said.
    """
    validate_items_count(items)

    products = (
        db.query(Product)
        .filter(Product.company_id == company_id, Product.is_active == True)  # noqa: E712
        .all()
    )
    by_barcode = {p.barcode.strip(): p for p in products if p.barcode}
    by_name: dict[str, list[Product]] = {}
    for product in products:
        by_name.setdefault(product.name.strip().lower(), []).append(product)

    notes: list[str] = []
    resolved: list[ResolvedLine] = []
    new_barcodes: set[str] = set()

    for index, raw in enumerate(items, start=1):
        raw = _read_item(raw, index)

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

        if product is None and barcode:
            archived = (
                db.query(Product.id)
                .filter(
                    Product.company_id == company_id,
                    func.trim(Product.barcode) == barcode,
                    Product.is_active.is_(False),
                )
                .first()
            )
            if archived is not None:
                raise LineError(
                    f"Строка {index}: товар со штрихкодом «{barcode}» архивирован. "
                    "Восстановите его в каталоге и повторите purchase_preview."
                )

        if product is None and query:
            exact = by_name.get(query.lower(), [])
            if len(exact) > 1:
                _mark_ambiguous(line, [(candidate, 100) for candidate in exact])
                resolved.append(line)
                continue
            if exact:
                product = exact[0]

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
                    _mark_ambiguous(line, matches)
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
            if barcode:
                if barcode in new_barcodes:
                    raise LineError(
                        f"Строка {index}: штрихкод «{barcode}» повторяется у нового товара. "
                        "Укажите его одной строкой и повторите purchase_preview."
                    )
                new_barcodes.add(barcode)
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

            # Validate the actual creation schema now, before the owner is
            # shown a plan that cannot be executed.
            try:
                ProductCreate(name=line.product_name, barcode=line.barcode, uom=line.uom,
                              cost_price=line.unit_cost, sell_price=line.sell_price,
                              stock_quantity=Decimal("0"))
            except ValidationError as exc:
                raise LineError(f"Строка {index}: неверные данные нового товара.") from exc

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
