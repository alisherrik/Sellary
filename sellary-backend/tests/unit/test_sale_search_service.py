from services.sale_search_service import (
    STATIC_SEARCH_CANDIDATES,
    SearchCandidate,
    automatic_terms,
    normalize_search,
    rank_candidates,
)


def test_normalize_search_casefolds_and_collapses_whitespace():
    assert normalize_search("  КОла\t  1.5л ") == "кола 1.5л"


def test_rank_candidates_finds_close_product_name():
    suggestions = rank_candidates(
        "колаа",
        [SearchCandidate("product", "Кола", "Кола")],
    )

    assert suggestions[0].label == "Кола"
    assert suggestions[0].kind == "product"
    assert suggestions[0].score >= 82


def test_rank_candidates_finds_misspelled_payment_alias():
    suggestions = rank_candidates("aliff", STATIC_SEARCH_CANDIDATES)

    assert suggestions[0].label == "Alif"
    assert suggestions[0].kind == "payment"


def test_rank_candidates_discards_unrelated_values():
    suggestions = rank_candidates(
        "xyz",
        [SearchCandidate("product", "Кола", "Кола")],
    )

    assert suggestions == []


def test_automatic_terms_include_canonical_term_only_at_high_confidence():
    typo_terms = automatic_terms(
        "наличние",
        STATIC_SEARCH_CANDIDATES,
    )
    unrelated_terms = automatic_terms(
        "xyz",
        [SearchCandidate("product", "Кола", "Кола")],
    )

    assert typo_terms[0] == "наличние"
    assert "cash" in typo_terms
    assert unrelated_terms == ["xyz"]


def test_rank_candidates_deduplicates_same_kind_and_value():
    candidate = SearchCandidate("product", "Кола", "Кола")

    suggestions = rank_candidates("кола", [candidate, candidate])

    assert len(suggestions) == 1
