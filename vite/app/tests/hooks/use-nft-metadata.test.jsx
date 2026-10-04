// -----------------------------------------------------------
//  [*] Tests — useNftMetadata (one NFT's metadata, diagnosed)
//
//  The one shared "what does this token look like": tokenURI
//  read on-chain through the relay, the metadata JSON fetched
//  through the course IPFS gateway, the image moved onto the
//  gateway too. Pinned down here, through a probe component
//  that shows what the hook hands back: the loading state; a
//  healthy token (the course PUG, the student-made ART #0) —
//  its name, description, attributes, gateway image and the
//  "View JSON" URL; every DIAGNOSIS a wrongly minted token
//  earns — an empty tokenURI (OpenZeppelin's default without
//  a base URI) and JSON that is no object among them — each
//  with the fallbacks it still shows (a placeholder image
//  naming the token, the name and description the JSON did
//  carry, as text only); a metadata file the gateway cannot
//  deliver — gone, a dropped connection, the IPFS deadline
//  passing; metadata on a plain web server, fetched where it
//  lives; one read and one fetch per token however many
//  components show it; and a relay that cannot be reached
//  never blamed on the token.
// -----------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderPage } from '../support/render';
import { http, HttpResponse } from 'msw';
import { server, given, url } from '../support/backend/server';
import { withConfig } from '../support/setup';
import { settle } from '../support/backend/contract';
import { watchRequests } from '../support/shell/requests';
import { DIAGNOSES, DIAGNOSED_TOKENS, UNREADABLE } from '../support/diagnoses';
import * as f from '../support/backend/fixtures';
import { sepolia } from '../support/chain/sepolia';
import { useNftMetadata } from '@/hooks/useNftMetadata';


// The grey placeholder the hook gives a token without a
// usable image — the token id is written into the SVG
const PLACEHOLDER = (tokenId) => expect.stringMatching(new RegExp(`^data:image/svg\\+xml,.*NFT %23${tokenId}%3C`));







// -----------------------------------------------------------
// Helpers
// -----------------------------------------------------------
//
// MetadataProbe renders the hook's answer as JSON (one probe
// per token, tagged by its id); renderProbe mounts probes for
// tokens in the production frame; probeOf reads one back, and
// settled waits until it is no longer loading.
// -----------------------------------------------------------

function MetadataProbe({ nftAddress, tokenId }) {
  const answer = useNftMetadata(nftAddress, tokenId);
  return <output data-testid={`probe-${nftAddress}-${tokenId}`}>{JSON.stringify(answer)}</output>;
}

const renderProbe = (...tokens) => renderPage(
  <>{tokens.map(([nftAddress, tokenId], i) => <MetadataProbe key={i} nftAddress={nftAddress} tokenId={tokenId} />)}</>,
);

const probeOf = (nftAddress, tokenId) => JSON.parse(screen.getAllByTestId(`probe-${nftAddress}-${tokenId}`)[0].textContent);

async function settled(nftAddress, tokenId) {
  await waitFor(() => expect(probeOf(nftAddress, tokenId).loading).toBe(false));
  return probeOf(nftAddress, tokenId);
}

const diagnosed = (key) => {
  const { nftAddress, tokenId } = DIAGNOSED_TOKENS[key];
  renderProbe([nftAddress, tokenId]);
  return settled(nftAddress, tokenId);
};







// -----------------------------------------------------------
// Healthy tokens
// -----------------------------------------------------------
//
// What a healthy token hands back: the loading state, then
// the name, description, attributes and gateway image — its
// metadata read once however many components show it.
// -----------------------------------------------------------

