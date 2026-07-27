"""Recording a delivery: the only place this connector writes.

Two tools, deliberately. `purchase_preview` reads the delivery, resolves it
against the catalogue and returns a plan plus a signed token; it writes
nothing. `purchase_commit` executes that token and nothing else.

The split is what makes the owner's "yes" mean something. A single tool would
have to trust the model to have shown the right thing before acting; with the
token, the plan that was shown and the plan that is written are the same object.
"""

import hashlib
import logging
from decimal import Decimal

from fastmcp.exceptions import ToolError

from core.idempotency import IdempotencyConflictError, IdempotencyService
from core.state_machine import StateTransitionError
from mcp_server import SCOPE_PURCHASING
from mcp_server.context import mcp_session, require_module, require_scope
from mcp_server.drafts import issue_draft, read_draft
from mcp_server.purchase_resolve import (
    DEFAULT_MARKUP,
    LineError,
    resolve_lines,
    resolve_supplier,
)
from mcp_server.serialization import money
from mcp_server.server import mcp
from models.supplier import Supplier
from schemas.product import ProductCreate
from schemas.purchase_order import (
    PurchaseOrderCreate,
    PurchaseOrderItemCreate,
    ReceiveItemsRequest,
)
from services.product_service import ProductService
from services.purchase_order_service import PurchaseOrderService

logger = logging.getLogger(__name__)


@mcp.tool
def purchase_preview(
    supplier: str,
    items: list[dict],
    markup_percent: float = 30.0,
    notes: str | None = None,
) -> dict:
    """Разобрать поступление товара и показать, что будет сделано. Ничего не
    записывает.

    Каждая строка items — объект:
      query       — название товара, как его назвали (обязательно)
      quantity    — количество (обязательно)
      unit_cost   — закупочная цена за единицу (обязательно)
      sell_price  — цена продажи; если не указана, считается как закупка + наценка
      barcode     — штрихкод, если известен
      uom         — единица измерения для нового товара (по умолчанию dona)
      product_id  — если предыдущий preview сообщил о неоднозначности

    Ответ показывает по каждой строке: найден товар, несколько подходящих
    вариантов, или товар будет создан. Обязательно покажите этот разбор
    владельцу и дождитесь подтверждения — только потом вызывайте
    purchase_commit с полученным draft_token.
    """
    with mcp_session() as (db, auth):
        require_scope(auth, SCOPE_PURCHASING)
        require_module(auth, db, "purchasing")

        supplier_row = resolve_supplier(db, auth.company_id, supplier)
        if supplier_row is None:
            known = [
                name
                for (name,) in db.query(Supplier.name)
                .filter(
                    Supplier.company_id == auth.company_id,
                    Supplier.is_active == True,  # noqa: E712
                )
                .order_by(Supplier.name)
                .limit(30)
                .all()
            ]
            listing = ", ".join(known) if known else "поставщиков пока нет"
            raise ToolError(
                f"Поставщик «{supplier}» не найден. Известные поставщики: {listing}. "
                "Поставщика нужно завести в системе — я не создаю его сам."
            )

        markup = Decimal(str(markup_percent)) / Decimal("100")
        if markup < 0:
            raise ToolError("Наценка не может быть отрицательной.")

        try:
            lines, notes_out = resolve_lines(
                db, auth.company_id, items, markup=markup
            )
        except LineError as exc:
            raise ToolError(str(exc))

        ambiguous = [line for line in lines if line.status == "ambiguous"]
        new_lines = [line for line in lines if line.status == "new"]
        total = sum(
            (line.quantity * line.unit_cost for line in lines), Decimal("0")
        )

        plan = {
            "supplier_id": supplier_row.id,
            "supplier_name": supplier_row.name,
            "notes": notes,
            "lines": [line.to_dict() for line in lines],
        }

        summary_parts = [f"{len(lines)} позиций на сумму {money(total)}"]
        if new_lines:
            summary_parts.append(f"новых товаров: {len(new_lines)}")
        if ambiguous:
            summary_parts.append(f"требуют уточнения: {len(ambiguous)}")

        result = {
            "supplier": supplier_row.name,
            "line_count": len(lines),
            "new_product_count": len(new_lines),
            "ambiguous_count": len(ambiguous),
            "total_amount": money(total),
            "summary": "; ".join(summary_parts),
            "notes": notes_out,
            "lines": plan["lines"],
            "can_commit": not ambiguous,
        }

        if ambiguous:
            result["draft_token"] = None
            result["next_step"] = (
                "Уточните неоднозначные позиции: повторите purchase_preview, "
                "указав product_id для этих строк."
            )
        else:
            result["draft_token"] = issue_draft(auth.company_id, auth.user.id, plan)
            result["next_step"] = (
                "Покажите этот список владельцу. После подтверждения вызовите "
                "purchase_commit с draft_token. Черновик действителен 15 минут."
            )

        return result


