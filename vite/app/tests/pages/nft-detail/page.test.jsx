// -----------------------------------------------------------
//  [*] Tests — NFT detail: the page and the token
//      (route /nft/:nftAddress/:tokenId)
//
//  One NFT, loaded PROGRESSIVELY from three sources, each
//  filling its own panels: the metadata through the IPFS
//  gateway (image, name, description, the diagnosis), the
//  owner through ethers and the relay, the listing and history
//  from the backend — a dead IPFS file never holds up the
//  backend's data. Pinned down here: every panel's skeleton
//  while its source is out; the token's facts — its name and
//  description, the collection linked on Etherscan, the id,
//  the raw metadata JSON one click away, the current price
//  while it is listed — and the way back; the owner — another
//  account linked on Etherscan, "You" for the student, a
//  token whose ownerOf reverts said to be unknown; the image —
//  from the gateway, the grey placeholder when the link inside
//  healthy metadata is dead; and every diagnosis of a wrongly
//  minted token, with its fix, above everything else.
//
//  Pinned: the metadata's attributes never reach the page, so
//  the Attributes panel never shows; and a visitor without a
//  wallet is told THEY own a token whose ownerOf reverted.
// -----------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { screen, within, fireEvent } from '@testing-library/react';
import { http } from 'msw';
import { server, given, url } from '../../support/backend/server';
import { settle } from '../../support/backend/contract';
import { currentPath } from '../../support/shell/router';
import { renderDetail, infoRow, panel } from '../../support/nft-detail/page';
import { DIAGNOSES, DIAGNOSED_TOKENS } from '../../support/diagnoses';
import * as f from '../../support/backend/fixtures';
import { sepolia, MULTICALL3 } from '../../support/chain/sepolia';


const PROBLEM = '⚠ This NFT has a problem';







// -----------------------------------------------------------
// Helpers
// -----------------------------------------------------------
//
// nameHeading waits for the token's name — the page's h1;
// holdOwnerReads keeps every direct call to a contract (the
// owner lookup through ethers) unanswered while the
// multicalled reads (tokenURI, the balance) pass, so the
// owner alone stays out.
// -----------------------------------------------------------

const nameHeading = (name) => screen.findByRole('heading', { level: 1, name });

const callsInBody = (body) => (Array.isArray(body) ? body : [body]);

function holdOwnerReads() {
  server.use(http.post(url('/api/rpc'), async (info) => {
    const body = await info.request.clone().json();
    const direct = callsInBody(body).some((call) => call.method === 'eth_call' && call.params?.[0]?.to?.toLowerCase() !== MULTICALL3);
    if (direct) return new Promise(() => {});
    return sepolia.relay(info);
  }));
}







// -----------------------------------------------------------
// Loading progressively
// -----------------------------------------------------------

