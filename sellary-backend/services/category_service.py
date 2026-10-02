"""Company-scoped category reads for the connector."""

from repositories.category_repository import CategoryRepository
from services.tenant import resolve_company_id


class CategoryService:
    def __init__(self, db, company_id=None):
        self.company_id = resolve_company_id(db, company_id)
        self.repository = CategoryRepository(db)

    def get_page(self, offset=0, limit=50):
        return self.repository.get_page(self.company_id, offset, limit)
