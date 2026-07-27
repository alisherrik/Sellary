"""Turning service output into something a model can read without losing money.

Two rules the rest of the codebase already lives by, carried across the wire:

Money never becomes a float. `Decimal("1234.50")` through `float()` is a
number that prints as `1234.5` and adds like a binary fraction; a report that
is off by a hundredth is worse than one that fails.

Precision is per-kind, not per-value: money is 2 decimal places, quantities 3,
unit prices 4. Serialising `Decimal("0.1")` as `"0.1"` when it means money
hides whether the value was ever rounded.
"""

from datetime import date, datetime
from decimal import Decimal
from enum import Enum
from typing import Any

MONEY = Decimal("0.01")
QUANTITY = Decimal("0.001")
UNIT_PRICE = Decimal("0.0001")

# Fields whose name tells us the scale. Anything not listed keeps its own.
_QUANTITY_HINTS = ("quantity", "qty", "stock", "count_units")
_UNIT_PRICE_HINTS = ("unit_cost", "unit_price", "cost_price", "sell_price", "factor")


def money(value: Any) -> str | None:
    if value is None:
        return None
    return str(Decimal(str(value)).quantize(MONEY))


def quantity(value: Any) -> str | None:
    if value is None:
        return None
    return str(Decimal(str(value)).quantize(QUANTITY))


def unit_price(value: Any) -> str | None:
    if value is None:
        return None
    return str(Decimal(str(value)).quantize(UNIT_PRICE))


def _scale_for(key: str | None) -> Decimal:
    if key is None:
        return MONEY
    lowered = key.lower()
    if any(hint in lowered for hint in _UNIT_PRICE_HINTS):
        return UNIT_PRICE
    if any(hint in lowered for hint in _QUANTITY_HINTS):
        return QUANTITY
    return MONEY


def json_safe(value: Any, key: str | None = None) -> Any:
    """Recursively render a service result as JSON-safe primitives."""
    if value is None or isinstance(value, (str, bool, int)):
        return value
    if isinstance(value, Decimal):
        return str(value.quantize(_scale_for(key)))
    if isinstance(value, float):
        return str(Decimal(str(value)).quantize(_scale_for(key)))
    if isinstance(value, Enum):
        return value.value
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, dict):
        return {str(k): json_safe(v, str(k)) for k, v in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [json_safe(item, key) for item in value]
    if hasattr(value, "model_dump"):  # Pydantic response models
        return json_safe(value.model_dump(), key)
    return str(value)
