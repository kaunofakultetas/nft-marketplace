// -----------------------------------------------------------
//  [*] Test support — the IPFS gateway double
//
//  NFT metadata and images reach the page through the course
//  IPFS node's gateway, proxied by the endpoint at /ipfs/
//  (utils/ipfs.js rewrites every IPFS-addressed URI onto it).
//  This double serves the world's files from fixtures.js by
//  their path under /ipfs/ — a CID, or a CID and a file inside
//  it — each with the Content-Type the node answers with (the
//  page tells an image from metadata by it). The query string
//  is the gateway's own business (?filename=… only names the
//  download) and a trailing slash after a file's CID changes
//  nothing, as on a real gateway.
//
//  A path the world has no file for is answered like a node
//  that searched the network and gave up: 504 Gateway Timeout
//  with kubo's plain-text reason — fast, so a test never waits
//  for the page's own deadline unless it asks for that (a
//  hang through given.hang).
//
//  Used by:
//    - backend/handlers.js — GET /ipfs/*
//    - tests that build a gateway answer of their own
//      (ipfsPath, gatewayTimeout)
// -----------------------------------------------------------

import { HttpResponse } from 'msw';
import * as f from '../backend/fixtures';







// -----------------------------------------------------------
// ipfsPath / gatewayTimeout
// -----------------------------------------------------------
//
// ipfsPath is a request's path below /ipfs/, decoded, with
// the query and any trailing slash dropped — the key the
// world's files are stored under. gatewayTimeout is the
// answer of a node that could not find the content in time.
//
// Used by:
//   - gateway (below)
//   - tests answering one path themselves
// -----------------------------------------------------------

export const ipfsPath = (url) => decodeURIComponent(new URL(url).pathname)
  .replace(/^\/ipfs\//, '')
  .replace(/\/+$/, '');

export const gatewayTimeout = (path) => new HttpResponse(
  `ipfs resolve -r /ipfs/${path}: context deadline exceeded\n`,
  { status: 504, headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
);







// -----------------------------------------------------------
// gateway
// -----------------------------------------------------------
//
// The msw resolver of GET /ipfs/*: the world's file at the
// path with its Content-Type, or the gateway's timeout.
//
// Used by:
//   - backend/handlers.js
// -----------------------------------------------------------

export function gateway({ request }) {
  const path = ipfsPath(request.url);
  const file = f.ipfsFiles[path];
  if (!file) return gatewayTimeout(path);
  return new HttpResponse(file.body, { headers: { 'Content-Type': file.type } });
}
