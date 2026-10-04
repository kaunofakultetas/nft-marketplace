// -----------------------------------------------------------
//  [*] Tests — App (the shell, routing, the toast outlet)
//
//  The real App.jsx through its own BrowserRouter: every route
//  framed the same — the header on top, the routed page in the
//  main landmark, the footer at the bottom; the header's links,
//  the wordmark, a card and a page's own links moving the
//  student between pages, and the browser's Back too; each
//  route asking the backend for what its page shows and
//  nothing more; the shared toast outlet — a success toast up
//  for ten seconds, an error for fifteen.
//
//  Pinned: there is no catch-all route — a mistyped address
//  leaves the main area empty instead of saying the page does
//  not exist.
// -----------------------------------------------------------

import { describe, it, expect, vi } from 'vitest';
import { screen, within, act, waitFor } from '@testing-library/react';
import toast from 'react-hot-toast';
import { renderApp } from '../support/render';
import { settle } from '../support/backend/contract';
import { goBack } from '../support/shell/router';
import { watchRequests } from '../support/shell/requests';
import * as f from '../support/backend/fixtures';
import { installMetamask } from '../support/wallets/metamask';


// Every route with the heading its page shows a connected
// student
const PAGES = [
  ['/', 'NFTs For Sale'],
  ['/my-nfts', 'My NFTs'],
  ['/sell-nft', 'Sell your NFT'],
  ['/history', 'Marketplace Activity'],
  ['/about', 'About this marketplace'],
  [`/nft/${f.ART}/0`, 'Vilnius at Dusk'],
];

const main = () => screen.getByRole('main');
const pageHeading = (name) => within(main()).findByRole('heading', { level: 1, name });

const renderConnected = (route) => {
  installMetamask({ connected: true });
  return renderApp({ route });
};

const following = (a, b) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);







// -----------------------------------------------------------
// The shell
// -----------------------------------------------------------

describe('The shell', () => {

  it.each(PAGES)('frames %s — the header on top, the page in main, the footer at the bottom', async (route, heading) => {
    renderConnected(route);
    expect(await pageHeading(heading)).toBeInTheDocument();
    const [header, page, footer] = [screen.getByRole('navigation'), main(), screen.getByRole('contentinfo')];
    expect(following(header, page)).toBe(true);
    expect(following(page, footer)).toBe(true);
  });


  it('asks a student without a wallet to connect on every page that needs one', async () => {
    renderApp({ route: '/history' });
    expect(within(main()).getByText('Please connect your wallet to view marketplace activity')).toBeInTheDocument();
    expect(within(main()).getByRole('link', { name: 'Install MetaMask' })).toBeInTheDocument();
    await settle(100);
  });


  it('keeps the shell around an address no route knows', async () => {
    renderApp({ route: '/no/such/page' });
    await settle(100);
    expect(screen.getByRole('navigation')).toBeInTheDocument();
    expect(screen.getByRole('contentinfo')).toBeInTheDocument();
  });


  it.fails('says the page does not exist for an address no route knows — PINNED KNOWN BUG: App.jsx has no catch-all route, the main area stays empty', async () => {
    renderApp({ route: '/no/such/page' });
    await settle(100);
    expect(main()).not.toBeEmptyDOMElement();
  });
});







// -----------------------------------------------------------
// Moving between pages
// -----------------------------------------------------------

