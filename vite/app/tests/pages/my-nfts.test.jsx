// -----------------------------------------------------------
//  [*] Tests — My NFTs (route /my-nfts)
//
//  Every NFT the connected wallet holds, as the backend
//  rebuilds it from the wallet's transfer history: without a
//  wallet only the connect prompt; with one, the request for
//  THIS account (wagmi's checksummed address in the path — the
//  backend lowercases it), "Loading your NFTs..." while
//  Etherscan is asked, the count in words (one NFT, several
//  NFTs), a card per token — the student's own listing with
//  its price, matched to /api/listings by collection AND token
//  id, every other token "Not for sale", all of them the
//  student's — Refresh, the backend's failure word for word
//  with Try Again, the empty wallet's way to the marketplace,
//  another account picked in MetaMask; a holdings answer
//  whose list is no list read as holding none. And the
//  backend contract matrices of /api/my-nfts/<wallet> and
//  /api/listings — a failed listings read said above the
//  grid, every price "unknown", never a listed NFT called
//  "Not for sale".
// -----------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { screen, act } from '@testing-library/react';
import { renderPage } from '../support/render';
import { given, url } from '../support/backend/server';
import { describeEndpointContract, settle } from '../support/backend/contract';
import { LocationProbe, currentPath } from '../support/shell/router';
import * as f from '../support/backend/fixtures';
import { installMetamask } from '../support/wallets/metamask';
import MyNftsPage from '@/pages/MyNfts/Page';


const CONNECT = 'Please connect your wallet to view your NFTs';
const ETHERSCAN_DOWN = 'Etherscan request failed: Etherscan answered HTTP 503';

// The student's three NFTs as their cards show them: PUG #1
// listed at 0.1 ETH, PUG #3 and the wrongly minted ART #2
const HOLDINGS = [['PUG', '0.1 ETH'], ['PUG', 'Not for sale'], ['NFT #2', 'Not for sale']];







// -----------------------------------------------------------
// Helpers
// -----------------------------------------------------------
//
// renderMyNfts mounts the page for a returning student (their
// wallet reconnected on load) unless told the browser has no
// wallet; the MetaMask double comes back with the view.
// heading waits for the page proper, cards reads the grid —
// every card's name and price line, in order — and
// cardsLoaded waits until the student's three NFTs are all
// shown.
// -----------------------------------------------------------

function renderMyNfts({ wallet = true, accounts } = {}) {
  const metamask = wallet ? installMetamask({ connected: true, accounts }) : null;
  return { ...renderPage(<><MyNftsPage /><LocationProbe /></>), metamask };
}

const heading = () => screen.findByRole('heading', { level: 1, name: 'My NFTs' });

const cards = () => screen.queryAllByRole('heading', { level: 3 }).map((name) => [
  name.textContent,
  name.nextElementSibling.textContent,
]);

async function cardsLoaded() {
  await screen.findByText('NFT #2');
  await screen.findAllByText('PUG').then((found) => expect(found).toHaveLength(2));
}







// -----------------------------------------------------------
// Without a wallet
// -----------------------------------------------------------
//
// Without a wallet only the connect prompt, and no holdings
// asked for.
// -----------------------------------------------------------

describe('Without a wallet', () => {

  it('only asks the student to connect — and asks the backend for no holdings', async () => {
    const holdings = given.capture('get', '/api/my-nfts/:wallet', f.myNfts(f.STUDENT));
    renderMyNfts({ wallet: false });
    expect(screen.getByText(CONNECT)).toBeInTheDocument();
    await settle(100);
    expect(holdings).toEqual([]);
    expect(screen.queryByRole('heading', { level: 1, name: 'My NFTs' })).toBeNull();
  });
});







// -----------------------------------------------------------
// The wallet's NFTs
// -----------------------------------------------------------
//
// The connected account's holdings: asked for by its address,
// counted in words, a card each — priced from the listings
// once they arrive — with Refresh.
// -----------------------------------------------------------

