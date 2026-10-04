// -----------------------------------------------------------
//  [*] Test support — default handlers for everything the SPA asks
//
//  The happy path of everything behind the endpoint as the SPA
//  sees it, one msw handler per route the code under src/
//  reaches — all on the page's own origin, as the endpoint
//  Caddy serves them:
//
//    - the backend's API (/api/config, /api/stats,
//      /api/listings, /api/activity, /api/nft/…,
//      /api/my-nfts/…), answering the fixtures in the
//      backend's shapes and behaving like it where a page
//      depends on it: /api/activity honours ?limit= (100 by
//      default, at most 500), /api/nft/… lowercases the
//      address, a wallet that never held anything is an empty
//      list
//    - the backend's JSON-RPC relay (POST /api/rpc) — the
//      Sepolia double in chain/sepolia.js answers it
//    - the IPFS gateway (GET /ipfs/*) — the files of
//      ipfs/gateway.js
//
//  Keep this in step with the SPA: the structural test
//  (tests/core/structural.test.js) extracts every backend call
//  from src/ and fails when one has no handler here — the
//  double must never fall behind the frontend it stands in
//  for.
//
//  Used by:
//    - server.js — the msw server starts from these handlers
// -----------------------------------------------------------

import { http, HttpResponse } from 'msw';
import * as f from './fixtures';
import { sepolia } from '../chain/sepolia';
import { gateway } from '../ipfs/gateway';
import { TEST_ORIGIN } from '../location';


const abs = (path) => `${TEST_ORIGIN}${path}`;
const json = (body) => () => HttpResponse.json(body());

// The backend's ?limit= rule for the activity feed
const activityLimit = (request) => Math.min(Number(new URL(request.url).searchParams.get('limit') ?? 100), 500);







// -----------------------------------------------------------
// defaultHandlers
// -----------------------------------------------------------
//
// Grouped like the endpoint routes them: the backend's API,
// its RPC relay, the IPFS gateway. Bodies are built fresh per
// request from fixtures.js.
//
// Used by:
//   - server.js
// -----------------------------------------------------------

export const defaultHandlers = [

  // The runtime config main.jsx loads before React mounts
  http.get(abs('/api/config'), json(f.config)),

  // The marketplace reads
  http.get(abs('/api/stats'), json(f.stats)),
  http.get(abs('/api/listings'), json(f.listings)),
  http.get(abs('/api/activity'), ({ request }) => (
    HttpResponse.json({ activity: f.activity().activity.slice(0, activityLimit(request)) })
  )),
  http.get(abs('/api/nft/:nftAddress/:tokenId'), ({ params }) => HttpResponse.json(f.nft(params.nftAddress, params.tokenId))),
  http.get(abs('/api/my-nfts/:wallet'), ({ params }) => HttpResponse.json(f.myNfts(params.wallet))),

  // The JSON-RPC relay to Sepolia
  http.post(abs('/api/rpc'), sepolia.relay),

  // The course IPFS node's gateway
  http.get(abs('/ipfs/*'), gateway),
];
