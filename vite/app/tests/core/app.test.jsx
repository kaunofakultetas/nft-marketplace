// -----------------------------------------------------------
//  [*] Tests — App (the shell, routing, the toast outlet)
//
//  The real App.jsx through its own BrowserRouter: every route
//  framed the same — the header on top, the routed page in the
//  main landmark, the footer at the bottom; the header's links,
//  the wordmark, a card and a page's own links moving the
//  student between pages, and the browser's Back too, every
//  new page opened at its top and the sell form holding only
//  the token the address bar names; every "← Back to …" link
//  at the top of its page, leading back to the page the
//  student came from by its name — to the marketplace only
//  for a page opened directly;
//  each route asking the backend for what its page shows and
//  nothing more; the shared toast outlet — a success toast up
//  for ten seconds, an error for fifteen; and an address no
//  route knows, said not to exist — naming the address, with
//  the way back.
// -----------------------------------------------------------

import { describe, it, expect, vi } from 'vitest';
import { screen, within, act, waitFor, fireEvent } from '@testing-library/react';
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

// The sell form's word that the address bar filled it in
const PREFILLED = '✅ NFT details have been prefilled! Just enter the price.';

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
//
// Every route framed the same — the header, the page, the
// footer — the connect prompt on the pages that need a
// wallet, and an address no route knows said not to exist.
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


  it('says the page does not exist for an address no route knows — naming the address, with the way back', async () => {
    const { user } = renderApp({ route: '/no/such/page' });
    expect(await pageHeading('Page not found')).toBeInTheDocument();
    expect(within(main()).getByText('/no/such/page')).toBeInTheDocument();
    await user.click(within(main()).getByRole('link', { name: '← Back to Marketplace' }));
    expect(await within(main()).findByText('Please connect your wallet to browse the marketplace')).toBeInTheDocument();
  });
});







// -----------------------------------------------------------
// Moving between pages
// -----------------------------------------------------------
//
// The ways between the pages: the header's links, the
// wordmark, a card, the owner's way to the sell form — the
// form holding only the token the address bar names, there
// and back — and the browser's Back: every new page opening
// at its top, Back leaving the scroll to the browser.
// -----------------------------------------------------------

describe('Moving between pages', () => {

  const field = (label) => within(main()).getByLabelText(label);

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
    await user.click(await within(main()).findByRole('link', { name: 'List for Sale' }));
    expect(await pageHeading('Sell your NFT')).toBeInTheDocument();
    expect(window.location.search).toBe(`?nftAddress=${f.PUGS}&tokenId=3`);
    expect(screen.getByText(PREFILLED)).toBeInTheDocument();
  });


  it('opens the sell form empty from the header — not still holding the token it was prefilled with', async () => {
    const { user } = renderConnected(`/nft/${f.PUGS}/3`);
    await user.click(await within(main()).findByRole('link', { name: 'List for Sale' }));
    await pageHeading('Sell your NFT');
    await user.type(field('Price (in ETH)'), '0.5');
    await user.click(within(screen.getByRole('navigation')).getByRole('link', { name: 'Sell NFT' }));
    await waitFor(() => expect(window.location.search).toBe(''));
    expect(field('NFT Address')).toHaveValue('');
    expect(field('Token ID')).toHaveValue(null);
    expect(field('Price (in ETH)')).toHaveValue(null);
    expect(screen.queryByText(PREFILLED)).toBeNull();
  });


  it('fills the sell form for its token again when Back returns to it', async () => {
    const { user } = renderConnected(`/nft/${f.PUGS}/3`);
    await user.click(await within(main()).findByRole('link', { name: 'List for Sale' }));
    await pageHeading('Sell your NFT');
    await user.click(within(screen.getByRole('navigation')).getByRole('link', { name: 'Sell NFT' }));
    await waitFor(() => expect(window.location.search).toBe(''));
    await user.type(field('NFT Address'), f.ART);
    await goBack();
    await waitFor(() => expect(window.location.search).toBe(`?nftAddress=${f.PUGS}&tokenId=3`));
    expect(field('NFT Address')).toHaveValue(f.PUGS);
    expect(field('Token ID')).toHaveValue(3);
    expect(screen.getByText(PREFILLED)).toBeInTheDocument();
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


  it('opens a new page at its top — and leaves Back to the browser', async () => {
    const scrolled = vi.spyOn(window, 'scrollTo');
    const { user } = renderConnected('/');
    await pageHeading('NFTs For Sale');
    expect(scrolled).not.toHaveBeenCalled();

    await user.click(await within(main()).findByText('Vilnius at Dusk'));
    await pageHeading('Vilnius at Dusk');
    expect(scrolled).toHaveBeenCalledWith(0, 0);

    scrolled.mockClear();
    await goBack();
    await waitFor(() => expect(window.location.pathname).toBe('/'));
    expect(scrolled).not.toHaveBeenCalled();
  });
});







// -----------------------------------------------------------
// Going back
// -----------------------------------------------------------
//
// Every page's "← Back to …" link, at the top of the page
// above its heading, leads back to the page the student came
// from, by that page's name — the sell form by the token it
// was prefilled with, so the plain form never names itself —
// through the browser's own Back, the history not growing,
// and to the marketplace only for a page opened directly.
// -----------------------------------------------------------