describe('Healthy tokens', () => {

  it('is loading — with nothing to show yet — until the tokenURI and the metadata are in', async () => {
    given.hang('get', '/ipfs/*');
    renderProbe([f.PUGS, '0']);
    expect(probeOf(f.PUGS, '0')).toEqual({ problem: null, metadataURL: null, loading: true });
    await waitFor(() => expect(probeOf(f.PUGS, '0').metadataURL).toBe(f.PUG_JSON_URL));
    expect(probeOf(f.PUGS, '0').loading).toBe(true);
  });


  it('hands back the course PUG — its name, description and attributes, its image and its JSON on the local gateway', async () => {
    renderProbe([f.PUGS, '0']);
    expect(await settled(f.PUGS, '0')).toEqual({
      metadata: { name: 'PUG', description: 'An adorable PUG pup!', image: f.PUG_IMAGE_URL, attributes: f.PUG_METADATA.attributes },
      problem: null,
      metadataURL: f.PUG_JSON_URL,
      loading: false,
    });
  });


  it('moves an ipfs:// image inside the metadata onto the gateway as well', async () => {
    renderProbe([f.ART, '0']);
    const answer = await settled(f.ART, '0');
    expect(answer.metadata).toEqual({ name: 'Vilnius at Dusk', description: f.ART_0_METADATA.description, image: `/ipfs/${f.ART_DIR}/0.png`, attributes: f.ART_0_METADATA.attributes });
    expect(answer.metadataURL).toBe(`/ipfs/${f.ART_DIR}/0.json`);
  });


  it('fetches metadata hosted on a plain web server where it lives', async () => {
    sepolia.setTokenURI(f.ART, '0', 'https://nft.example.org/meta/0.json');
    given.json('get', 'https://nft.example.org/meta/0.json', { name: 'Hosted elsewhere', description: 'Not on IPFS', image: 'https://nft.example.org/img/0.png' });
    renderProbe([f.ART, '0']);
    expect(await settled(f.ART, '0')).toEqual({
      metadata: { name: 'Hosted elsewhere', description: 'Not on IPFS', image: 'https://nft.example.org/img/0.png' },
      problem: null,
      metadataURL: 'https://nft.example.org/meta/0.json',
      loading: false,
    });
  });


  it('names the token itself when the JSON carries no name, and leaves the description empty', async () => {
    given.json('get', `/ipfs/${f.ART_DIR}/0.json`, { image: `ipfs://${f.ART_DIR}/0.png` });
    renderProbe([f.ART, '0']);
    expect((await settled(f.ART, '0')).metadata).toEqual({ name: 'NFT #0', description: '', image: `/ipfs/${f.ART_DIR}/0.png` });
  });


  it('reads each token once and fetches its metadata once, however many components show it', async () => {
    const fetched = watchRequests('/ipfs/*');
    renderProbe([f.ART, '0'], [f.ART, '0'], [f.ART, '0']);
    await settled(f.ART, '0');
    await settle(100);
    expect(sepolia.readsOf('tokenURI')).toEqual([{ to: f.ART, functionName: 'tokenURI', args: [0n], via: 'multicall' }]);
    expect(fetched).toEqual([`GET /ipfs/${f.ART_DIR}/0.json`]);
  });


  it('leaves out attributes that are no list', async () => {
    given.json('get', `/ipfs/${f.ART_DIR}/0.json`, { ...f.ART_0_METADATA, attributes: { Palette: 'Amber' } });
    renderProbe([f.ART, '0']);
    expect((await settled(f.ART, '0')).metadata).not.toHaveProperty('attributes');
  });


  it('reads a name and description only as text — a number as itself, anything else as missing', async () => {
    given.json('get', `/ipfs/${f.ART_DIR}/0.json`, { name: { en: 'Vilnius at Dusk' }, description: 2026, image: `ipfs://${f.ART_DIR}/0.png` });
    renderProbe([f.ART, '0']);
    expect((await settled(f.ART, '0')).metadata).toEqual({ name: 'NFT #0', description: '2026', image: `/ipfs/${f.ART_DIR}/0.png` });
  });
});







// -----------------------------------------------------------
// Wrongly minted tokens
// -----------------------------------------------------------
//
// Each diagnosis with what the token still shows.
// -----------------------------------------------------------

