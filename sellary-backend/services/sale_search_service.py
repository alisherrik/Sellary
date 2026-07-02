"""Typo-tolerant vocabulary ranking for sales-history search."""

from dataclasses import dataclass
import re
from typing import Literal, Sequence

from rapidfuzz import fuzz


SuggestionKind = Literal["product", "cashier", "customer", "status", "payment"]
DISPLAY_SCORE = 55
AUTOMATIC_SCORE = 82


@dataclass(frozen=True)
class SearchCandidate:
    kind: SuggestionKind
    label: str
    value: str
    canonical_terms: tuple[str, ...] = ()

    @property
    def terms(self) -> tuple[str, ...]:
        return self.canonical_terms or (self.value,)


@dataclass(frozen=True)
class RankedSuggestion:
    kind: SuggestionKind
    label: str
    value: str
    score: int
    canonical_terms: tuple[str, ...]


STATIC_SEARCH_CANDIDATES: tuple[SearchCandidate, ...] = (
    SearchCandidate("payment", "Наличные", "наличные", ("cash",)),
    SearchCandidate("payment", "Карта", "карта", ("card",)),
    SearchCandidate("payment", "Мобильный", "мобильный", ("mobile",)),
    SearchCandidate("payment", "Alif", "alif", ("alif",)),
    SearchCandidate("payment", "Eskhata", "eskhata", ("eskhata",)),
    SearchCandidate("payment", "DC", "dc", ("dc",)),
    SearchCandidate("status", "Завершён", "завершён", ("completed",)),
    SearchCandidate("status", "Завершен", "завершен", ("completed",)),
    SearchCandidate(
        "status",
        "Возврат",
        "возврат",
        ("returned", "partially_returned"),
    ),
    SearchCandidate("status", "Аннулирован", "аннулирован", ("cancelled",)),
)


def normalize_search(value: str) -> str:
    """Normalize user input without changing letters or transliterating names."""

    return re.sub(r"\s+", " ", value.strip().casefold())


def rank_candidates(
    query: str,
    candidates: Sequence[SearchCandidate],
    *,
    limit: int = 8,
    min_score: int = DISPLAY_SCORE,
) -> list[RankedSuggestion]:
    normalized_query = normalize_search(query)
    if len(normalized_query) < 2:
        return []

    ranked: list[RankedSuggestion] = []
    seen: set[tuple[str, str]] = set()
    for candidate in candidates:
        key = (candidate.kind, normalize_search(candidate.value))
        if key in seen:
            continue
        seen.add(key)

        score = max(
            fuzz.WRatio(normalized_query, normalize_search(candidate.label)),
            fuzz.WRatio(normalized_query, normalize_search(candidate.value)),
        )
        rounded_score = round(score)
        if rounded_score < min_score:
            continue
        ranked.append(
            RankedSuggestion(
                kind=candidate.kind,
                label=candidate.label,
                value=candidate.value,
                score=rounded_score,
                canonical_terms=candidate.terms,
            )
        )

    ranked.sort(key=lambda item: (-item.score, item.label.casefold(), item.kind))
    return ranked[:limit]


def automatic_terms(
    query: str,
    candidates: Sequence[SearchCandidate],
    *,
    threshold: int = AUTOMATIC_SCORE,
) -> list[str]:
    """Return the original query plus only safe, high-confidence corrections."""

    original = query.strip()
    if not original:
        return []

    terms = [original]
    seen = {normalize_search(original)}
    for suggestion in rank_candidates(
        original,
        candidates,
        limit=3,
        min_score=threshold,
    ):
        for term in suggestion.canonical_terms:
            normalized = normalize_search(term)
            if normalized and normalized not in seen:
                seen.add(normalized)
                terms.append(term)
    return terms
