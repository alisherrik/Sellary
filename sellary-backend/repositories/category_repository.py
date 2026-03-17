from sqlalchemy.orm import Session
from models.category import Category
from typing import Optional, List


class CategoryRepository:
    def __init__(self, db: Session):
        self.db = db

    def get_by_id(self, category_id: int) -> Optional[Category]:
        return self.db.query(Category).filter(Category.id == category_id).first()

    def get_by_name(self, name: str) -> Optional[Category]:
        return self.db.query(Category).filter(Category.name == name).first()

    def get_all(
        self, skip: int = 0, limit: int = 100, active_only: bool = False
    ) -> List[Category]:
        query = self.db.query(Category)
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

    def delete(self, category_id: int) -> bool:
        category = self.get_by_id(category_id)
        if category:
            self.db.delete(category)
            self.db.commit()
            return True
        return False
