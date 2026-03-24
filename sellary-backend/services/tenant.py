from sqlalchemy.orm import Session


def resolve_company_id(db: Session, company_id: int | None) -> int:
    if company_id is not None:
        return company_id

    default_company_id = db.info.get("default_company_id")
    if default_company_id is None:
        raise ValueError("company_id is required")
    return default_company_id
