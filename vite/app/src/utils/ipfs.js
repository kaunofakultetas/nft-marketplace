// -----------------------------------------------------------
//  [*] IPFS helpers — gateway rewriting and guarded fetches
//
//  NFT metadata lives on IPFS but tokenURIs come in many
//  shapes (ipfs://, ipfs.io links, gateway.ipfs.io links).
//  Everything is rewritten onto the LOCAL gateway (the
//  nft-ipfs container proxied at the configured prefix) so
//  requests stay same-origin, behind the password gate, and
//  never depend on public gateways being up.
//
//  Gateway prefix and timeout come from the runtime config
//  (config.js) — read lazily inside each call, never at
//  module load, because this module is imported before
//  loadConfig() resolves.
// -----------------------------------------------------------

import { getConfig } from '@/config';







// -----------------------------------------------------------
// toGatewayURL
// -----------------------------------------------------------
//
// Rewrites any known IPFS URI shape onto the local gateway;
// URIs that are neither ipfs:// nor a known public gateway
// pass through untouched (plain https metadata hosts work).
//
// Used by:
//   - components/NFTBox — metadata and image URLs
//   - pages/NftDetail   — metadata and image URLs
// -----------------------------------------------------------

export function toGatewayURL(uri) {
  if (!uri) return uri;

  const gateway = getConfig().ipfsGateway;

  // ipfs://<cid>/<path>?query
  if (uri.startsWith('ipfs://')) {
    return uri.replace('ipfs://', gateway);
  }

  // Path gateways, any host: https://<host>/ipfs/<cid>/<path>
  if (uri.includes('/ipfs/')) {
    return gateway + uri.split('/ipfs/', 2)[1];
  }

  // Subdomain gateways: https://<cid>.ipfs.<host>/<path> — the
  // CID rides in the HOSTNAME (dweb.link, nftstorage.link, …)
  const subdomain = uri.match(/^https?:\/\/([a-z0-9]+)\.ipfs\.[^/?]+(\/[^?]*)?/);
  if (subdomain) {
    return gateway + subdomain[1] + (subdomain[2] || '');
  }

  // Not IPFS-addressed at all (arweave.net, plain https, data:)
  // — the browser fetches it from where it lives
  return uri;
}







// -----------------------------------------------------------
// fetchWithTimeout
// -----------------------------------------------------------
//
// fetch() with an AbortController deadline — an unpinned CID
// otherwise hangs the gateway request forever and the card
// never leaves its loading state. The default deadline is the
// configured ipfsTimeout.
//
// Used by:
//   - components/NFTBox — metadata fetch
//   - pages/NftDetail   — metadata fetch
// -----------------------------------------------------------

export async function fetchWithTimeout(url, timeout) {
  const deadline = timeout || getConfig().ipfsTimeout;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), deadline);

  try {
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error(`Request timeout after ${deadline}ms: ${url}`);
    }
    throw error;
  }
}
