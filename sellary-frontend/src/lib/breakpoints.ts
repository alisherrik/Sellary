/**
 * One breakpoint decides which shell the app wears, and it is deliberately
 * Tailwind's `lg` boundary (1024px), not a phone width.
 *
 * The desktop shell costs 290px of permanent chrome (74px rail + 216px
 * secondary sidebar). Below 1024px that left a tablet ~478px of content while
 * page layouts — which all switch at `lg:` — were still in their mobile
 * configuration: a desktop sidebar next to a mobile chip row, a phone bottom
 * sheet painting over the rail, an orders list crushed to 94px. Aligning the
 * shell to the same boundary the pages use makes 768–1023px a viewport
 * somebody owns.
 */
export const MOBILE_QUERY = '(max-width: 1023px)';
