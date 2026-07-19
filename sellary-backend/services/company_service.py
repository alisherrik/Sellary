"""Read and update a company's marketplace storefront settings."""
from sqlalchemy.orm import Session

from models.company import Company
from schemas.company import MarketplaceSettingsResponse, MarketplaceSettingsUpdate
from services.tenant import resolve_company_id


class CompanyService:
    def __init__(self, db: Session, company_id: int | None = None):
        self.db = db
        self.company_id = resolve_company_id(db, company_id)

    def _get_company(self) -> Company:
        company = self.db.query(Company).filter(Company.id == self.company_id).first()
        if company is None:
            raise ValueError("Company not found")
        return company

    def get_marketplace_settings(self) -> MarketplaceSettingsResponse:
        return MarketplaceSettingsResponse.model_validate(self._get_company())

    def update_marketplace_settings(
        self, payload: MarketplaceSettingsUpdate
    ) -> MarketplaceSettingsResponse:
        company = self._get_company()
        for field, value in payload.model_dump(exclude_unset=True).items():
            setattr(company, field, value)
        self.db.flush()
        return MarketplaceSettingsResponse.model_validate(company)