describe('The wallet\'s NFTs', () => {

  it('says what it shows — every token the wallet holds, from its transfer history', async () => {
    renderMyNfts();
    expect((await heading()).nextElementSibling).toHaveTextContent('Every token your wallet holds, reconstructed from its transfer history');
  });


  it('asks the backend for the connected account\'s NFTs, by its checksummed address', async () => {
    const holdings = given.capture('get', '/api/my-nfts/:wallet', f.myNfts(f.STUDENT));
    renderMyNfts();
    await cardsLoaded();
    expect(holdings.map((call) => call.url)).toEqual([url(`/api/my-nfts/${f.checksummed(f.STUDENT)}`)]);
  });


  it('says it is checking Etherscan while the holdings load', async () => {
    given.hang('get', '/api/my-nfts/:wallet');
    renderMyNfts();
    expect(await screen.findByText('Loading your NFTs...')).toBeInTheDocument();
    expect(screen.getByText('Checking Etherscan for ownership history')).toBeInTheDocument();
  });


  it('counts the NFTs in words and shows a card for each, in the backend\'s order', async () => {
    renderMyNfts();
    await cardsLoaded();
    expect(screen.getByText(/^You own/)).toHaveTextContent('You own 3 NFTs');
    expect(cards()).toEqual(HOLDINGS);
  });


  it('says "1 NFT" for a single one', async () => {
    given.json('get', '/api/my-nfts/:wallet', { nfts: [{ nftAddress: f.PUGS, tokenId: '3' }] });
    renderMyNfts();
    expect(await screen.findByText(/^You own/)).toHaveTextContent('You own 1 NFT');
    expect(screen.getByText(/^You own/).textContent).toBe('You own 1 NFT');
  });


  it('matches a listing by collection AND token id — PUG #1 shows its own price, not ART #1\'s', async () => {
    renderMyNfts();
    await cardsLoaded();
    expect(screen.getByText('0.1 ETH')).toBeInTheDocument();
    expect(screen.queryByText('0.02 ETH')).toBeNull();
  });


  it('calls every card the student\'s own', async () => {
    renderMyNfts();
    await cardsLoaded();
    expect(screen.getAllByText('Owned by you')).toHaveLength(3);
  });


  it('shows the cards as "Not for sale" until the listings arrive, then the price', async () => {
    given.slow('get', '/api/listings', 400, f.listings());
    renderMyNfts();
    await cardsLoaded();
    expect(cards()).toEqual([['PUG', 'Not for sale'], ['PUG', 'Not for sale'], ['NFT #2', 'Not for sale']]);
    expect(await screen.findByText('0.1 ETH')).toBeInTheDocument();
  });


  it('asks again from Refresh', async () => {
    const holdings = given.capture('get', '/api/my-nfts/:wallet', f.myNfts(f.STUDENT));
    const { user } = renderMyNfts();
    await cardsLoaded();
    await user.click(screen.getByRole('button', { name: '🔄 Refresh' }));
    await settle(100);
    expect(holdings).toHaveLength(2);
  });


  it('leads back to the marketplace', async () => {
    const { user } = renderMyNfts();
    await cardsLoaded();
    await user.click(screen.getByRole('link', { name: '← Back to Marketplace' }));
    expect(currentPath()).toBe('/');
  });


  it('reads a holdings answer whose list is no list as holding none', async () => {
    given.json('get', '/api/my-nfts/:wallet', { nfts: {} });
    renderMyNfts();
    expect(await screen.findByText('You don\'t own any NFTs yet')).toBeInTheDocument();
    expect(screen.queryByTestId('render-crashed')).toBeNull();
  });
});







// -----------------------------------------------------------
// An empty wallet, a failure, another account
// -----------------------------------------------------------
//
// The other ways the page can go: an empty wallet, a backend
// failure with Try Again, another account picked in MetaMask,
// every account locked away.
// -----------------------------------------------------------

