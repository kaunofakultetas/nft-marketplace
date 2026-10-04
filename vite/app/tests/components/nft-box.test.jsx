// -----------------------------------------------------------
//  [*] Tests — NFTBox (one card of the grids)
//
//  The marketplace card as Home and My NFTs show it: a grey
//  skeleton until the token's metadata is in, then the image
//  first (on the local gateway, its alt the token's name), the
//  name, the price in ether — "Not for sale" without one,
//  "Price unknown" for one it cannot read or a listing the
//  page could not load — the description, the token id and
//  who owns it: the seller's
//  short address with the full one on hover, "you" for the
//  student's own listing (the backend's lowercase seller
//  against wagmi's checksummed account) and for a token passed
//  without a seller (My NFTs' unlisted ones). A wrongly
//  minted token wears its diagnosis — the short message, the
//  fix on hover — where the description would be. The whole
//  card, skeleton included, opens the token's own page.
// -----------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderPage } from '../support/render';
import { given } from '../support/backend/server';
import { LocationProbe, currentPath } from '../support/shell/router';
import { DIAGNOSES, DIAGNOSED_TOKENS } from '../support/diagnoses';
import * as f from '../support/backend/fixtures';
import { installMetamask } from '../support/wallets/metamask';
import NFTBox from '@/components/NFTBox';


const renderBox = (props) => renderPage(<><NFTBox {...props} /><LocationProbe /></>);

// The listed PUG #0 as Home passes it
const PUG_0 = { nftAddress: f.PUGS, tokenId: '0', price: f.wei('0.05'), seller: f.SELLER };

const nameOf = (name) => screen.findByRole('heading', { level: 3, name });







// -----------------------------------------------------------
// Loading
// -----------------------------------------------------------
//
// Until the metadata is in, the card is a skeleton — and
// already opens the token's page.
// -----------------------------------------------------------

describe('Loading', () => {

  it('is a skeleton — no image, no words — until the metadata is in', async () => {
    given.hang('get', '/ipfs/*');
    renderBox(PUG_0);
    await screen.findByTestId('location');
    expect(document.querySelector('img')).toBeNull();
    expect(screen.queryByRole('heading')).toBeNull();
    expect(screen.queryByText(/ETH/)).toBeNull();
  });


  it('opens the token\'s page from the skeleton too', async () => {
    given.hang('get', '/ipfs/*');
    const { user } = renderBox(PUG_0);

    // The pulse is all there is of the card while it loads
    await user.click(document.querySelector('.animate-pulse'));
    expect(currentPath()).toBe(`/nft/${f.PUGS}/0`);
  });
});







// -----------------------------------------------------------
// The card
// -----------------------------------------------------------
//
// The card once the metadata is in: the image first, the
// name, the price in ether — "Not for sale" without one,
// "Price unknown" when it cannot be known — the description
// and the id, the whole card a link.
// -----------------------------------------------------------

describe('The card', () => {

  it('shows the image first, on the local gateway, named after the token', async () => {
    renderBox(PUG_0);
    await nameOf('PUG');
    const image = screen.getByRole('img', { name: 'PUG' });
    expect(image).toHaveAttribute('src', f.PUG_IMAGE_URL);
  });


  it('shows the name, the price in ether, the description and the token id', async () => {
    renderBox(PUG_0);
    expect(await nameOf('PUG')).toHaveAttribute('title', 'PUG');
    expect(screen.getByText('0.05 ETH')).toBeInTheDocument();
    expect(screen.getByText('An adorable PUG pup!')).toHaveAttribute('title', 'An adorable PUG pup!');
    expect(screen.getByText('#0')).toBeInTheDocument();
  });


  it.each([
    ['1.25', f.wei('1.25'), '1.25 ETH'],
    ['a whole ether', f.wei('1'), '1.0 ETH'],
    ['a single wei', '1', '0.000000000000000001 ETH'],
  ])('writes a price of %s in ether', async (_, price, text) => {
    renderBox({ ...PUG_0, price });
    await nameOf('PUG');
    expect(screen.getByText(text)).toBeInTheDocument();
  });


  it('says "Not for sale" for a token without a price', async () => {
    renderBox({ ...PUG_0, price: undefined, seller: undefined });
    await nameOf('PUG');
    expect(screen.getByText('Not for sale')).toBeInTheDocument();
    expect(screen.queryByText(/ETH/)).toBeNull();
  });


  it.each([
    ['a price it cannot read', { price: '💾 <b>cheap</b>' }],
    ['a listing the page could not load', { price: undefined, seller: undefined, priceUnknown: true }],
  ])('says "Price unknown" for %s — never "Not for sale"', async (_, props) => {
    renderBox({ ...PUG_0, ...props });
    await nameOf('PUG');
    expect(screen.getByText('Price unknown')).toBeInTheDocument();
    expect(screen.queryByText('Not for sale')).toBeNull();
    expect(screen.queryByText(/ETH/)).toBeNull();
  });


  it('says "No description" when the metadata has none', async () => {
    given.json('get', `/ipfs/${f.ART_DIR}/0.json`, { name: 'Vilnius at Dusk', image: `ipfs://${f.ART_DIR}/0.png` });
    renderBox({ nftAddress: f.ART, tokenId: '0', price: f.wei('1.25'), seller: f.SELLER });
    await nameOf('Vilnius at Dusk');
    expect(screen.getByText('No description')).toBeInTheDocument();
  });


  it('opens the token\'s own page from anywhere on the card', async () => {
    const { user } = renderBox(PUG_0);
    await nameOf('PUG');
    await user.click(screen.getByText('#0'));
    expect(currentPath()).toBe(`/nft/${f.PUGS}/0`);
  });
});







