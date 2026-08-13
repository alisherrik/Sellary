from datetime import datetime

from pydantic import BaseModel


class FindingOut(BaseModel):
    check: str
    company_id: int
    subject: str
    expected: str
    actual: str
    bucket: str
    note: str = ""

    model_config = {"from_attributes": True}


class ConsistencyReport(BaseModel):
    checked_at: datetime
    clean: bool
    findings: list[FindingOut]