describe('An empty wallet, a failure, another account', () => {

  it('says the wallet holds no NFTs yet and leads to the marketplace', async () => {
    given.json('get', '/api/my-nfts/:wallet', { nfts: [] });
    const { user } = renderMyNfts();
    expect(await screen.findByText('You don\'t own any NFTs yet')).toBeInTheDocument();
    expect(screen.getByText('Start by minting one, or buy from the marketplace')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Browse Marketplace' }));
    expect(currentPath()).toBe('/');
  });


  it('shows the backend\'s failure word for word, and recovers from Try Again', async () => {
    given.sequence('get', '/api/my-nfts/:wallet', [
      { status: 502, body: { error: ETHERSCAN_DOWN } },
      { body: f.myNfts(f.STUDENT) },
    ]);
    const { user } = renderMyNfts();
    expect(await screen.findByText(`Error: ${ETHERSCAN_DOWN}`)).toBeInTheDocument();
    expect(cards()).toEqual([]);
    await user.click(screen.getByRole('button', { name: 'Try Again' }));
    await cardsLoaded();
    expect(screen.queryByText(`Error: ${ETHERSCAN_DOWN}`)).toBeNull();
  });


  it('follows another account picked in MetaMask — its own holdings', async () => {
    const holdings = given.capture('get', '/api/my-nfts/:wallet', ({ params }) => f.myNfts(params.wallet));
    const { metamask } = renderMyNfts({ accounts: [f.STUDENT, f.OTHER_ACCOUNT] });
    await cardsLoaded();
    act(() => metamask.changeAccounts([f.OTHER_ACCOUNT]));
    expect(await screen.findByText('You don\'t own any NFTs yet')).toBeInTheDocument();
    expect(holdings.map((call) => call.params.wallet)).toEqual([f.checksummed(f.STUDENT), f.checksummed(f.OTHER_ACCOUNT)]);
  });


  it('asks the student to connect again once every account is locked away', async () => {
    const { metamask } = renderMyNfts();
    await cardsLoaded();
    act(() => metamask.changeAccounts([]));
    expect(await screen.findByText(CONNECT)).toBeInTheDocument();
  });
});







// -----------------------------------------------------------
// Backend contract
// -----------------------------------------------------------
//
// /api/my-nfts/<wallet> feeds the grid — its failures are
// shown as "Error: <the message>" with Try Again. /api/listings
// only adds the prices: when it fails the cards still stand,
// the page says the prices are unknown and why, and no card —
// the student's listed NFT least of all — is called unlisted.
// -----------------------------------------------------------

describeEndpointContract({
  path: '/api/my-nfts/:wallet',
  fixture: f.myNfts(f.STUDENT),
  render: () => renderMyNfts(),
  chrome: () => screen.getByRole('heading', { level: 1, name: 'My NFTs' }),
  loaded: () => cardsLoaded(),
  failed: async (message) => {
    expect(await screen.findByText(`Error: ${message}`)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try Again' })).toBeInTheDocument();
  },
  loading: () => screen.getByText('Loading your NFTs...'),
});


describeEndpointContract({
  path: '/api/listings',
  fixture: f.listings(),
  render: () => renderMyNfts(),
  chrome: () => screen.getByRole('heading', { level: 1, name: 'My NFTs' }),
  loaded: async () => { await cardsLoaded(); await screen.findByText('0.1 ETH'); },
  failed: async (message) => {
    await cardsLoaded();
    expect(await screen.findByText(`The marketplace listings could not be loaded, so the prices are unknown: ${message}`)).toBeInTheDocument();
    expect(cards()).toEqual([['PUG', 'Price unknown'], ['PUG', 'Price unknown'], ['NFT #2', 'Price unknown']]);
  },
  loading: () => screen.getAllByText('Not for sale'),
});
