from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from api.dependencies import AuthContext, get_auth_context, require_manager_or_admin
from core.database import get_db
from models.category import Category as CategoryModel
from repositories.category_repository import CategoryRepository
from schemas.category import Category as CategorySchema
from schemas.category import CategoryCreate, CategoryUpdate

router = APIRouter(prefix="/categories", tags=["categories"])


@router.get("", response_model=list[CategorySchema])
def get_categories(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=200),
    active_only: bool = False,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(get_auth_context),
):
    repo = CategoryRepository(db)
    return repo.get_all(auth.company_id, skip=skip, limit=limit, active_only=active_only)


@router.get("/{category_id}", response_model=CategorySchema)
def get_category(
    category_id: int,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(get_auth_context),
):
    repo = CategoryRepository(db)
    category = repo.get_by_id(auth.company_id, category_id)
    if not category:
        raise HTTPException(status_code=404, detail="Category not found")
    return category


@router.post("", response_model=CategorySchema, status_code=201)
def create_category(
    category_create: CategoryCreate,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_manager_or_admin),
):
    repo = CategoryRepository(db)
    if repo.get_by_name(auth.company_id, category_create.name):
        raise HTTPException(status_code=400, detail="Category with this name already exists")
    return repo.create(CategoryModel(company_id=auth.company_id, **category_create.model_dump()))


@router.put("/{category_id}", response_model=CategorySchema)
def update_category(
    category_id: int,
    category_update: CategoryUpdate,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_manager_or_admin),
):
    repo = CategoryRepository(db)
    category = repo.get_by_id(auth.company_id, category_id)
    if not category:
        raise HTTPException(status_code=404, detail="Category not found")

    update_data = category_update.model_dump(exclude_unset=True)
    if "name" in update_data and repo.get_by_name(auth.company_id, update_data["name"]):
        existing = repo.get_by_name(auth.company_id, update_data["name"])
        if existing and existing.id != category_id:
            raise HTTPException(status_code=400, detail="Category with this name already exists")
    for field, value in update_data.items():
        setattr(category, field, value)

    return repo.update(category)


@router.delete("/{category_id}", status_code=204)
def delete_category(
    category_id: int,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_manager_or_admin),
):
    repo = CategoryRepository(db)
    if not repo.delete(auth.company_id, category_id):
        raise HTTPException(status_code=404, detail="Category not found")
