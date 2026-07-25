from sqlalchemy.orm import Session

from core.modules import MODULES
from models.company_module import CompanyModule


class CompanyModuleRepository:
    """Reads and writes the company-level module set."""

    def __init__(self, db: Session):
        self.db = db

    def enabled_modules(self, company_id: int) -> list[str]:
        """Enabled modules in registry order — the order the UI renders."""
        rows = (
            self.db.query(CompanyModule.module)
            .filter(CompanyModule.company_id == company_id)
            .all()
        )
        enabled = {row[0] for row in rows}
        return [module for module in MODULES if module in enabled]

    def has_module(self, company_id: int, module: str) -> bool:
        return (
            self.db.query(CompanyModule.id)
            .filter(
                CompanyModule.company_id == company_id,
                CompanyModule.module == module,
            )
            .first()
            is not None
        )

    def set_modules(self, company_id: int, modules: list[str]) -> list[str]:
        """Replace the company's module set. Does not commit."""
        unknown = [module for module in modules if module not in MODULES]
        if unknown:
            raise ValueError(f"Unknown modules: {', '.join(sorted(unknown))}")

        self.db.query(CompanyModule).filter(
            CompanyModule.company_id == company_id
        ).delete(synchronize_session=False)
        for module in dict.fromkeys(modules):
            self.db.add(CompanyModule(company_id=company_id, module=module))
        return [module for module in MODULES if module in set(modules)]