describe('Loading progressively', () => {

  it('shows the backend\'s data and the owner while a dead IPFS file keeps the image and the name waiting', async () => {
    given.hang('get', '/ipfs/*');
    renderDetail(f.PUGS, '0');
    expect(await screen.findByRole('link', { name: `${f.short(f.checksummed(f.SELLER))} ↗` })).toBeInTheDocument();
    expect(await screen.findByText('Price updated')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
    expect(screen.queryByRole('img')).toBeNull();
  });


  it('shows the metadata and the history while the owner is still being read', async () => {
    holdOwnerReads();
    renderDetail(f.PUGS, '0');
    expect(await nameHeading('PUG')).toBeInTheDocument();
    expect(await screen.findByText('Price updated')).toBeInTheDocument();
    expect(infoRow('Current Owner:')).toBeEmptyDOMElement();
  });


  it('reads the owner once, through ethers and the relay', async () => {
    renderDetail(f.PUGS, '0');
    await screen.findByRole('link', { name: `${f.short(f.checksummed(f.SELLER))} ↗` });
    expect(sepolia.readsOf('ownerOf')).toEqual([{ to: f.PUGS, functionName: 'ownerOf', args: [0n], via: 'direct' }]);
  });
});







// -----------------------------------------------------------
// The token
// -----------------------------------------------------------

describe('The token', () => {

  it('is titled with its name, its description under it', async () => {
    renderDetail(f.PUGS, '0');
    expect((await nameHeading('PUG')).nextElementSibling).toHaveTextContent('An adorable PUG pup!');
  });


  it('says "No description" when the metadata has none', async () => {
    given.json('get', `/ipfs/${f.ART_DIR}/0.json`, { name: 'Vilnius at Dusk', image: `ipfs://${f.ART_DIR}/0.png` });
    renderDetail(f.ART, '0');
    expect((await nameHeading('Vilnius at Dusk')).nextElementSibling).toHaveTextContent('No description');
  });


  it('links its collection on Etherscan by the short address, the full one on hover', async () => {
    renderDetail(f.PUGS, '0');
    const link = screen.getByRole('link', { name: `${f.short(f.PUGS)} ↗` });
    expect(link).toBe(infoRow('NFT Contract Address:'));
    expect(link).toHaveAttribute('href', `https://sepolia.etherscan.io/address/${f.PUGS}`);
    expect(link).toHaveAttribute('title', f.PUGS);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    await nameHeading('PUG');
  });


  it('shows its token id', async () => {
    renderDetail(f.ART, '0');
    expect(infoRow('Token ID:')).toHaveTextContent('#0');
    await nameHeading('Vilnius at Dusk');
  });


  it('opens its raw metadata JSON on the local gateway in a new tab', async () => {
    renderDetail(f.PUGS, '0');
    const link = await screen.findByRole('link', { name: 'View JSON →' });
    expect(link).toHaveAttribute('href', f.PUG_JSON_URL);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });


  it('shows the current price while it is listed', async () => {
    renderDetail(f.PUGS, '0');
    expect(await screen.findByText('Current Price:')).toBeInTheDocument();
    expect(infoRow('Current Price:')).toHaveTextContent('0.05 ETH');
  });


  it('shows no price while it is not listed', async () => {
    renderDetail(f.PUGS, '3');
    await nameHeading('PUG');
    await screen.findByText('No transaction history yet');
    expect(screen.queryByText('Current Price:')).toBeNull();
  });


  it('loads from an address in its checksummed form too', async () => {
    const asked = given.capture('get', '/api/nft/:nftAddress/:tokenId', f.nft(f.PUGS, '0'));
    renderDetail(f.checksummed(f.PUGS), '0');
    expect(await screen.findByText('Price updated')).toBeInTheDocument();
    expect(asked[0].params).toEqual({ nftAddress: f.checksummed(f.PUGS), tokenId: '0' });
  });


  it('leads back to the marketplace', async () => {
    const { user } = renderDetail(f.PUGS, '0');
    await nameHeading('PUG');
    await user.click(screen.getByRole('link', { name: '← Back to Marketplace' }));
    expect(currentPath()).toBe('/');
  });


  it.fails('shows the token\'s attributes — PINNED KNOWN BUG: useNftMetadata drops every field but name, description and image, so the Attributes panel never renders', async () => {
    renderDetail(f.PUGS, '0');
    await nameHeading('PUG');
    expect(await screen.findByRole('heading', { level: 3, name: 'Attributes' }, { timeout: 1500 })).toBeInTheDocument();
  });
});







// -----------------------------------------------------------
// The owner
// -----------------------------------------------------------

describe('The owner', () => {

  it('links another owner on Etherscan by the short checksummed address, the full one on hover', async () => {
    renderDetail(f.PUGS, '0');
    const link = await screen.findByRole('link', { name: `${f.short(f.checksummed(f.SELLER))} ↗` });
    expect(link).toBe(infoRow('Current Owner:'));
    expect(link).toHaveAttribute('href', `https://sepolia.etherscan.io/address/${f.checksummed(f.SELLER)}`);
    expect(link).toHaveAttribute('title', f.checksummed(f.SELLER));
  });


  it('says "You" to the student on a token they own', async () => {
    renderDetail(f.PUGS, '3');
    expect(await within(infoRow('Current Owner:')).findByText('You')).toBeInTheDocument();
  });


  it('names the owner to a visitor without a wallet', async () => {
    renderDetail(f.PUGS, '3', { wallet: false });
    expect(await screen.findByRole('link', { name: `${f.short(f.checksummed(f.STUDENT))} ↗` })).toBe(infoRow('Current Owner:'));
  });


  it('says the owner is unknown when ownerOf reverts — a burned token', async () => {
    renderDetail(f.ART, '6');
    expect(await within(infoRow('Current Owner:')).findByText('unknown (ownerOf reverted)')).toBeInTheDocument();
  });


  it.fails('says the owner is unknown to a visitor without a wallet, too — PINNED KNOWN BUG: an unknown owner and no wallet compare equal (undefined === undefined), so the visitor is told "You"', async () => {
    renderDetail(f.ART, '6', { wallet: false });
    await settle(500);
    expect(within(infoRow('Current Owner:')).queryByText('You')).toBeNull();
  });
});







// -----------------------------------------------------------
// The image
// -----------------------------------------------------------

describe('The image', () => {

  it('shows the image from the local gateway, named after the token', async () => {
    renderDetail(f.PUGS, '0');
    expect(await screen.findByRole('img', { name: 'PUG' })).toHaveAttribute('src', f.PUG_IMAGE_URL);
  });


  it('swaps a dead image link inside healthy metadata for the grey placeholder', async () => {
    renderDetail(f.ART, '0');
    fireEvent.error(await screen.findByRole('img', { name: 'Vilnius at Dusk' }));
    expect(await screen.findByText('Image could not be loaded')).toBeInTheDocument();
    expect(screen.getByText('🖼️')).toBeInTheDocument();
    expect(screen.getByText('Image could not be loaded').previousElementSibling).toHaveTextContent('NFT #0');
    expect(screen.queryByRole('img', { name: 'Vilnius at Dusk' })).toBeNull();
  });


  it('shows the image a tokenURI points at, even though it is not metadata', async () => {
    renderDetail(f.ART, '1');
    expect(await screen.findByRole('img', { name: 'NFT #1' })).toHaveAttribute('src', `/ipfs/${f.ART_1_IMAGE_CID}`);
  });


  it('shows the hook\'s grey placeholder, naming the token, for metadata without an image', async () => {
    renderDetail(f.ART, '3');
    const image = await screen.findByRole('img', { name: 'Curonian Spit' });
    expect(image.getAttribute('src')).toMatch(/^data:image\/svg\+xml,.*NFT %233%3C/);
  });
});







// -----------------------------------------------------------
// A wrongly minted token
// -----------------------------------------------------------

describe('A wrongly minted token', () => {

  it.each(Object.keys(DIAGNOSED_TOKENS))('puts the diagnosis (%s) and its fix above everything else', async (key) => {
    const { nftAddress, tokenId, name } = DIAGNOSED_TOKENS[key];
    renderDetail(nftAddress, tokenId);
    const heading = await screen.findByRole('heading', { level: 3, name: PROBLEM });
    const card = heading.parentElement;
    expect(within(card).getByText(DIAGNOSES[key].message)).toBeInTheDocument();
    expect(within(card).getByText(DIAGNOSES[key].hint)).toBeInTheDocument();
    expect(await nameHeading(name)).toBeInTheDocument();

    // The diagnosis comes before the token's facts
    expect(card.compareDocumentPosition(screen.getByRole('heading', { level: 1 })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });


  it('shows no diagnosis for a healthy token', async () => {
    renderDetail(f.ART, '0');
    await nameHeading('Vilnius at Dusk');
    expect(screen.queryByRole('heading', { level: 3, name: PROBLEM })).toBeNull();
  });


  it('offers no metadata link for a token whose tokenURI reverts', async () => {
    renderDetail(f.ART, '6');
    await screen.findByRole('heading', { level: 3, name: PROBLEM });
    expect(screen.queryByRole('link', { name: 'View JSON →' })).toBeNull();
    expect(panel(PROBLEM)).toHaveTextContent(DIAGNOSES.revert.message);
  });
});
