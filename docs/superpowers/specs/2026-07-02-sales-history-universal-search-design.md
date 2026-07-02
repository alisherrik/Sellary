# Sales History Universal Search Design

## Goal

Add one universal search field to the Russian-language sales history page. The search must run on the server so it covers the company's full sales history rather than only the latest rows already loaded in the browser.

## User Experience

- Place one search input in the sales history header beside the existing status tabs and refresh action.
- Use the placeholder `Поиск по чеку, товару, кассиру, сумме...`.
- Debounce input by 300 milliseconds before requesting the server.
- Keep the existing status tabs. A selected tab and the search term apply together.
- Empty search preserves the current behavior and shows the latest sales.
- While a new search is loading, retain the previous result list to avoid visual flicker.
- When no sale matches, show the existing `Продажи не найдены` empty state.
- Show a keyboard-accessible suggestion panel under the input after two characters.
- Label suggestions by source: `Товар`, `Кассир`, `Клиент`, `Статус`, or `Оплата`.
- Support Arrow Up/Down, Enter, Escape, mouse selection, a clear button, and visible loading state.
- Present low-confidence matches as `Возможно, вы искали` instead of silently replacing the user's text.
- Automatically include a corrected term in the result query only when its fuzzy score is high enough to avoid surprising matches.

## Searchable Data

The single query matches, case-insensitively where applicable:

- receipt/sale ID;
- sale creation date and time in ISO-compatible textual form;
- cashier username and full name;
- customer name, phone, and email;
- product name and barcode from any sale item;
- payment method and card type;
- sale status;
- subtotal, tax, discount, total, and refunded amount where available;
- sale notes and annulment reason.

The backend also recognizes common Russian aliases for enum-backed values:

- `наличные` → `cash`;
- `карта` → `card`;
- `мобильный` → `mobile`;
- `завершён` / `завершен` → `completed`;
- `возврат` → returned and partially returned sales;
- `аннулирован` → `cancelled`.

Misspelled entity values such as `колаа`, `кала`, or `aliff` are compared with the tenant's sold product names/barcodes, sale customers, and sale cashiers. Close values are returned as suggestions. High-confidence corrections also participate in result matching, while the original query always remains visible in the input.

## Backend Design

Extend `GET /api/sales` with an optional `search` query parameter, trimmed and limited to 100 characters. Pass it through `SaleService.get_all` to `SaleRepository.get_all`.

Add `GET /api/sales/search-suggestions?q=...&limit=...`. It returns typed suggestion objects containing `kind`, `label`, `value`, and `score`. The service obtains distinct, tenant-scoped candidates from sales-related products, customers, and cashiers through the repository, adds static status/payment aliases, and ranks candidates with RapidFuzz. Suggestions below the display threshold are discarded; only higher-confidence matches are added as automatic search variants.

The repository keeps `Sale.company_id == company_id` as the mandatory outer predicate. It adds an OR expression across sale columns and related entities. Related customer and cashier fields use joins already required for response loading. Product matching uses an `EXISTS` subquery through `sale_items` and `products` so one sale is returned once even if several items match.

Numeric and date columns are cast to text for universal matching. Enum columns are cast to text before case-insensitive comparison so PostgreSQL enum behavior remains valid. Russian aliases are normalized into additional canonical search terms before the SQL predicates are built.

Application-level fuzzy ranking is preferred over a PostgreSQL extension. This keeps SQLite tests and PostgreSQL production behavior consistent, requires no database extension or index migration, and is fast enough for the bounded distinct candidate vocabulary used by a retail company.

Existing pagination, date range, cashier, and status conditions remain composable with search. Results remain ordered newest first and limited by the existing API limit.

## Frontend Design

Add local `searchInput` state and derive a debounced `search` value. Pass `{ limit: 200, search, status }` to `useSales`; omit empty parameters. Query keys already include params, so TanStack Query caches each server-side search correctly.

Add a dedicated `useSaleSearchSuggestions` hook and a focused `SalesSearch` component. The component owns suggestion-panel visibility and keyboard selection; the page owns the search value and server query parameters. Clicking or pressing Enter on a suggestion replaces the input with its canonical value and closes the panel.

Remove client-only status filtering because status is now sent to the API. KPI cards and the hourly chart calculate from the returned matching result set, making every visible summary consistent with the list.

Use the existing loading skeleton only for the initial load. During subsequent searches, keep previous query data visible and expose the query fetch state through the search control without clearing the page.

## Validation and Error Handling

- FastAPI rejects search strings longer than 100 characters.
- Whitespace-only search behaves like no search.
- Search never removes the company predicate.
- No-match requests return HTTP 200 with an empty list.
- Existing authentication and tenant isolation rules remain unchanged.
- Existing refresh, detail, return, and annulment actions continue to operate on the filtered result objects.
- Suggestion candidates are always constrained through sales belonging to the active company.
- Fuzzy ranking never returns raw data from another tenant.

## Testing

Backend tests cover:

- matching receipt ID;
- matching cashier and customer data;
- matching product name and barcode through sale items;
- matching payment/status aliases;
- matching numeric and date text;
- combining search with status and company isolation;
- no-match behavior.
- typo suggestion ranking and confidence thresholds;
- suggestion tenant isolation;
- automatic high-confidence correction without low-confidence false positives.

Frontend tests cover:

- forwarding the debounced search term to `useSales`;
- sending the selected status with search;
- clearing search restores the unfiltered request;
- rendering matching results and the empty state.
- suggestion dropdown labels, keyboard navigation, selection, clear action, and loading state.

Production verification covers owner login, company entry, sales-history navigation, searches by receipt ID and product name, clearing search, console health, Railway logs, and Netlify/Railway deployment status.

## Out of Scope

- Separate advanced filter controls;
- database-specific full-text search indexes;
- pagination UI beyond the existing result limit;
- exporting search results.
