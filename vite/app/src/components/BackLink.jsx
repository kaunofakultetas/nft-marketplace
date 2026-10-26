// -----------------------------------------------------------
//  [*] BackLink — "← Back to …", to where the student came from
//
//  Every page's way back. Opened from another page of the app,
//  it names that page and takes the student back to it with
//  the browser's own Back — the same entry, so the history
//  stays the one the student walked and Forward still leads
//  here. Opened directly (a bookmark, a typed address, a new
//  tab) there is nothing of the app's to go back to, and it
//  leads to the marketplace instead. Where the page came from
//  is what the link that opened it left in the history entry
//  (hooks/useLinkState).
//
//  Split into (root component last):
//
//    PAGE_NAMES — every page's name in a back link
//    pageName   — the name of the page at a path
//    BackLink   — the link itself (default export)
//
//  Used by:
//    - pages/NftDetail, pages/MyNfts, pages/SellNft,
//      pages/History, pages/NotFound
// -----------------------------------------------------------

import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useLinkState } from '@/hooks/useLinkState';


// Every page by the name a back link gives it — the header's
// own words, the storefront being the marketplace
const PAGE_NAMES = {
  '/': 'Marketplace',
  '/my-nfts': 'My NFTs',
  '/sell-nft': 'Sell NFT',
  '/history': 'Activity',
  '/about': 'About',
};

// The link's look, whichever way it leads: a white button on
// the grey canvas, outlined like the app's white cards, in
// the brand burgundy on hover
const LINK_CLASS = 'inline-block bg-white border border-gray-300 rounded-lg px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:border-[var(--color-primary)] hover:text-[var(--color-primary)] transition-colors';







// -----------------------------------------------------------
// pageName
// -----------------------------------------------------------
//
// The name of the page at an address: one of the header's
// pages, a token's page by its id, or the sell form by the
// token its query prefills — the prefilled form is another
// page than the plain one the header opens, whose way back
// would otherwise name its own page. Nothing for an address
// no page answers to.
//
// Used by:
//   - BackLink (below)
// -----------------------------------------------------------

function pageName(path) {
  const [pathname, query] = path.split('?');
  const prefilled = new URLSearchParams(query).get('tokenId');
  if (pathname === '/sell-nft' && prefilled) return `Sell NFT #${prefilled}`;
  if (pathname in PAGE_NAMES) return PAGE_NAMES[pathname];

  const token = pathname.match(/^\/nft\/[^/]+\/([^/]+)$/);
  return token ? `NFT #${token[1]}` : null;
}







// -----------------------------------------------------------
// BackLink (default export)
// -----------------------------------------------------------
//
// Back to the page this one was opened from, by its name — or
// to the marketplace, for a page opened directly or from an
// address no page answers to. A plain click goes back through
// the history; a click that opens a new tab or window opens
// the page it names there, as any link does. className adds
// the page's own spacing.
//
// Used by:
//   - pages/NftDetail, pages/MyNfts, pages/SellNft,
//     pages/History — at the top of the page
//   - pages/NotFound — the way out, under its message
// -----------------------------------------------------------

export default function BackLink({ className = '' }) {

  const { state } = useLocation();
  const navigate = useNavigate();
  const linkState = useLinkState();

  const from = typeof state?.from === 'string' ? state.from : null;
  const name = from ? pageName(from) : null;


  if (!name) {
    return (
      <Link to="/" state={linkState('/')} className={`${LINK_CLASS} ${className}`}>
        ← Back to Marketplace
      </Link>
    );
  }


  // The browser's Back for a plain click — a modified one
  // (a new tab, a new window) is left to the link itself
  const goBack = (event) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(-1);
  };


  return (
    <Link to={from} onClick={goBack} className={`${LINK_CLASS} ${className}`}>
      ← Back to {name}
    </Link>
  );
}
