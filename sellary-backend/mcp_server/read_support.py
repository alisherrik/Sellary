"""Shared read contracts: bounded pages and UTC query instants."""

from datetime import timezone
from typing import Annotated
from pydantic import Field
from mcp_server.periods import Period, resolve_period

READ_ONLY = {"readOnlyHint": True, "destructiveHint": False,
             "idempotentHint": True, "openWorldHint": False}
Limit = Annotated[int, Field(ge=1, le=200, description="Размер страницы, от 1 до 200.")]
SearchLimit = Annotated[int, Field(ge=1, le=50, description="Размер страницы поиска, от 1 до 50.")]
ShiftLimit = Annotated[int, Field(ge=1, le=100, description="Размер страницы смен, от 1 до 100.")]
Offset = Annotated[int, Field(ge=0, description="Продолжение: next_offset из предыдущего ответа.")]
Id = Annotated[int, Field(gt=0)]
DateArg = Annotated[str, Field(pattern=r"^\d{4}-\d{2}-\d{2}$", description="Дата по часовому поясу компании, ГГГГ-ММ-ДД.")]


def page_info(count, total, limit, offset, *, has_more=None):
    if has_more is None:
        has_more = offset + count < total
    return {"count": count, "total": total, "limit": limit, "offset": offset,
            "has_more": has_more, "next_offset": offset + count if has_more else None}


def period_query(service, period: Period | None, start_date=None, end_date=None):
    if period is None and start_date is None and end_date is None:
        floor = service.open_from()
        return None, None, {"timezone": str(service.tz()),
                            "reconciled_from": floor.isoformat() if floor else None}
    start, end, echo = resolve_period(service, period or "custom", start_date, end_date)
    # SQLite discards tzinfo on bind. Convert to UTC first, preserving awareness
    # for services that interpret naive input on the company's local clock.
    return start.astimezone(timezone.utc), end.astimezone(timezone.utc), echo
