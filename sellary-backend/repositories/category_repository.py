from sqlalchemy.orm import Session
from models.category import Category
from models.product import Product
from typing import Optional, List


class CategoryRepository:
    def __init__(self, db: Session):
        self.db = db

    def get_by_id(self, company_id: int, category_id: int) -> Optional[Category]:
        return self.db.query(Category).filter(
            Category.company_id == company_id,
            Category.id == category_id,
        ).first()

    def get_by_name(self, company_id: int, name: str) -> Optional[Category]:
        return self.db.query(Category).filter(
            Category.company_id == company_id,
            Category.name == name,
        ).first()

    def get_all(
        self,
        company_id: int,
        skip: int = 0,
        limit: int = 100,
        active_only: bool = False,
    ) -> List[Category]:
        query = self.db.query(Category).filter(Category.company_id == company_id)
        if active_only:
            query = query.filter(Category.is_active == True)
        return query.offset(skip).limit(limit).all()

    def create(self, category: Category) -> Category:
        self.db.add(category)
        self.db.commit()
        self.db.refresh(category)
        return category

    def update(self, category: Category) -> Category:
        self.db.commit()
        self.db.refresh(category)
        return category

    def delete(self, company_id: int, category_id: int) -> bool:
        category = self.get_by_id(company_id, category_id)
        if category:
            # Detach products so they stay visible as "uncategorized" instead of
            # pointing at a now-inactive (hidden) category.
            self.db.query(Product).filter(
                Product.company_id == company_id,
                Product.category_id == category_id,
            ).update({Product.category_id: None}, synchronize_session=False)
            category.is_active = False
            self.db.flush()
            self.db.commit()
            return True
        return False
