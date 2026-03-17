from decimal import Decimal, ROUND_HALF_UP, getcontext


class CalculationService:
    """Handles all financial calculations with proper decimal precision."""

    @staticmethod
    def set_context():
        """Set decimal context for financial calculations."""
        getcontext().prec = 10
        getcontext().rounding = ROUND_HALF_UP

    @staticmethod
    def calculate_item_subtotal(quantity: int, unit_price: Decimal) -> Decimal:
        """Calculate subtotal for a sale item."""
        return (quantity * unit_price).quantize(Decimal("0.01"))

    @staticmethod
    def calculate_item_tax(
        subtotal: Decimal, tax_percent: Decimal
    ) -> Decimal:
        """Calculate tax amount for a sale item."""
        return (subtotal * tax_percent / Decimal("100")).quantize(Decimal("0.01"))

    @staticmethod
    def calculate_item_total(
        subtotal: Decimal, tax_amount: Decimal, discount_amount: Decimal
    ) -> Decimal:
        """Calculate total for a sale item."""
        return (subtotal + tax_amount - discount_amount).quantize(Decimal("0.01"))

    @staticmethod
    def calculate_profit(
        sell_price: Decimal, cost_price: Decimal, quantity: int = 1
    ) -> Decimal:
        """Calculate profit amount."""
        return ((sell_price - cost_price) * quantity).quantize(Decimal("0.01"))

    @staticmethod
    def calculate_profit_margin_percent(
        cost_price: Decimal, sell_price: Decimal
    ) -> Decimal:
        """Calculate profit margin as percentage."""
        if cost_price == 0:
            return Decimal("0.00")
        return (((sell_price - cost_price) / cost_price) * Decimal("100")).quantize(
            Decimal("0.01")
        )
