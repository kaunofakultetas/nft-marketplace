// -----------------------------------------------------------
//  [*] Tests — Home, the storefront (route /)
//
//  Without a wallet only the connect prompt. With one: the
//  stats bar — floor price (a dash with nothing listed),
//  listings, sales, volume, the marketplace contract linked on
//  Etherscan and the block the indexer has scanned to, with
//  its time — then "NFTs For Sale" over the grid of cards in
//  the backend's order (newest listing first), sortable by
//  price with wei compared as big integers, "Loading..." while
//  the listings load, an empty marketplace's nudge towards
//  /sell-nft, and every card opening its NFT. And the backend
//  contract matrices of /api/listings and /api/stats.
//
//  Pinned: a failed listings read is never said — the grid
//  shows "Loading..." for ever; a listing or stats answer of
//  the wrong shape crashes the page (no error boundary in
//  App.jsx, so the student gets a blank page); the sort
//  control has no name.
// -----------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderPage } from '../support/render';
import { given } from '../support/backend/server';
import { describeEndpointContract, settle, variantNames } from '../support/backend/contract';
import { LocationProbe, currentPath } from '../support/shell/router';
import * as f from '../support/backend/fixtures';
import { installMetamask } from '../support/wallets/metamask';
import HomePage from '@/pages/Home/Page';


const CONNECT = 'Please connect your wallet to browse the marketplace';

// The four listings in the backend's order — newest first —
// as their cards name them
const NEWEST_FIRST = [['Vilnius at Dusk', '1.25 ETH'], ['NFT #1', '0.02 ETH'], ['PUG', '0.05 ETH'], ['PUG', '0.1 ETH']];







// -----------------------------------------------------------
// Helpers
// -----------------------------------------------------------
//
// renderHome mounts the page for a returning student (their
// wallet reconnected on load) unless told the browser has no
// wallet; heading waits for the page proper. cards reads the
// grid — every card's name and price, in order; tile reads a
// stat by its label.
// -----------------------------------------------------------

function renderHome({ wallet = true } = {}) {
  if (wallet) installMetamask({ connected: true });
  return renderPage(<><HomePage /><LocationProbe /></>);
}

const heading = () => screen.findByRole('heading', { level: 1, name: 'NFTs For Sale' });

const cards = () => screen.queryAllByRole('heading', { level: 3 }).map((name) => [
  name.textContent,
  name.nextElementSibling.textContent,
]);

const tile = (label) => screen.getByText(label).nextElementSibling;

async function gridLoaded() {
  await heading();
  await screen.findByText('Vilnius at Dusk');
  await screen.findByText('NFT #1');
  await screen.findAllByText('PUG').then((found) => expect(found).toHaveLength(2));
}







// -----------------------------------------------------------
// Without a wallet
// -----------------------------------------------------------

describe('Without a wallet', () => {

  it('only asks the student to connect — no stats, no grid', async () => {
    renderHome({ wallet: false });
    expect(screen.getByText(CONNECT)).toBeInTheDocument();
    await settle(100);
    expect(screen.queryByRole('heading', { level: 1, name: 'NFTs For Sale' })).toBeNull();
    expect(screen.queryByText('Floor Price')).toBeNull();
    expect(screen.queryAllByRole('heading', { level: 3 })).toEqual([]);
  });


  it('shows the store once the student connects', async () => {
    installMetamask();
    const { user } = renderPage(<HomePage />);
    await user.click(await screen.findByRole('button', { name: 'Connect Wallet' }));
    expect(await heading()).toBeInTheDocument();
    expect(screen.queryByText(CONNECT)).toBeNull();
  });
});







// -----------------------------------------------------------
// The stats bar
// -----------------------------------------------------------

