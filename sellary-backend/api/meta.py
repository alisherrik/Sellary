"""
Meta API endpoints for frontend configuration.
"""
from typing import List

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from api.dependencies import AuthContext, get_auth_context
from schemas.sale import PaymentMethod, SaleStatus

router = APIRouter(prefix="/meta", tags=["meta"])


class SaleReturnOptions(BaseModel):
    """Options for sale return operations."""
    refund_methods: List[str]
    returnable_statuses: List[str]


@router.get("/sale-return-options", response_model=SaleReturnOptions)
def get_sale_return_options(
    auth: AuthContext = Depends(get_auth_context),
):
    """
    Get available options for sale returns.
    
    Returns the allowed refund methods and statuses that permit returns.
    Frontend should use these values instead of hardcoding.
    """
    _ = auth
    return SaleReturnOptions(
        refund_methods=[method.value for method in PaymentMethod],
        returnable_statuses=[
            SaleStatus.COMPLETED.value,
            SaleStatus.PARTIALLY_RETURNED.value,
        ],
    )
