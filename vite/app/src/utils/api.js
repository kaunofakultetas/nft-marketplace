// -----------------------------------------------------------
//  [*] Backend API helper
//
//  All marketplace reads go to the nft-backend container
//  through the endpoint Caddy (/api/*, same origin, behind
//  the password gate). The backend indexes the contract into
//  SQLite — the GUI never talks to the chain for reads.
// -----------------------------------------------------------







// -----------------------------------------------------------
// apiGet
// -----------------------------------------------------------
//
// fetch() + status check + JSON parse. Backend error bodies
// are {"error": "..."} — surfaced instead of the bare HTTP
// status when present.
//
// Used by:
//   - pages/Home     — GET /api/listings
//   - pages/MyNfts   — GET /api/my-nfts/<wallet>, /api/listings
//   - pages/History  — GET /api/history
//   - pages/NftDetail — GET /api/nft/<address>/<tokenId>
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