describe('The stats bar', () => {

  it('shows the floor price, the listings, the sales and the volume', async () => {
    renderHome();
    await screen.findByText('Floor Price');
    expect(tile('Floor Price')).toHaveTextContent('0.02 ETH');
    expect(tile('Listed')).toHaveTextContent('4');
    expect(tile('Sales')).toHaveTextContent('1');
    expect(tile('Volume')).toHaveTextContent('0.03 ETH');
  });


  it('links the marketplace contract on Etherscan, in a new tab that cannot reach back', async () => {
    renderHome();
    const link = await screen.findByRole('link', { name: `${f.MARKETPLACE} ↗` });
    expect(link).toHaveAttribute('href', `https://sepolia.etherscan.io/address/${f.MARKETPLACE}`);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });


  it('says which block the indexer has scanned to, and when', async () => {
    renderHome();
    const line = (await screen.findByRole('link', { name: `${f.MARKETPLACE} ↗` })).parentElement;
    expect(line).toHaveTextContent(`Contract ${f.MARKETPLACE} ↗ · indexed to block 9713040 (2026-09-22 13:21:27)`);
  });


  it('leaves the time out while the indexer has recorded none', async () => {
    given.json('get', '/api/stats', { ...f.stats(), lastScannedAt: null });
    renderHome();
    const line = (await screen.findByRole('link', { name: `${f.MARKETPLACE} ↗` })).parentElement;
    expect(line.textContent.endsWith('· indexed to block 9713040')).toBe(true);
  });


  it('shows a dash for the floor price while nothing is listed', async () => {
    given.json('get', '/api/stats', { ...f.stats(), activeListings: 0, floorPriceWei: null });
    renderHome();
    await screen.findByText('Floor Price');
    expect(tile('Floor Price')).toHaveTextContent('—');
    expect(tile('Listed')).toHaveTextContent('0');
  });


  it('stays away while the stats load — the grid does not wait for it', async () => {
    given.hang('get', '/api/stats');
    renderHome();
    await gridLoaded();
    expect(screen.queryByText('Floor Price')).toBeNull();
  });
});







// -----------------------------------------------------------
// The grid
// -----------------------------------------------------------

