"""Turning "how did they pay?" into the rows that record it.

A sale arrives one of two ways. Either it carries an explicit list of tenders —
26 cash, 10 on a DC card, 10 on Эсхата, 4 on the tab — or it carries the older
scalar shape, a single method with an optional up-front payment against a debt.
Both end up as the same thing: a list of tenders that sums to the total.

Keeping the old shape working is not politeness. The offline cashier is an
installed desktop application that cannot be upgraded in step with the server,
and it will keep sending scalars for as long as it takes to ship its own
version of this.

Nothing here touches the database. It is arithmetic and rules, so it can be
tested exhaustively without a sale in sight.
"""

from dataclasses import dataclass
from decimal import Decimal
from typing import Iterable

from models.sale import CardType, PaymentMethod

CENT = Decimal("0.01")
ZERO = Decimal("0.00")

# Which tender a split sale is filed under when something reads the old scalar
# column. Largest wins; this order only breaks ties.
_DOMINANCE = (
    PaymentMethod.CASH,
    PaymentMethod.CARD,
    PaymentMethod.MOBILE,
    PaymentMethod.CREDIT,
)


@dataclass
class Tender:
    method: PaymentMethod
    card_type: CardType | None
    amount: Decimal

    @property
    def key(self) -> tuple[str, str | None]:
        card = self.card_type.value if self.card_type else None
        return (self.method.value, card)


def _enum_value(value) -> str:
    """The wire value, whichever enum class this came from.

    `schemas.sale` declares its own PaymentMethod and CardType, distinct classes
    from the model's with the same members. `str()` on a `str, Enum` member
    returns "PaymentMethod.CASH", not "cash", so the value has to be taken
    explicitly rather than stringified.
    """
    return getattr(value, "value", value)


def _as_method(value) -> PaymentMethod:
    return value if isinstance(value, PaymentMethod) else PaymentMethod(_enum_value(value))


def _as_card(value) -> CardType | None:
    if value is None:
        return None
    return value if isinstance(value, CardType) else CardType(_enum_value(value))


def _money(value) -> Decimal:
    return Decimal(str(value or 0)).quantize(CENT)


def compose_tenders(sale_create, total_amount: Decimal) -> list[Tender]:
    """The tenders for this sale, from whichever shape the caller used.

    Raises ValueError with a message meant for the cashier, not the log.
    """
    total = _money(total_amount)
    explicit = getattr(sale_create, "payments", None)

    if explicit:
        tenders = [
            Tender(
                method=_as_method(line.method),
                card_type=_as_card(line.card_type),
                amount=_money(line.amount),
            )
            for line in explicit
        ]
        # Checked before the merge: two cash lines are one cashier entering
        # two notes, but two credit lines are a caller that has lost track of
        # what it is asking for, and merging them would hide that.
        if sum(1 for t in tenders if t.method == PaymentMethod.CREDIT) > 1:
            raise ValueError("A sale may carry at most one credit payment")
        tenders = _merge_duplicates(tenders)
    else:
        tenders = _from_scalars(sale_create, total)

    _validate(tenders, total, customer_id=getattr(sale_create, "customer_id", None))
    return tenders


def tenders_from_scalars(
    *,
    method,
    card_type,
    total: Decimal,
    paid_amount=ZERO,
    initial_method=None,
) -> list[Tender]:
    """The pre-split shape: one method, plus an optional payment against a debt.

    Takes primitives rather than a request object so the sync endpoint — whose
    payload is a different schema with string fields — can reach it too.
    """
    total = _money(total)
    method = _as_method(method)
    card_type = _as_card(card_type)

    if method != PaymentMethod.CREDIT:
        return [Tender(method=method, card_type=card_type, amount=total)]

    paid = _money(paid_amount)
    tenders: list[Tender] = []
    if paid > ZERO:
        if initial_method is None:
            raise ValueError(
                "initial_payment_method is required when paid_amount is greater than zero"
            )
        tenders.append(
            Tender(method=_as_method(initial_method), card_type=None, amount=paid)
        )

    owed = (total - paid).quantize(CENT)
    if owed > ZERO:
        tenders.append(Tender(method=PaymentMethod.CREDIT, card_type=None, amount=owed))
    return tenders


