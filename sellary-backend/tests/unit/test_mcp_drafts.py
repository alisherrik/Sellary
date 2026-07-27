"""The draft token is what makes the owner's approval binding.

`purchase_commit` executes only what the token carries, so the token has to
resist the three things that would break that promise: expiry, tampering, and
being used by someone other than the person who previewed it.
"""

from datetime import datetime, timedelta, timezone

import jwt
import pytest
from fastmcp.exceptions import ToolError

from core.config import settings
from mcp_server.drafts import DRAFT_TOKEN_TYPE, issue_draft, read_draft

PLAN = {
    "supplier_id": 3,
    "supplier_name": "Ромашка",
    "lines": [
        {
            "status": "matched",
            "product_id": 11,
            "quantity": "10.000",
            "unit_cost": "5.0000",
        }
    ],
}


class TestRoundTrip:
    def test_a_draft_reads_back_as_it_was_issued(self):
        token = issue_draft(company_id=1, user_id=7, plan=PLAN)
        assert read_draft(token, company_id=1, user_id=7) == PLAN

    def test_the_token_is_not_readable_as_plain_text(self):
        token = issue_draft(company_id=1, user_id=7, plan=PLAN)
        assert "Ромашка" not in token


class TestBinding:
    def test_another_company_cannot_use_the_draft(self):
        """A token that leaked across tenants must be inert, not merely unlikely."""
        token = issue_draft(company_id=1, user_id=7, plan=PLAN)
        with pytest.raises(ToolError) as exc:
            read_draft(token, company_id=2, user_id=7)
        assert "другому" in str(exc.value)

    def test_another_user_cannot_commit_someone_elses_draft(self):
        token = issue_draft(company_id=1, user_id=7, plan=PLAN)
        with pytest.raises(ToolError):
            read_draft(token, company_id=1, user_id=8)


class TestRejection:
    def test_an_expired_draft_is_refused_with_an_actionable_message(self):
        expired = jwt.encode(
            {
                "token_type": DRAFT_TOKEN_TYPE,
                "company_id": 1,
                "user_id": 7,
                "plan": PLAN,
                "exp": datetime.now(timezone.utc) - timedelta(minutes=1),
            },
            settings.SECRET_KEY,
            algorithm=settings.ALGORITHM,
        )
        with pytest.raises(ToolError) as exc:
            read_draft(expired, company_id=1, user_id=7)
        assert "purchase_preview" in str(exc.value)

    def test_a_tampered_draft_is_refused(self):
        token = issue_draft(company_id=1, user_id=7, plan=PLAN)
        head, payload, signature = token.split(".")
        forged = f"{head}.{payload[:-4]}AAAA.{signature}"
        with pytest.raises(ToolError):
            read_draft(forged, company_id=1, user_id=7)

    def test_a_token_signed_with_another_key_is_refused(self):
        foreign = jwt.encode(
            {
                "token_type": DRAFT_TOKEN_TYPE,
                "company_id": 1,
                "user_id": 7,
                "plan": PLAN,
                "exp": datetime.now(timezone.utc) + timedelta(minutes=5),
            },
            "not-the-sellary-secret-key-at-all",
            algorithm="HS256",
        )
        with pytest.raises(ToolError):
            read_draft(foreign, company_id=1, user_id=7)

    def test_a_session_token_is_not_a_draft(self):
        """Only a token minted as a draft may drive a commit."""
        not_a_draft = jwt.encode(
            {
                "token_type": "access",
                "company_id": 1,
                "user_id": 7,
                "plan": PLAN,
                "exp": datetime.now(timezone.utc) + timedelta(minutes=5),
            },
            settings.SECRET_KEY,
            algorithm=settings.ALGORITHM,
        )
        with pytest.raises(ToolError) as exc:
            read_draft(not_a_draft, company_id=1, user_id=7)
        assert "не черновик" in str(exc.value).lower()

    def test_an_empty_plan_is_refused(self):
        token = issue_draft(company_id=1, user_id=7, plan={"lines": []})
        with pytest.raises(ToolError):
            read_draft(token, company_id=1, user_id=7)