describe('Wrongly minted tokens', () => {

  it('diagnoses a tokenURI that points at an image — and still shows that image', async () => {
    const answer = await diagnosed('imageAsUri');
    expect(answer.problem).toEqual(DIAGNOSES.imageAsUri);
    expect(answer.metadata).toEqual({ name: 'NFT #1', description: '', image: `/ipfs/${f.ART_1_IMAGE_CID}` });
  });


  it('diagnoses metadata that is not JSON — the token named by its id, a placeholder image', async () => {
    const answer = await diagnosed('notJson');
    expect(answer.problem).toEqual(DIAGNOSES.notJson);
    expect(answer.metadata).toEqual({ name: 'NFT #2', description: '', image: PLACEHOLDER(2) });
  });


  it('diagnoses JSON without an "image" field — keeping the name and description it does carry', async () => {
    const answer = await diagnosed('noImage');
    expect(answer.problem).toEqual(DIAGNOSES.noImage);
    expect(answer.metadata).toEqual({ name: 'Curonian Spit', description: 'The dunes of Nida at noon.', image: PLACEHOLDER(3) });
  });


  it('diagnoses the non-standard "image_url" — and does not show the image it names', async () => {
    const answer = await diagnosed('imageUrlField');
    expect(answer.problem).toEqual(DIAGNOSES.imageUrlField);
    expect(answer.metadata).toEqual({ name: 'Kaunas Castle', description: 'Red brick on the river bend.', image: PLACEHOLDER(4) });
  });


  it('diagnoses metadata nobody hosts any more — the gateway gave up', async () => {
    const answer = await diagnosed('unreachable');
    expect(answer.problem).toEqual(DIAGNOSES.unreachable);
    expect(answer.metadata).toEqual({ name: 'NFT #5', description: '', image: PLACEHOLDER(5) });
    expect(answer.metadataURL).toBe(`/ipfs/${f.LOST_DIR}/5.json`);
  });


  it('diagnoses a burned token\'s reverting tokenURI without fetching anything', async () => {
    const fetched = watchRequests('/ipfs/*');
    const answer = await diagnosed('revert');
    expect(answer).toEqual({
      metadata: { name: 'NFT #6', description: '', image: PLACEHOLDER(6) },
      problem: DIAGNOSES.revert,
      metadataURL: null,
      loading: false,
    });
    expect(fetched).toEqual([]);
  });


  it('diagnoses an address with no contract at all as a reverting tokenURI', async () => {
    renderProbe([f.SELLER, '0']);
    expect((await settled(f.SELLER, '0')).problem).toEqual(DIAGNOSES.revert);
  });


  it('takes any image content type for an image where the JSON should be', async () => {
    server.use(http.get(url(`/ipfs/${f.ART_DIR}/0.json`), () => (
      new HttpResponse('<svg xmlns="http://www.w3.org/2000/svg"/>', { headers: { 'Content-Type': 'image/svg+xml' } })
    )));
    renderProbe([f.ART, '0']);
    expect((await settled(f.ART, '0')).problem).toEqual(DIAGNOSES.imageAsUri);
  });


  it('diagnoses an empty tokenURI — OpenZeppelin\'s default without a base URI — without fetching anything', async () => {
    const fetched = watchRequests('/ipfs/*');
    sepolia.setTokenURI(f.ART, '0', '');
    renderProbe([f.ART, '0']);
    expect(await settled(f.ART, '0')).toEqual({
      metadata: { name: 'NFT #0', description: '', image: PLACEHOLDER(0) },
      problem: DIAGNOSES.emptyUri,
      metadataURL: null,
      loading: false,
    });
    expect(fetched).toEqual([]);
  });


  it.each([
    ['null', null],
    ['a list', ['Vilnius at Dusk', `ipfs://${f.ART_DIR}/0.png`]],
    ['a text', 'Vilnius at Dusk'],
    ['a number', 0],
  ])('diagnoses a metadata file holding %s — JSON, but no object', async (_, body) => {
    given.json('get', `/ipfs/${f.ART_DIR}/0.json`, body);
    renderProbe([f.ART, '0']);
    const answer = await settled(f.ART, '0');
    expect(answer.problem).toEqual(DIAGNOSES.notObject);
    expect(answer.metadata).toEqual({ name: 'NFT #0', description: '', image: PLACEHOLDER(0) });
  });


  it('diagnoses an "image" that is no link — keeping the name and description', async () => {
    given.json('get', `/ipfs/${f.ART_DIR}/0.json`, { name: 'Vilnius at Dusk', description: 'Roofs', image: { uri: `ipfs://${f.ART_DIR}/0.png` } });
    renderProbe([f.ART, '0']);
    const answer = await settled(f.ART, '0');
    expect(answer.problem).toEqual(DIAGNOSES.imageNotText);
    expect(answer.metadata).toEqual({ name: 'Vilnius at Dusk', description: 'Roofs', image: PLACEHOLDER(0) });
  });
});







// -----------------------------------------------------------
// The metadata file cannot be delivered
// -----------------------------------------------------------
//
// A metadata file the gateway cannot deliver — gone, dropped,
// or past the IPFS deadline — diagnosed as unreachable.
// -----------------------------------------------------------

describe('The metadata file cannot be delivered', () => {

  it.each([
    ['the gateway answers 404', () => given.empty('get', '/ipfs/*', 404)],
    ['the connection drops', () => given.networkError('get', '/ipfs/*')],
  ])('diagnoses an unreachable file when %s', async (_, respond) => {
    respond();
    renderProbe([f.PUGS, '0']);
    expect((await settled(f.PUGS, '0')).problem).toEqual(DIAGNOSES.unreachable);
  });


  it('gives up on a gateway that never answers once the IPFS deadline has passed', async () => {
    await withConfig({ ipfsTimeout: 200 });
    given.hang('get', '/ipfs/*');
    renderProbe([f.PUGS, '0']);
    expect((await settled(f.PUGS, '0')).problem).toEqual(DIAGNOSES.unreachable);
  });
});







// -----------------------------------------------------------
// The chain cannot be read
// -----------------------------------------------------------
//
// A relay that is down is not the token's fault: the hook
// says the chain cannot be read.
// -----------------------------------------------------------

describe('The chain cannot be read', () => {

  it('does not blame the token when the RPC relay is down — it says the chain cannot be read', async () => {
    given.json('post', '/api/rpc', { error: 'RPC relay failed: the RPC provider could not be reached' }, { status: 502 });
    renderProbe([f.PUGS, '0']);
    expect(await settled(f.PUGS, '0')).toEqual({
      metadata: { name: 'NFT #0', description: '', image: PLACEHOLDER(0) },
      problem: UNREADABLE,
      metadataURL: null,
      loading: false,
    });
  });
});
