// -----------------------------------------------------------
//  [*] Backend API helper — every read from the backend
//
//  All marketplace reads go to the nft-backend container
//  through the endpoint Caddy (/api/*, same origin, behind
//  the password gate). The backend indexes the contract into
//  SQLite — every list, price and history the GUI shows
//  comes from there; the chain itself is only read for what
//  one token or one wallet needs, through the relay.
// -----------------------------------------------------------







// -----------------------------------------------------------
// apiGet
// -----------------------------------------------------------
//
// A fetch on the page's own origin, its status checked and
// its JSON parsed. A failed answer throws the backend's own
// sentence when its body carries one under "error", and
// names the path and the HTTP status otherwise.
//
// Used by:
//   - pages/Home      — GET /api/stats, /api/listings
//   - pages/MyNfts    — GET /api/my-nfts/<wallet>, /api/listings
//   - pages/SellNft   — GET /api/my-nfts/<wallet>, /api/listings
//   - pages/History   — GET /api/activity
//   - pages/NftDetail — GET /api/nft/<address>/<tokenId>
//   - pages/About     — GET /api/stats
// -----------------------------------------------------------

export async function apiGet(path) {
  const response = await fetch(path);
  if (!response.ok) {
    let message = `GET ${path} failed: HTTP ${response.status}`;
    try {
      const body = await response.json();
      if (body.error) message = body.error;
    } catch { /* not JSON — keep the HTTP message */ }
    throw new Error(message);
  }
  return response.json();
}
