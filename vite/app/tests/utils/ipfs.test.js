// -----------------------------------------------------------
//  [*] Tests — the IPFS helpers (utils/ipfs.js)
//
//  toGatewayURL moves every IPFS-addressed URI onto the course
//  node's gateway at the configured prefix — ipfs:// URIs with
//  a path and a query, the legacy ipfs://ipfs/ form without
//  its extra segment, path gateways on any host (ipfs.io,
//  Pinata, a node of one's own), subdomain gateways whose CID
//  rides in the host name — and leaves everything else where it
//  lives (Arweave, a plain web server, a data: URI, an IPNS
//  name). fetchWithTimeout is fetch() with the configured
//  deadline: the answer as it is, or a sentence naming the
//  deadline and the URL when the node never answers, other
//  failures untouched, no timer left behind.
// -----------------------------------------------------------

import { describe, it, expect, vi } from 'vitest';
import { given } from '../support/backend/server';
import { withConfig } from '../support/setup';
import { DROPPED } from '../support/backend/contract';
import * as f from '../support/backend/fixtures';
import { toGatewayURL, fetchWithTimeout } from '@/utils/ipfs';







// -----------------------------------------------------------
// toGatewayURL
// -----------------------------------------------------------
//
// Every IPFS-addressed URI moved onto the local gateway at
// the configured prefix — everything else left where it
// lives.
// -----------------------------------------------------------

describe('toGatewayURL', () => {

  it.each([
    ['a bare ipfs:// CID', `ipfs://${f.ART_1_IMAGE_CID}`, `/ipfs/${f.ART_1_IMAGE_CID}`],
    ['an ipfs:// file inside a directory', `ipfs://${f.ART_DIR}/0.json`, `/ipfs/${f.ART_DIR}/0.json`],
    ['the course PUG\'s ipfs:// URI with its ?filename=', f.PUG_TOKEN_URI, f.PUG_JSON_URL],
    ['an ipfs.io path gateway link', f.PUG_METADATA.image, f.PUG_IMAGE_URL],
    ['a Pinata path gateway link', `https://gateway.pinata.cloud/ipfs/${f.ART_DIR}/0.png`, `/ipfs/${f.ART_DIR}/0.png`],
    ['a node\'s own gateway over http, with a port', `http://127.0.0.1:8080/ipfs/${f.ART_1_IMAGE_CID}`, `/ipfs/${f.ART_1_IMAGE_CID}`],
    ['a dweb.link subdomain gateway link', `https://${f.ART_DIR}.ipfs.dweb.link/0.json`, `/ipfs/${f.ART_DIR}/0.json`],
    ['a subdomain gateway link with no path', `https://${f.ART_DIR}.ipfs.nftstorage.link`, `/ipfs/${f.ART_DIR}`],
  ])('moves %s onto the local gateway', (_, uri, expected) => {
    expect(toGatewayURL(uri)).toBe(expected);
  });


  it('keeps a subdomain gateway link\'s path but not its query', () => {
    expect(toGatewayURL(`https://${f.ART_DIR}.ipfs.w3s.link/0.json?filename=0.json`)).toBe(`/ipfs/${f.ART_DIR}/0.json`);
  });


  it.each([
    ['an Arweave link', 'https://arweave.net/Kj8nSCYb3pQbhHqUzuULz4oWpCgYBqJ4hBpb8ypCHB4'],
    ['a plain web server', 'https://nft.example.org/meta/1.json'],
    ['a data: URI', 'data:application/json;base64,eyJuYW1lIjoiT25lIn0='],
    ['an IPNS name', 'ipns://k51qzi5uqu5dlvj2baxnqndepeb86cbk3ng7n3i46uzyxzyqj2xjonzllnv0v8'],
  ])('leaves %s where it lives', (_, uri) => {
    expect(toGatewayURL(uri)).toBe(uri);
  });


  it.each([
    ['undefined', undefined],
    ['null', null],
    ['an empty string', ''],
  ])('hands back %s as it came', (_, uri) => {
    expect(toGatewayURL(uri)).toBe(uri);
  });


  it('uses the gateway prefix of the runtime config', async () => {
    await withConfig({ ipfsGateway: '/archive/ipfs/' });
    expect(toGatewayURL(`ipfs://${f.ART_DIR}/0.json`)).toBe(`/archive/ipfs/${f.ART_DIR}/0.json`);
    expect(toGatewayURL(f.PUG_METADATA.image)).toBe(`/archive/ipfs/${f.PUG_IMAGE_CID}?filename=pug.png`);
  });


  it('moves the legacy ipfs://ipfs/<cid> form onto the gateway without its extra ipfs/', () => {
    expect(toGatewayURL(`ipfs://ipfs/${f.ART_1_IMAGE_CID}`)).toBe(`/ipfs/${f.ART_1_IMAGE_CID}`);
  });
});







// -----------------------------------------------------------
// fetchWithTimeout
// -----------------------------------------------------------
//
// A fetch held to the IPFS deadline: the answer as it is, a
// sentence naming the deadline and the URL when it passes,
// other failures untouched, no timer left behind.
// -----------------------------------------------------------

describe('fetchWithTimeout', () => {

  it('hands back the gateway\'s answer as it is — its status is the caller\'s business', async () => {
    const found = await fetchWithTimeout(f.PUG_JSON_URL);
    expect(found.status).toBe(200);
    expect(await found.json()).toEqual(f.PUG_METADATA);

    const lost = await fetchWithTimeout(`/ipfs/${f.LOST_DIR}/5.json`);
    expect(lost.status).toBe(504);
  });


  it('gives up after the configured deadline, naming the deadline and the URL', async () => {
    await withConfig({ ipfsTimeout: 150 });
    given.hang('get', '/ipfs/*');
    await expect(fetchWithTimeout(`/ipfs/${f.LOST_DIR}/5.json`)).rejects.toThrow(new Error(`Request timeout after 150ms: /ipfs/${f.LOST_DIR}/5.json`));
  });


  it('takes a deadline of its own over the configured one', async () => {
    given.hang('get', '/ipfs/*');
    const started = Date.now();
    await expect(fetchWithTimeout(f.PUG_JSON_URL, 120)).rejects.toThrow(new Error(`Request timeout after 120ms: ${f.PUG_JSON_URL}`));
    expect(Date.now() - started).toBeLessThan(5000);
  });


  it('lets any other failure through untouched', async () => {
    given.networkError('get', '/ipfs/*');
    await expect(fetchWithTimeout(f.PUG_JSON_URL)).rejects.toMatchObject({ name: 'TypeError', message: DROPPED });
  });


  it('clears its deadline once the node has answered', async () => {
    const setTimer = vi.spyOn(globalThis, 'setTimeout');
    const clearTimer = vi.spyOn(globalThis, 'clearTimeout');
    await fetchWithTimeout(f.PUG_JSON_URL);

    const deadline = setTimer.mock.calls.findIndex(([, ms]) => ms === 10000);
    expect(deadline).toBeGreaterThanOrEqual(0);
    expect(clearTimer).toHaveBeenCalledWith(setTimer.mock.results[deadline].value);
  });
});