describe('The grid', () => {

  it('says what it is — live listings indexed from the Sepolia chain', async () => {
    renderHome();
    expect((await heading()).nextElementSibling).toHaveTextContent('Live listings, indexed straight from the Sepolia chain');
  });


  it('says "Loading..." while the listings load', async () => {
    given.hang('get', '/api/listings');
    renderHome();
    await heading();
    expect(screen.getByText('Loading...')).toBeInTheDocument();
    expect(cards()).toEqual([]);
  });


  it('shows a card per listing in the backend\'s order — the newest listing first', async () => {
    renderHome();
    await gridLoaded();
    expect(cards()).toEqual(NEWEST_FIRST);
  });


  it('says "you" on the student\'s own listing and names the other sellers', async () => {
    renderHome();
    await gridLoaded();
    expect(screen.getAllByText('Owned by you')).toHaveLength(1);
    expect(screen.getAllByText(`Owned by ${f.short(f.SELLER)}`)).toHaveLength(3);
  });


  it('opens an NFT\'s own page from its card', async () => {
    const { user } = renderHome();
    await gridLoaded();
    await user.click(screen.getByText('Vilnius at Dusk'));
    expect(currentPath()).toBe(`/nft/${f.ART}/0`);
  });


  it('nudges towards selling when nothing is listed', async () => {
    given.json('get', '/api/listings', { listings: [] });
    const { user } = renderHome();
    expect(await screen.findByText('No NFTs listed yet')).toBeInTheDocument();
    expect(screen.getByText('Be the first to put a token on the marketplace')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Sell your NFT' }));
    expect(currentPath()).toBe('/sell-nft');
  });
});







// -----------------------------------------------------------
// Sorting
// -----------------------------------------------------------

describe('Sorting', () => {

  it('offers newest first — the default — and both price orders', async () => {
    renderHome();
    await heading();
    const sort = screen.getByRole('combobox');
    expect(within(sort).getAllByRole('option').map((option) => [option.value, option.textContent])).toEqual([
      ['newest', 'Newest first'],
      ['price-low', 'Price: low to high'],
      ['price-high', 'Price: high to low'],
    ]);
    expect(sort).toHaveValue('newest');
  });


  it('sorts by price both ways, and back to the newest first', async () => {
    const { user } = renderHome();
    await gridLoaded();
    const prices = () => cards().map(([, price]) => price);

    await user.selectOptions(screen.getByRole('combobox'), 'price-low');
    expect(prices()).toEqual(['0.02 ETH', '0.05 ETH', '0.1 ETH', '1.25 ETH']);
    await user.selectOptions(screen.getByRole('combobox'), 'price-high');
    expect(prices()).toEqual(['1.25 ETH', '0.1 ETH', '0.05 ETH', '0.02 ETH']);
    await user.selectOptions(screen.getByRole('combobox'), 'newest');
    expect(cards()).toEqual(NEWEST_FIRST);
  });


  it('compares the prices as big integers — two prices one wei apart, beyond what a float can tell', async () => {
    given.json('get', '/api/listings', { listings: [
      { nftAddress: f.PUGS, price: '1000000000000000002', seller: f.SELLER, tokenId: '0' },
      { nftAddress: f.ART, price: '1000000000000000001', seller: f.SELLER, tokenId: '0' },
    ] });
    const { user } = renderHome();
    await screen.findByText('Vilnius at Dusk');
    await screen.findByText('PUG');
    await user.selectOptions(screen.getByRole('combobox'), 'price-low');
    expect(cards()).toEqual([['Vilnius at Dusk', '1.000000000000000001 ETH'], ['PUG', '1.000000000000000002 ETH']]);
  });


  it.fails('names the sort control for assistive tech — PINNED KNOWN BUG: the <select> has no label', async () => {
    renderHome();
    await heading();
    expect(screen.getByRole('combobox')).toHaveAccessibleName();
  });
});







// -----------------------------------------------------------
// Backend contract
// -----------------------------------------------------------
//
// /api/listings feeds the grid, /api/stats the bar above it.
// The grid has no failure presentation of its own: a failed
// read must at least be said — it is not (pinned). The stats
// bar simply stays away when its read fails, the grid below
// unaffected — that is its way of failing.
// -----------------------------------------------------------

const NEVER_SAID = 'a failed read is never shown — the grid says "Loading..." for ever';

describeEndpointContract({
  path: '/api/listings',
  fixture: f.listings(),
  render: () => renderHome(),
  chrome: () => screen.getByRole('heading', { level: 1, name: 'NFTs For Sale' }),
  loaded: () => gridLoaded(),
  failed: async (message) => { await screen.findByText(message, { exact: false }, { timeout: 1500 }); },
  loading: () => screen.getByText('Loading...'),
  pins: {
    ...Object.fromEntries(variantNames('failed').map((name) => [name, NEVER_SAID])),
    'types swapped (numbers as strings, strings as numbers) → page survives': 'a seller that is no string crashes its card — truncateAddress slices a number',
    'hostile strings (unicode + markup) → rendered as text, never as elements': 'a price that is no number crashes its card — ethers.formatUnits throws while rendering',
  },
});


describeEndpointContract({
  path: '/api/stats',
  fixture: f.stats(),
  render: () => renderHome(),
  chrome: () => screen.getByRole('heading', { level: 1, name: 'NFTs For Sale' }),
  loaded: async () => { await screen.findByText('Floor Price'); expect(tile('Floor Price')).toHaveTextContent('0.02 ETH'); },
  failed: async () => {
    await heading();
    await settle(100);
    expect(screen.queryByText('Floor Price')).toBeNull();
  },
  pins: {
    'a JSON string → page survives': 'stats without a volume crash the page — ethers.formatUnits(undefined) throws while rendering',
    'a JSON number → page survives': 'stats without a volume crash the page — ethers.formatUnits(undefined) throws while rendering',
    'wrong container (object for a list, list for an object) → page survives': 'stats without a volume crash the page — ethers.formatUnits(undefined) throws while rendering',
    'every field missing → page survives': 'stats without a volume crash the page — ethers.formatUnits(undefined) throws while rendering',
    'every leaf null → page survives': 'a null volume crashes the page — ethers.formatUnits(null) throws while rendering',
    'hostile strings (unicode + markup) → rendered as text, never as elements': 'a floor price that is no number crashes the page — ethers.formatUnits throws while rendering',
  },
});
