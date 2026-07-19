from services.merchant_link_token import mint_company_ref, verify_company_ref

SECRET = "unit-test-secret-key-at-least-32-chars-long!!"


def test_round_trip():
    token = mint_company_ref(42, secret=SECRET)
    assert verify_company_ref(token, secret=SECRET) == 42


def test_tampered_token_rejected():
    token = mint_company_ref(42, secret=SECRET)
    assert verify_company_ref(token[:-1] + ("A" if token[-1] != "A" else "B"), secret=SECRET) is None


def test_wrong_secret_rejected():
    token = mint_company_ref(42, secret=SECRET)
    assert verify_company_ref(token, secret="different-secret") is None


def test_garbage_rejected():
    assert verify_company_ref("not-a-token", secret=SECRET) is None
    assert verify_company_ref("", secret=SECRET) is None


def test_fits_telegram_start_budget():
    # Telegram /start payload: <=64 chars, [A-Za-z0-9_-] only.
    import re
    token = mint_company_ref(2_000_000_000, secret=SECRET)
    assert len(token) <= 64
    assert re.fullmatch(r"[A-Za-z0-9_-]+", token)