@mcp.tool
def purchase_commit(draft_token: str, mode: str = "receive") -> dict:
    """Записать закупку, подтверждённую владельцем. Выполняет ровно то, что
    показал purchase_preview.

    mode = "receive" (по умолчанию) — создать заказ и сразу оприходовать товар
    на склад: остатки и себестоимость обновятся.
    mode = "draft" — только создать заказ, приход оформит кто-то потом.

    Вызывайте только после явного согласия владельца. Повторный вызов с тем же
    draft_token безопасен: он вернёт тот же заказ и ничего не создаст заново.
    """
    mode = (mode or "receive").strip().lower()
    if mode not in {"receive", "draft"}:
        raise ToolError('Параметр mode должен быть "receive" или "draft".')

    with mcp_session() as (db, auth):
        require_scope(auth, SCOPE_PURCHASING)
        # Receiving moves stock and money, so it carries the same bar as the
        # REST receive endpoint. Previewing is only looking.
        require_module(auth, db, "purchasing", "manager" if mode == "receive" else "user")

        plan = read_draft(draft_token, auth.company_id, auth.user.id)
        lines = plan["lines"]

        if any(line["status"] == "ambiguous" for line in lines):
            raise ToolError(
                "В черновике остались неоднозначные позиции. Уточните их через "
                "purchase_preview."
            )

        endpoint = "mcp:purchase_commit"
        key = "mcp-po-" + hashlib.sha256(draft_token.encode()).hexdigest()[:32]
        request_body = {"mode": mode, "lines": lines}

        idempotency = IdempotencyService(db)
        try:
            cached = idempotency.get_cached_response(
                key=key,
                company_id=auth.company_id,
                user_id=auth.user.id,
                endpoint=endpoint,
                request_body=request_body,
            )
        except IdempotencyConflictError:
            raise ToolError(
                "Этот черновик уже был проведён с другими параметрами. "
                "Сформируйте новый через purchase_preview."
            )
        if cached:
            response_body, _ = cached
            return {**response_body, "replayed": True}

        product_service = ProductService(db, auth.company_id)
        created_products: list[dict] = []

        try:
            # New products arrive with zero stock. Stock comes in through the
            # receipt so the FIFO ledger records the layer and its cost; a
            # direct stock write would be invisible to it.
            for line in lines:
                if line["status"] != "new":
                    continue
                created = product_service.create(
                    ProductCreate(
                        name=line["product_name"] or line["query"],
                        barcode=line.get("barcode") or None,
                        uom=line.get("uom") or "dona",
                        cost_price=Decimal(line["unit_cost"]),
                        sell_price=Decimal(
                            line["sell_price"] or line["unit_cost"]
                        ),
                        stock_quantity=Decimal("0.000"),
                    ),
                    user_id=auth.user.id,
                )
                line["product_id"] = created.id
                created_products.append({"id": created.id, "name": created.name})

            order = PurchaseOrderService(db, auth.company_id).create(
                PurchaseOrderCreate(
                    supplier_id=plan["supplier_id"],
                    notes=plan.get("notes"),
                    items=[
                        PurchaseOrderItemCreate(
                            product_id=line["product_id"],
                            quantity_ordered=Decimal(line["quantity"]),
                            unit_cost=Decimal(line["unit_cost"]),
                        )
                        for line in lines
                    ],
                )
            )

            received = False
            if mode == "receive":
                po_service = PurchaseOrderService(db, auth.company_id)
                po_service.send(order.id)
                order = po_service.receive_items(
                    order.id,
                    ReceiveItemsRequest(
                        items=[
                            {
                                "item_id": item.id,
                                "quantity_to_receive": str(item.quantity_ordered),
                            }
                            for item in order.items
                        ]
                    ),
                    auth.user.id,
                )
                received = True

            result = {
                "purchase_order_id": order.id,
                "status": order.status.value
                if hasattr(order.status, "value")
                else str(order.status),
                "supplier": plan["supplier_name"],
                "line_count": len(lines),
                "total_amount": money(order.total_amount),
                "received": received,
                "created_products": created_products,
                "message": (
                    f"Закупка проведена: заказ №{order.id}, "
                    f"{len(lines)} позиций на {money(order.total_amount)}."
                    + (" Товар оприходован на склад." if received else "")
                ),
            }

            idempotency.store_response(
                key=key,
                company_id=auth.company_id,
                user_id=auth.user.id,
                endpoint=endpoint,
                request_body=request_body,
                response_body=result,
                status_code=200,
            )
            logger.info(
                "MCP purchase committed: company=%s po=%s mode=%s",
                auth.company_id,
                order.id,
                mode,
            )
            return result

        except StateTransitionError as exc:
            raise ToolError(f"Не удалось провести закупку: {exc.message}")
        except IdempotencyConflictError:
            raise ToolError(
                "Этот черновик уже проводится. Дождитесь результата первой попытки."
            )
        except ValueError as exc:
            raise ToolError(f"Не удалось провести закупку: {exc}")