// -----------------------------------------------------------
// Who owns it
// -----------------------------------------------------------
//
// The owner line: the seller by the short address, "you" for
// the student's own listing and for a token passed without a
// seller.
// -----------------------------------------------------------

describe('Who owns it', () => {

  it('names the seller by the short address, the full one on hover', async () => {
    renderBox(PUG_0);
    await nameOf('PUG');
    expect(screen.getByText(`Owned by ${f.short(f.SELLER)}`)).toHaveAttribute('title', f.SELLER);
  });


  it('says "you" for the student\'s own listing — the backend\'s lowercase seller against the wallet\'s checksummed account', async () => {
    installMetamask({ connected: true });
    renderBox({ nftAddress: f.PUGS, tokenId: '1', price: f.wei('0.1'), seller: f.STUDENT });
    expect(await screen.findByText('Owned by you')).toHaveAttribute('title', f.STUDENT);
  });


  it('says "you" for a token passed without a seller — one of the student\'s unlisted NFTs', async () => {
    renderBox({ nftAddress: f.PUGS, tokenId: '3' });
    await nameOf('PUG');
    expect(screen.getByText('Owned by you')).toHaveAttribute('title', '');
  });


  it('names another seller even while the student is connected', async () => {
    installMetamask({ connected: true });
    renderBox(PUG_0);
    expect(await screen.findByText(`Owned by ${f.short(f.SELLER)}`)).toBeInTheDocument();
  });
});







// -----------------------------------------------------------
// A wrongly minted token
// -----------------------------------------------------------
//
// A wrongly minted token wears its diagnosis where the
// description would be, and shows whatever image it can — or
// the grey placeholder.
// -----------------------------------------------------------

describe('A wrongly minted token', () => {

  it.each(Object.keys(DIAGNOSED_TOKENS))('wears its diagnosis (%s) where the description would be, the fix on hover', async (key) => {
    const { nftAddress, tokenId, name } = DIAGNOSED_TOKENS[key];
    renderBox({ nftAddress, tokenId, price: f.wei('0.02'), seller: f.SELLER });
    await nameOf(name);
    expect(screen.getByText(`⚠ ${DIAGNOSES[key].message}`)).toHaveAttribute('title', DIAGNOSES[key].hint);
  });


  it('shows the image a tokenURI points at, even though it is not metadata', async () => {
    const { nftAddress, tokenId } = DIAGNOSED_TOKENS.imageAsUri;
    renderBox({ nftAddress, tokenId });
    await nameOf('NFT #1');
    expect(screen.getByRole('img', { name: 'NFT #1' })).toHaveAttribute('src', `/ipfs/${f.ART_1_IMAGE_CID}`);
  });


  it('shows the grey placeholder for a token whose metadata names no image', async () => {
    const { nftAddress, tokenId } = DIAGNOSED_TOKENS.noImage;
    renderBox({ nftAddress, tokenId });
    await nameOf('Curonian Spit');
    expect(screen.getByRole('img', { name: 'Curonian Spit' }).getAttribute('src')).toMatch(/^data:image\/svg\+xml,.*NFT %233%3C/);
  });
});
