// -----------------------------------------------------------
//  [*] Runtime configuration — fetched from the backend
//
//  The bundle is built with ZERO environment variables: every
//  deployment value is fetched once at startup from the
//  backend (proxied by the endpoint Caddy) and held in this
//  module. loadConfig() runs BEFORE React mounts (main.jsx),
//  so everything after it may call getConfig() synchronously.
//
//  Backend contract — GET /api/config → JSON:
//
//    nftMarketplaceAddress — marketplace contract address
//    rpcUrl                — Sepolia JSON-RPC endpoint; a
//                            RELATIVE path (/api/rpc — the
//                            backend's relay, so no provider
//                            key ever reaches the browser)
//                            resolved to absolute here
//                            because ethers needs full URLs
//    ipfsGateway           — IPFS gateway prefix (default /ipfs/)
//    ipfsTimeout           — IPFS fetch timeout ms (default 10000)
//
//  Served by the nft-backend container (backend/main.py)
//  from env vars set on its docker-compose service; while
//  the backend is down the app shows the error screen from
//  main.jsx.
// -----------------------------------------------------------


let config = null;







// -----------------------------------------------------------
// loadConfig
// -----------------------------------------------------------
//
// Fetches /api/config and stores it with defaults applied;
// throws on any network/HTTP/parse failure so the caller can
// show the error screen.
//
// Used by:
//   - main.jsx — bootstrap(), before the first render
// -----------------------------------------------------------

export async function loadConfig() {
  const response = await fetch('/api/config');
  if (!response.ok) {
    throw new Error(`GET /api/config failed: HTTP ${response.status}`);
  }
  const data = await response.json();

  config = {
    nftMarketplaceAddress: data.nftMarketplaceAddress,
    rpcUrl: new URL(data.rpcUrl, window.location.origin).href,
    ipfsGateway: data.ipfsGateway || '/ipfs/',
    ipfsTimeout: parseInt(data.ipfsTimeout) || 10000,
  };
  return config;
}







// -----------------------------------------------------------
// getConfig
// -----------------------------------------------------------
//
// Synchronous accessor — safe anywhere below the React root
// because bootstrap() awaits loadConfig() first.
//
// Used by:
//   - utils/ipfs.js — gateway prefix and timeout
//   - pages/SellNft — marketplace address, RPC URL
//   - pages/NftDetail — marketplace address, RPC URL
// -----------------------------------------------------------

export function getConfig() {
  if (!config) {
    throw new Error('getConfig() called before loadConfig()');
  }
  return config;
}