describe('Going back', () => {

  const backLink = (name) => within(main()).findByRole('link', { name: `← Back to ${name}` });

  async function goesBackTo(user, name, path, heading) {
    const entries = window.history.length;
    await user.click(await backLink(name));
    await waitFor(() => expect(window.location.pathname).toBe(path));
    expect(await pageHeading(heading)).toBeInTheDocument();
    expect(window.history.length).toBe(entries);
  }


  it.each([
    ['/my-nfts', 'My NFTs'],
    ['/sell-nft', 'Sell your NFT'],
    ['/history', 'Marketplace Activity'],
    [`/nft/${f.ART}/0`, 'Vilnius at Dusk'],
  ])('puts the way back at the top of %s, above the page\'s heading', async (route, heading) => {
    renderConnected(route);
    const title = await pageHeading(heading);
    expect(following(await backLink('Marketplace'), title)).toBe(true);
  });


  it('takes the student back to My NFTs from an NFT opened there — not to the storefront', async () => {
    const { user } = renderConnected('/my-nfts');
    await user.click(await within(main()).findByText('NFT #2'));
    await pageHeading('NFT #2');
    await goesBackTo(user, 'My NFTs', '/my-nfts', 'My NFTs');
  });


  it('takes the student back to the activity feed from an NFT opened there', async () => {
    const { user } = renderConnected('/history');
    await user.click(await within(main()).findByText('Vilnius at Dusk'));
    await pageHeading('Vilnius at Dusk');
    await goesBackTo(user, 'Activity', '/history', 'Marketplace Activity');
  });


  it('takes the student back to the storefront from an NFT opened there', async () => {
    const { user } = renderConnected('/');
    await user.click(await within(main()).findByText('Vilnius at Dusk'));
    await pageHeading('Vilnius at Dusk');
    await goesBackTo(user, 'Marketplace', '/', 'NFTs For Sale');
  });


  it('takes the owner back to the NFT from the sell form it opened', async () => {
    const { user } = renderConnected(`/nft/${f.PUGS}/3`);
    await user.click(await within(main()).findByRole('link', { name: 'List for Sale' }));
    await pageHeading('Sell your NFT');
    await goesBackTo(user, 'NFT #3', `/nft/${f.PUGS}/3`, 'PUG');
  });


  it('names the prefilled sell form after its token — the plain one the header opens never names itself', async () => {
    const { user } = renderConnected(`/nft/${f.PUGS}/3`);
    await user.click(await within(main()).findByRole('link', { name: 'List for Sale' }));
    await pageHeading('Sell your NFT');
    await user.click(within(screen.getByRole('navigation')).getByRole('link', { name: 'Sell NFT' }));
    await waitFor(() => expect(window.location.search).toBe(''));
    const entries = window.history.length;
    await user.click(await backLink('Sell NFT #3'));
    await waitFor(() => expect(window.location.search).toBe(`?nftAddress=${f.PUGS}&tokenId=3`));
    expect(window.history.length).toBe(entries);
    expect(await backLink('NFT #3')).toBeInTheDocument();
  });


  it('takes the student back to the page the header was clicked on', async () => {
    const { user } = renderConnected('/history');
    await pageHeading('Marketplace Activity');
    await user.click(within(screen.getByRole('navigation')).getByRole('link', { name: 'My NFTs' }));
    await pageHeading('My NFTs');
    await goesBackTo(user, 'Activity', '/history', 'Marketplace Activity');
  });


  it('keeps naming where a page was opened from when its own header link is clicked again', async () => {
    const { user } = renderConnected('/');
    await pageHeading('NFTs For Sale');
    const myNfts = () => within(screen.getByRole('navigation')).getByRole('link', { name: 'My NFTs' });
    await user.click(myNfts());
    await pageHeading('My NFTs');
    await user.click(myNfts());
    expect(await backLink('Marketplace')).toBeInTheDocument();
  });


  it('leads to the marketplace from a page opened directly — there is nothing of the app\'s to go back to', async () => {
    const { user } = renderConnected(`/nft/${f.ART}/0`);
    await pageHeading('Vilnius at Dusk');
    await user.click(await backLink('Marketplace'));
    await waitFor(() => expect(window.location.pathname).toBe('/'));
    expect(await pageHeading('NFTs For Sale')).toBeInTheDocument();
  });


  it('leaves a click that opens a new tab to the link itself', async () => {
    const { user } = renderConnected('/my-nfts');
    await user.click(await within(main()).findByText('NFT #2'));
    await pageHeading('NFT #2');
    const link = await backLink('My NFTs');
    expect(link).toHaveAttribute('href', '/my-nfts');
    fireEvent.click(link, { ctrlKey: true });
    await settle(100);
    expect(window.location.pathname).toBe(`/nft/${f.ART}/2`);
  });
});







// -----------------------------------------------------------
// What each route asks the backend
// -----------------------------------------------------------
//
// Each route asks the backend only for what its page shows,
// once each — and reaches the chain only through the relay,
// IPFS only through the local gateway.
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
