from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import Optional
from core.database import get_db
from schemas.category import CategoryCreate, CategoryUpdate, Category
from repositories.category_repository import CategoryRepository
from api.dependencies import get_current_user, require_manager_or_admin
from models.user import User

router = APIRouter(prefix="/categories", tags=["categories"])


@router.get("", response_model=list[Category])
def get_categories(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=200),
    active_only: bool = False,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    repo = CategoryRepository(db)
    return repo.get_all(skip=skip, limit=limit, active_only=active_only)


@router.get("/{category_id}", response_model=Category)
def get_category(
    category_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    repo = CategoryRepository(db)
    category = repo.get_by_id(category_id)
    if not category:
        raise HTTPException(status_code=404, detail="Category not found")
    return category


@router.post("", response_model=Category, status_code=201)
def create_category(
    category_create: CategoryCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_manager_or_admin),
):
    repo = CategoryRepository(db)
    if repo.get_by_name(category_create.name):
        raise HTTPException(status_code=400, detail="Category with this name already exists")
    return repo.create(Category(**category_create.model_dump()))


@router.put("/{category_id}", response_model=Category)
def update_category(
    category_id: int,
    category_update: CategoryUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_manager_or_admin),
):
    repo = CategoryRepository(db)
    category = repo.get_by_id(category_id)
    if not category:
        raise HTTPException(status_code=404, detail="Category not found")

    update_data = category_update.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(category, field, value)

    return repo.update(category)


@router.delete("/{category_id}", status_code=204)
def delete_category(
    category_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_manager_or_admin),
):
    repo = CategoryRepository(db)
    if not repo.delete(category_id):
        raise HTTPException(status_code=404, detail="Category not found")
