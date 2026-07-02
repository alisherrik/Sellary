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

## Backend Design

Extend `GET /api/sales` with an optional `search` query parameter, trimmed and limited to 100 characters. Pass it through `SaleService.get_all` to `SaleRepository.get_all`.

The repository keeps `Sale.company_id == company_id` as the mandatory outer predicate. It adds an OR expression across sale columns and related entities. Related customer and cashier fields use joins already required for response loading. Product matching uses an `EXISTS` subquery through `sale_items` and `products` so one sale is returned once even if several items match.

Numeric and date columns are cast to text for universal matching. Enum columns are cast to text before case-insensitive comparison so PostgreSQL enum behavior remains valid. Russian aliases are normalized into additional canonical search terms before the SQL predicates are built.

Existing pagination, date range, cashier, and status conditions remain composable with search. Results remain ordered newest first and limited by the existing API limit.

## Frontend Design

Add local `searchInput` state and derive a debounced `search` value. Pass `{ limit: 200, search, status }` to `useSales`; omit empty parameters. Query keys already include params, so TanStack Query caches each server-side search correctly.

Remove client-only status filtering because status is now sent to the API. KPI cards and the hourly chart calculate from the returned matching result set, making every visible summary consistent with the list.

Use the existing loading skeleton only for the initial load. During subsequent searches, keep previous query data visible and expose the query fetch state through the search control without clearing the page.

## Validation and Error Handling

- FastAPI rejects search strings longer than 100 characters.
- Whitespace-only search behaves like no search.
- Search never removes the company predicate.
- No-match requests return HTTP 200 with an empty list.
- Existing authentication and tenant isolation rules remain unchanged.
- Existing refresh, detail, return, and annulment actions continue to operate on the filtered result objects.

## Testing

Backend tests cover:

- matching receipt ID;
- matching cashier and customer data;
- matching product name and barcode through sale items;
- matching payment/status aliases;
- matching numeric and date text;
- combining search with status and company isolation;
- no-match behavior.

Frontend tests cover:

- forwarding the debounced search term to `useSales`;
- sending the selected status with search;
- clearing search restores the unfiltered request;
- rendering matching results and the empty state.

Production verification covers owner login, company entry, sales-history navigation, searches by receipt ID and product name, clearing search, console health, Railway logs, and Netlify/Railway deployment status.

## Out of Scope

- Separate advanced filter controls;
- fuzzy matching or typo correction;
- database-specific full-text search indexes;
- pagination UI beyond the existing result limit;
- exporting search results.
