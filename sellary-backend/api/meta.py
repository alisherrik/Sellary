"""
Meta API endpoints for frontend configuration.
"""
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from typing import List
from schemas.sale import PaymentMethod, SaleStatus
from api.dependencies import get_current_user
from models.user import User

router = APIRouter(prefix="/meta", tags=["meta"])


class SaleReturnOptions(BaseModel):
    """Options for sale return operations."""
    refund_methods: List[str]
    returnable_statuses: List[str]


@router.get("/sale-return-options", response_model=SaleReturnOptions)
def get_sale_return_options(
    current_user: User = Depends(get_current_user),
):
    """
    Get available options for sale returns.
    
    Returns the allowed refund methods and statuses that permit returns.
    Frontend should use these values instead of hardcoding.
    """
    return SaleReturnOptions(
        refund_methods=[method.value for method in PaymentMethod],
        returnable_statuses=[
            SaleStatus.COMPLETED.value,
            SaleStatus.PARTIALLY_RETURNED.value,
        ],
    )
