"""
State Machine Validation for Sale and Purchase Order Statuses.

This module provides centralized status transition validation to prevent 
invalid state changes and maintain data integrity.
"""
from typing import Dict, Set, Optional
from models.sale import SaleStatus
from models.purchase_order import PurchaseOrderStatus


class StateTransitionError(Exception):
    """Raised when an invalid status transition is attempted."""
    def __init__(self, entity_type: str, entity_id: int, current_status: str, target_status: str):
        self.entity_type = entity_type
        self.entity_id = entity_id
        self.current_status = current_status
        self.target_status = target_status
        self.message = (
            f"Invalid status transition for {entity_type} #{entity_id}: "
            f"cannot transition from '{current_status}' to '{target_status}'"
        )
        super().__init__(self.message)


# =============================================================================
# SALE STATUS TRANSITIONS
# =============================================================================

# Allowed transitions: current_status -> {allowed_target_statuses}
SALE_TRANSITIONS: Dict[SaleStatus, Set[SaleStatus]] = {
    SaleStatus.COMPLETED: {
        SaleStatus.CANCELLED,
        SaleStatus.PARTIALLY_RETURNED,
        SaleStatus.RETURNED,
    },
    SaleStatus.PARTIALLY_RETURNED: {
        SaleStatus.RETURNED,  # When all items fully returned
        # Admin annulment (void) supersedes a partial return: the remaining
        # outstanding stock is restored and the document is voided. Plain
        # cashier cancel no longer exists, so this transition is admin-gated at
        # the service/API layer (TransactionReversalService.void_sale).
        SaleStatus.CANCELLED,
    },
    SaleStatus.RETURNED: set(),    # Terminal state - no transitions allowed
    SaleStatus.CANCELLED: set(),   # Terminal state - no transitions allowed
}

def validate_sale_transition(
    current_status: SaleStatus,
    target_status: SaleStatus,
    sale_id: int
) -> None:
    """
    Validate that a sale status transition is allowed.
    
    Args:
        current_status: Current status of the sale
        target_status: Desired new status
        sale_id: ID of the sale (for error messages)
        
    Raises:
        StateTransitionError: If the transition is not allowed
    """
    allowed_transitions = SALE_TRANSITIONS.get(current_status, set())
    if target_status not in allowed_transitions:
        raise StateTransitionError(
            entity_type="Sale",
            entity_id=sale_id,
            current_status=current_status.value,
            target_status=target_status.value
        )


def can_cancel_sale(sale_status: SaleStatus) -> bool:
    """Check if a sale can be cancelled from its current status."""
    return SaleStatus.CANCELLED in SALE_TRANSITIONS.get(sale_status, set())


def can_return_sale(sale_status: SaleStatus) -> bool:
    """Check if a sale can be returned (partially or fully) from its current status."""
    allowed = SALE_TRANSITIONS.get(sale_status, set())
    return (
        SaleStatus.RETURNED in allowed or
        SaleStatus.PARTIALLY_RETURNED in allowed
    )


# =============================================================================
# PURCHASE ORDER STATUS TRANSITIONS
# =============================================================================

# Allowed transitions: current_status -> {allowed_target_statuses}
PO_TRANSITIONS: Dict[PurchaseOrderStatus, Set[PurchaseOrderStatus]] = {
    PurchaseOrderStatus.DRAFT: {
        PurchaseOrderStatus.SENT,
        PurchaseOrderStatus.CANCELLED,
    },
    PurchaseOrderStatus.SENT: {
        PurchaseOrderStatus.PARTIALLY_RECEIVED,
        PurchaseOrderStatus.RECEIVED,  # If all items received at once
        # Only unreceived SENT orders may be cancelled. Once any stock has been
        # received the order must be voided (reversal) instead of cancelled;
        # the service layer additionally rejects cancel when any item has a
        # non-zero quantity_received.
        PurchaseOrderStatus.CANCELLED,
    },
    PurchaseOrderStatus.PARTIALLY_RECEIVED: {
        # No CANCELLED: a partially received order has stock on hand and must be
        # voided via the reversal workflow, not plain-cancelled.
        PurchaseOrderStatus.RECEIVED,
    },
    PurchaseOrderStatus.RECEIVED: set(),   # Terminal state
    PurchaseOrderStatus.CANCELLED: set(),  # Terminal state
}


def validate_po_transition(
    current_status: PurchaseOrderStatus,
    target_status: PurchaseOrderStatus,
    po_id: int
) -> None:
    """
    Validate that a purchase order status transition is allowed.
    
    Args:
        current_status: Current status of the PO
        target_status: Desired new status
        po_id: ID of the purchase order (for error messages)
        
    Raises:
        StateTransitionError: If the transition is not allowed
    """
    allowed_transitions = PO_TRANSITIONS.get(current_status, set())
    if target_status not in allowed_transitions:
        raise StateTransitionError(
            entity_type="Purchase Order",
            entity_id=po_id,
            current_status=current_status.value,
            target_status=target_status.value
        )


def can_send_po(po_status: PurchaseOrderStatus) -> bool:
    """Check if a PO can be sent from its current status."""
    return PurchaseOrderStatus.SENT in PO_TRANSITIONS.get(po_status, set())


def can_receive_po(po_status: PurchaseOrderStatus) -> bool:
    """Check if a PO can receive items from its current status."""
    allowed = PO_TRANSITIONS.get(po_status, set())
    return (
        PurchaseOrderStatus.RECEIVED in allowed or
        PurchaseOrderStatus.PARTIALLY_RECEIVED in allowed
    )


def can_cancel_po(po_status: PurchaseOrderStatus) -> bool:
    """Check if a PO can be cancelled from its current status."""
    return PurchaseOrderStatus.CANCELLED in PO_TRANSITIONS.get(po_status, set())


def can_delete_po(po_status: PurchaseOrderStatus) -> bool:
    """Check if a PO can be deleted (only DRAFT status)."""
    return po_status == PurchaseOrderStatus.DRAFT


def can_edit_po(po_status: PurchaseOrderStatus) -> bool:
    """Check if a PO can be edited (only DRAFT status)."""
    return po_status == PurchaseOrderStatus.DRAFT
