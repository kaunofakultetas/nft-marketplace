// -----------------------------------------------------------
//  [*] Test support — the NFT detail page, mounted and read
//
//  The detail page loads progressively from three sources (the
//  metadata through IPFS, the owner through the relay on its
//  own request, the listing, history and archive from the
//  backend),
//  each filling its own panels. The tests of its folder share
//  how they mount it and how they read its panels:
//
//    renderDetail — the page on its route for a token, for a
//                   returning student or a browser without a
//                   wallet, with a probe of where it navigated
//    infoRow      — one fact of the info panel by its label
//    panel        — a card by its heading
//    stripes      — the history timeline, as each stripe reads
//    archiveRows  — the archive panel's rows
//
//  Used by:
//    - pages/nft-detail/*.test.jsx
// -----------------------------------------------------------

import { screen, within } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { renderPage } from '../render';
import { LocationProbe } from '../shell/router';
import { installMetamask } from '../wallets/metamask';
import NftDetailPage from '@/pages/NftDetail/Page';







// -----------------------------------------------------------
// renderDetail
// -----------------------------------------------------------
//
// Mounts the page at /nft/<nftAddress>/<tokenId> on its route
// pattern, for a returning student (their wallet reconnected
// on load, with the accounts the test names) unless told the
// browser has no wallet; the MetaMask double comes back with
// the view.
//
// Used by:
//   - pages/nft-detail/*.test.jsx
// -----------------------------------------------------------

export function renderDetail(nftAddress, tokenId, { wallet = true, accounts } = {}) {
  const metamask = wallet ? installMetamask({ connected: true, accounts }) : null;

  // The probe sits outside the route, so it still reports
  // where a link took the student once the page is gone
  const view = renderPage(
    <>
      <Routes>
        <Route path="/nft/:nftAddress/:tokenId" element={<NftDetailPage />} />
      </Routes>
      <LocationProbe />
    </>,
    { route: `/nft/${nftAddress}/${tokenId}` },
  );
  return { ...view, metamask };
}







// -----------------------------------------------------------
// infoRow / panel
// -----------------------------------------------------------
//
// infoRow is the value next to a label of the info panel
// ("Current Owner:" and its peers) — the link itself where
// the value is one; panel is the card a heading titles —
// level 3, as the side cards are.
//
// Used by:
//   - pages/nft-detail/*.test.jsx
// -----------------------------------------------------------

export const infoRow = (label) => screen.getByText(label).nextElementSibling;

export const panel = (title) => screen.getByRole('heading', { level: 3, name: title }).parentElement;







// -----------------------------------------------------------
// stripes / archiveRows
// -----------------------------------------------------------
//
// stripes reads the history timeline top to bottom, each
// stripe as its whole text — found from its chip, the one
// thing every stripe shows (the timeline is no list for
// assistive tech, so there is no row to ask for). archiveRows
// reads the archive panel the same way from each row's file
// kind: the kind, the shortened CID (empty when there is
// none) and the status.
//
// Used by:
//   - pages/nft-detail/history.test.jsx, contract.test.jsx
// -----------------------------------------------------------

const STRIPE_CHIPS = /^(Listed|Price updated|Sold|Cancelled)$/;

export const stripes = () => within(panel('Transaction History'))
  .queryAllByText(STRIPE_CHIPS)
  .map((chip) => chip.parentElement.parentElement.parentElement.textContent);

export const archiveRows = () => within(panel('IPFS Archive'))
  .queryAllByText(/^(metadata|image)$/)
  .map((kind) => {
    const chips = [...kind.nextElementSibling.children];
    const cid = chips.length > 1 ? chips[0].textContent : '';
    return [kind.textContent, cid, chips[chips.length - 1].textContent];
  });
