// -----------------------------------------------------------
//  [*] useLinkState — where an in-app link was followed from
//
//  The back links (components/BackLink) take the student back
//  to the page they came from, named after it — so every
//  in-app link leaves the page it was followed from in the
//  state of the history entry it opens. Kept in the entry
//  itself, it survives a reload and the browser's Back and
//  Forward; a page opened any other way — a bookmark, a typed
//  address, a new tab — simply has none.
// -----------------------------------------------------------

import { useLocation } from 'react-router-dom';







// -----------------------------------------------------------
// useLinkState
// -----------------------------------------------------------
//
// Hands back a function giving a link's state: the current
// page, as the one the link's target was opened from. A link
// to the very page it sits on — the router then replaces the
// entry rather than adding one — keeps the entry's own state
// instead, so a page never names itself as where it was
// opened from. Links that never point at their own page call
// it without a target.
//
// Used by:
//   - components/Header — the wordmark and every nav link
//   - components/NFTBox, components/NftThumb — a token's page
//   - components/BackLink — the marketplace, for a page opened
//     directly
//   - pages/Home, pages/MyNfts, pages/NftDetail — their links
//     to other pages
// -----------------------------------------------------------

export function useLinkState() {
  const location = useLocation();
  const here = location.pathname + location.search;

  return (to) => (to === here ? location.state : { from: here });
}