def _from_scalars(sale_create, total: Decimal) -> list[Tender]:
    return tenders_from_scalars(
        method=sale_create.payment_method,
        card_type=sale_create.card_type,
        total=total,
        paid_amount=getattr(sale_create, "paid_amount", ZERO),
        initial_method=getattr(sale_create, "initial_payment_method", None),
    )


def _merge_duplicates(tenders: list[Tender]) -> list[Tender]:
    """Two lines of the same kind are one line. Nobody pays DC twice."""
    merged: dict[tuple[str, str | None], Tender] = {}
    order: list[tuple[str, str | None]] = []
    for tender in tenders:
        existing = merged.get(tender.key)
        if existing is None:
            merged[tender.key] = tender
            order.append(tender.key)
        else:
            existing.amount = (existing.amount + tender.amount).quantize(CENT)
    return [merged[key] for key in order]


def _validate(tenders: list[Tender], total: Decimal, customer_id) -> None:
    if not tenders:
        raise ValueError("A payment method is required")

    for tender in tenders:
        if tender.amount <= ZERO:
            raise ValueError("Every payment amount must be greater than zero")
        if tender.method == PaymentMethod.CARD and tender.card_type is None:
            raise ValueError("card_type is required when payment_method is card")
        if tender.method != PaymentMethod.CARD and tender.card_type is not None:
            raise ValueError("card_type must not be set when payment_method is not card")

    credit_lines = [t for t in tenders if t.method == PaymentMethod.CREDIT]
    if len(credit_lines) > 1:
        # A customer has one balance, not several.
        raise ValueError("A sale may carry at most one credit payment")
    if credit_lines and not customer_id:
        raise ValueError("Customer is required for credit sales")

    tendered = sum((t.amount for t in tenders), ZERO).quantize(CENT)
    if tendered != total:
        # Named both ways round because "payments do not match the total" sends
        # a cashier hunting for which one is wrong.
        difference = (total - tendered).quantize(CENT)
        if difference > ZERO:
            raise ValueError(
                f"Payments are {difference} short of the sale total: "
                f"{tendered} tendered of {total}"
            )
        raise ValueError(
            f"Payments exceed the sale total by {-difference}: "
            f"{tendered} tendered of {total}"
        )


def dominant_method(tenders: Iterable[Tender]) -> tuple[PaymentMethod, CardType | None]:
    """What the legacy `sales.payment_method` column should say.

    The biggest tender. A reader that has not been taught about splits then
    files the sale under where most of the money came from, rather than meeting
    a value it cannot parse.
    """
    ordered = sorted(
        tenders,
        key=lambda t: (-t.amount, _DOMINANCE.index(t.method)),
    )
    winner = ordered[0]
    return winner.method, winner.card_type


def build_payment_rows(company_id: int, sale_id: int, tenders: Iterable[Tender]):
    """The `sale_payments` rows for a sale. Every write path goes through here.

    Local import: this module is otherwise pure arithmetic, and the sale write
    paths that need the rows are the only reason it must know about a model.
    """
    from models.sale_payment import SalePayment

    return [
        SalePayment(
            company_id=company_id,
            sale_id=sale_id,
            method=tender.method,
            card_type=tender.card_type,
            amount=tender.amount,
            sort_order=order,
        )
        for order, tender in enumerate(tenders)
    ]


def credit_amount(tenders: Iterable[Tender]) -> Decimal:
    """How much of this sale went on the tab. Zero when none of it did."""
    return sum(
        (t.amount for t in tenders if t.method == PaymentMethod.CREDIT), ZERO
    ).quantize(CENT)
