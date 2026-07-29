/**
 * Where the «Помощь» button goes.
 *
 * The book is published from `docs/user/book/` in this repo (see mkdocs.yml).
 * The map below sends a user to the chapter for the page they are standing on
 * — the whole point of the button is not to make them search for what they
 * were already looking at. Anything unmapped lands on the index, which opens
 * with «Быстрые ответы».
 */
export const HELP_BASE_URL = 'https://alisherrik.github.io/Sellary';

// Longest prefix wins, so the list is ordered most-specific first.
const CHAPTER_BY_PREFIX: Array<[string, string]> = [
  ['/pos', 'kassa/prodazha/'],
  ['/shifts', 'kassa/smena/'],
  ['/sales', 'prodazhi/'],
  ['/customers', 'klienty/'],
  ['/products', 'sklad/tovary/'],
  ['/write-offs', 'sklad/spisaniya/'],
  ['/suppliers', 'zakupki/postavshchiki/'],
  ['/purchase-report', 'zakupki/otchet/'],
  ['/purchase-orders', 'zakupki/zakazy/'],
  ['/orders', 'magazin/'],
  ['/dashboard', 'otchety/dashboard/'],
  ['/reports', 'otchety/analitika/'],
  ['/finance', 'dengi/'],
  ['/settings', 'nastroyki/'],
];

export function helpUrlFor(pathname: string): string {
  const hit = CHAPTER_BY_PREFIX.find(
    ([prefix]) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
  return hit ? `${HELP_BASE_URL}/${hit[1]}` : `${HELP_BASE_URL}/`;
}
