// -----------------------------------------------------------
//  [*] Test support — where the router is, and moving it
//
//  The SPA navigates (a card opens its NFT, the header's
//  links, the detail page's "List for Sale", the empty
//  states' buttons); a test needs to see where a click took
//  the student — the address bar:
//
//    LocationProbe / currentPath — for renderPage (a memory
//                   router): the probe renders the router's
//                   pathname + search where currentPath
//                   reads it
//    navigateTo   — for renderApp (App's own BrowserRouter):
//                   what the browser's Back / Forward / an
//                   address typed does — the History API plus
//                   the popstate the router listens to
//    goBack       — history.back(), inside act
//
//  Under renderApp the address bar is window.location itself.
//
//  Used by:
//    - components/nft-box.test.jsx, nft-thumb.test.jsx
//    - pages/home.test.jsx, my-nfts.test.jsx,
//      nft-detail/actions.test.jsx
//    - core/app.test.jsx
// -----------------------------------------------------------

import { act, screen } from '@testing-library/react';
import { useLocation } from 'react-router-dom';







// -----------------------------------------------------------
// LocationProbe / currentPath
// -----------------------------------------------------------
//
// The probe is rendered beside the element under test, inside
// renderPage's memory router, and writes the router's pathname
// and search into a hidden output; currentPath reads it back,
// so a test can assert where a click took the student.
//
// Used by:
//   - the component and page tests that render with renderPage
// -----------------------------------------------------------

export function LocationProbe() {
  const { pathname, search } = useLocation();
  return <output data-testid="location" hidden>{pathname + search}</output>;
}

export const currentPath = () => screen.getByTestId('location').textContent;







// -----------------------------------------------------------
// navigateTo / goBack
// -----------------------------------------------------------
//
// navigateTo pushes a path onto the history and fires the
// popstate the router listens to; goBack is the browser's
// Back. Both run inside act. jsdom delivers history.back()'s
// popstate on a later task, so a test waits for the location
// after goBack.
//
// Used by:
//   - core/app.test.jsx
// -----------------------------------------------------------

export async function navigateTo(path) {
  await act(async () => {
    window.history.pushState(null, '', path);
    window.dispatchEvent(new PopStateEvent('popstate', { state: null }));
  });
}

export async function goBack() {
  await act(async () => {
    window.history.back();
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}