describe('Moving between pages', () => {

  it.each([
    ['My NFTs', '/my-nfts', 'My NFTs'],
    ['Sell NFT', '/sell-nft', 'Sell your NFT'],
    ['Activity', '/history', 'Marketplace Activity'],
    ['About', '/about', 'About this marketplace'],
  ])('takes the student from the header\'s "%s" to its page', async (label, path, heading) => {
    const { user } = renderConnected('/');
    await pageHeading('NFTs For Sale');
    await user.click(within(screen.getByRole('navigation')).getByRole('link', { name: label }));
    expect(await pageHeading(heading)).toBeInTheDocument();
    expect(window.location.pathname).toBe(path);
    expect(within(screen.getByRole('navigation')).getByRole('link', { name: label })).toHaveAttribute('aria-current', 'page');
  });


  it('takes the student home from the wordmark', async () => {
    const { user } = renderConnected('/about');
    await pageHeading('About this marketplace');
    await user.click(screen.getByRole('link', { name: 'NFT Marketplace' }));
    expect(await pageHeading('NFTs For Sale')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/');
  });


  it('opens an NFT from its card in the storefront', async () => {
    const { user } = renderConnected('/');
    await user.click(await within(main()).findByText('Vilnius at Dusk'));
    expect(await pageHeading('Vilnius at Dusk')).toBeInTheDocument();
    expect(window.location.pathname).toBe(`/nft/${f.ART}/0`);
  });


  it('sends the owner of an unlisted NFT to the sell form, prefilled', async () => {
    const { user } = renderConnected(`/nft/${f.PUGS}/3`);
    await user.click(await within(main()).findByRole('button', { name: 'List for Sale' }));
    expect(await pageHeading('Sell your NFT')).toBeInTheDocument();
    expect(window.location.search).toBe(`?nftAddress=${f.PUGS}&tokenId=3`);
    expect(screen.getByText('✅ NFT details have been prefilled! Just enter the price.')).toBeInTheDocument();
  });


  it('goes back with the browser\'s Back', async () => {
    const { user } = renderConnected('/');
    await pageHeading('NFTs For Sale');
    await user.click(screen.getByRole('link', { name: 'About' }));
    await pageHeading('About this marketplace');
    await goBack();
    await waitFor(() => expect(window.location.pathname).toBe('/'));
    expect(await pageHeading('NFTs For Sale')).toBeInTheDocument();
  });
});







// -----------------------------------------------------------
// What each route asks the backend
// -----------------------------------------------------------

describe('What each route asks the backend', () => {

  it.each([
    ['/', ['GET /api/listings', 'GET /api/stats']],
    ['/my-nfts', [`GET /api/my-nfts/${f.checksummed(f.STUDENT)}`, 'GET /api/listings']],
    ['/sell-nft', [`GET /api/my-nfts/${f.checksummed(f.STUDENT)}`, 'GET /api/listings']],
    ['/history', ['GET /api/activity']],
    ['/about', ['GET /api/stats']],
    [`/nft/${f.PUGS}/0`, [`GET /api/nft/${f.PUGS}/0`]],
  ])('%s asks for what its page shows, once each', async (route, expected) => {
    const seen = watchRequests('/api/*');
    renderConnected(route);
    await settle(600);
    const reads = seen.filter((request) => request.startsWith('GET '));
    expect([...reads].sort()).toEqual([...expected].sort());
  });


  it('reads the chain only through the relay, and IPFS only through the local gateway', async () => {
    const posts = watchRequests('/api/*');
    const gateway = watchRequests('/ipfs/*');
    renderConnected('/');
    await within(main()).findByText('Vilnius at Dusk');
    await settle(300);
    expect([...new Set(posts.filter((request) => request.startsWith('POST ')))]).toEqual(['POST /api/rpc']);
    expect(gateway.length).toBeGreaterThan(0);
  });
});







// -----------------------------------------------------------
// The toast outlet
// -----------------------------------------------------------
//
// App.jsx's Toaster: every page's toasts appear there. The
// timers are faked (setTimeout and the clock) once the page
// is in, so the durations can be walked through. A dismissed
// toast takes another second to leave, on a timer the outlet
// only sets once it has drawn the dismissal — so the clock is
// walked in steps, the outlet rendering between them.
// -----------------------------------------------------------

describe('The toast outlet', () => {

  const passTime = (ms) => act(() => vi.advanceTimersByTime(ms));


  it('keeps a success toast up for ten seconds and an error toast for fifteen', async () => {
    renderApp({ route: '/about' });
    await pageHeading('About this marketplace');
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });

    act(() => {
      toast.success('Listing updated!');
      toast.error('Transaction rejected in the wallet.');
    });
    expect(screen.getByText('Listing updated!').closest('[role="status"]')).toBeInTheDocument();

    passTime(9900);
    expect(screen.getByText('Listing updated!')).toBeInTheDocument();

    passTime(200);
    passTime(1100);
    expect(screen.queryByText('Listing updated!')).toBeNull();
    expect(screen.getByText('Transaction rejected in the wallet.')).toBeInTheDocument();

    passTime(3700);
    expect(screen.getByText('Transaction rejected in the wallet.')).toBeInTheDocument();
    passTime(200);
    passTime(1100);
    expect(screen.queryByText('Transaction rejected in the wallet.')).toBeNull();
  });
});
