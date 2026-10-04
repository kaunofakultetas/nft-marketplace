// -----------------------------------------------------------
//  [*] Tests — Header
//
//  The burgundy top bar, the page's navigation landmark: the
//  KNF logo and wordmark leading back home, the five nav links
//  in their order, the current page's link marked for
//  assistive tech (NavLink's aria-current — the filled white
//  pill), Home marked only on "/" itself, no link marked on an
//  NFT's own page, and the wallet button at the end of the
//  bar.
// -----------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderPage } from '../support/render';
import { LocationProbe, currentPath } from '../support/shell/router';
import { installMetamask } from '../support/wallets/metamask';
import * as f from '../support/backend/fixtures';
import Header from '@/components/Header';


const LINKS = [
  ['Home', '/'],
  ['My NFTs', '/my-nfts'],
  ['Sell NFT', '/sell-nft'],
  ['Activity', '/history'],
  ['About', '/about'],
];

const renderHeader = (route = '/') => renderPage(<><Header /><LocationProbe /></>, { route });

const bar = () => screen.getByRole('navigation');
const wordmark = () => within(bar()).getByRole('link', { name: 'NFT Marketplace' });

// The bar's links into the site itself, the wordmark aside
const navLinks = () => within(bar()).getAllByRole('link')
  .filter((link) => link.getAttribute('href').startsWith('/') && link !== wordmark());

const current = () => within(bar()).queryAllByRole('link').filter((link) => link.getAttribute('aria-current') === 'page').map((link) => link.textContent);







// -----------------------------------------------------------
// The bar
// -----------------------------------------------------------

describe('The bar', () => {

  it('is the page\'s navigation landmark, the wordmark a link home with the logo as decoration', async () => {
    const { user } = renderHeader('/about');
    expect(within(wordmark()).getByRole('heading', { level: 1, name: 'NFT Marketplace' })).toBeInTheDocument();
    expect(wordmark().querySelector('img')).toHaveAttribute('alt', '');
    await user.click(wordmark());
    expect(currentPath()).toBe('/');
  });


  it('lists the five pages in their order, each linked where it lives', () => {
    renderHeader();
    expect(navLinks().map((link) => [link.textContent, link.getAttribute('href')])).toEqual(LINKS);
  });


  it.each(LINKS)('takes the student to %s', async (label, path) => {
    const { user } = renderHeader(path === '/' ? '/about' : '/');
    await user.click(within(bar()).getByRole('link', { name: label }));
    expect(currentPath()).toBe(path);
  });


  it('ends with the wallet button — MetaMask\'s download page without a wallet', () => {
    renderHeader();
    expect(within(bar()).getByRole('link', { name: 'Install MetaMask' })).toHaveAttribute('href', 'https://metamask.io/download/');
  });


  it('ends with the connected wallet once the student is connected', async () => {
    installMetamask({ connected: true });
    renderHeader();
    expect(await within(bar()).findByRole('button', { name: `1.5000 ETH · ${f.short(f.checksummed(f.STUDENT))}` })).toBeInTheDocument();
  });
});







// -----------------------------------------------------------
// The current page's link
// -----------------------------------------------------------

describe('The current page\'s link', () => {

  it.each(LINKS)('marks %s as the current page on its own route', (label, path) => {
    renderHeader(path);
    expect(current()).toEqual([label]);
  });


  it('marks no page while an NFT\'s own page is open — Home is current only on "/" itself', () => {
    renderHeader(`/nft/${f.PUGS}/0`);
    expect(current()).toEqual([]);
  });


  it('keeps the page marked with a query string in the address', () => {
    renderHeader(`/sell-nft?nftAddress=${f.PUGS}&tokenId=3`);
    expect(current()).toEqual(['Sell NFT']);
  });
});
