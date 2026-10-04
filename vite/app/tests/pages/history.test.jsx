// -----------------------------------------------------------
//  [*] Tests — Marketplace Activity (route /history)
//
//  The whole marketplace story as one feed: without a wallet
//  only the connect prompt; with one, the request for the
//  newest hundred events, "Loading..." meanwhile, then a table
//  — Event, Item, Price, By, Time, Block, Tx — with a row per
//  event, newest first: its chip in the feed's own words
//  (Listed, Price update, Sold, Canceled), the NFT itself
//  (name and thumbnail, linking to its page), the price in
//  ether or a dash, the actor — the buyer on a sale, the seller
//  otherwise — short with the full address on hover, the block
//  time in the student's own zone, the block, and the
//  transaction linked on Etherscan in a new tab. Filter chips
//  narrow the feed in the browser — a filter that matches
//  nothing says so, never "No activity yet". And the backend
//  contract matrix of /api/activity: a failed read shown as
//  "Error: <the message>", never as an empty marketplace; an
//  event without a transaction hash, with an actor that is no
//  text or a price that is no number, shown without crashing
//  the page.
// -----------------------------------------------------------

import { describe, it, expect, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderPage } from '../support/render';
import { given, url } from '../support/backend/server';
import { describeEndpointContract, settle } from '../support/backend/contract';
import { LocationProbe, currentPath } from '../support/shell/router';
import * as f from '../support/backend/fixtures';
import { installMetamask } from '../support/wallets/metamask';
import HistoryPage from '@/pages/History/Page';


const CONNECT = 'Please connect your wallet to view marketplace activity';
const EMPTY = 'No activity yet';
const HEADERS = ['Event', 'Item', 'Price', 'By', 'Time', 'Block', 'Tx'];

// The story's nine events as the feed's rows show them —
// newest first: the chip, the price, the actor and the time
// (Vilnius summer time)
const FEED = [
  ['Listed', '1.25 ETH', f.short(f.SELLER), '2026-09-22 12:56:20', '9712915'],
  ['Canceled', '—', f.short(f.SELLER), '2026-09-22 12:33:32', '9712801'],
  ['Listed', '0.5 ETH', f.short(f.SELLER), '2026-09-22 12:25:20', '9712760'],
  ['Listed', '0.02 ETH', f.short(f.SELLER), '2026-09-22 11:59:56', '9712633'],
  ['Sold', '0.03 ETH', f.short(f.BUYER), '2026-09-22 11:33:44', '9712502'],
  ['Price update', '0.05 ETH', f.short(f.SELLER), '2026-09-22 11:08:44', '9712377'],
  ['Listed', '0.03 ETH', f.short(f.STUDENT), '2026-09-22 10:41:20', '9712240'],
  ['Listed', '0.1 ETH', f.short(f.STUDENT), '2026-09-22 10:16:56', '9712118'],
  ['Listed', '0.08 ETH', f.short(f.SELLER), '2026-09-22 09:54:08', '9712004'],
];







// -----------------------------------------------------------
// Helpers
// -----------------------------------------------------------
//
// renderHistory mounts the page for a returning student
// (their wallet reconnected on load) unless told the browser
// has no wallet; heading waits for the page proper. rows reads
// the table body — every row's cells — and cellsOf picks the
// columns a test compares; feedLoaded waits until the rows
// are in.
// -----------------------------------------------------------

function renderHistory({ wallet = true } = {}) {
  if (wallet) installMetamask({ connected: true });
  return renderPage(<><HistoryPage /><LocationProbe /></>);
}

const heading = () => screen.findByRole('heading', { level: 1, name: 'Marketplace Activity' });

const rows = () => {
  const table = screen.queryByRole('table');
  if (!table) return [];
  return within(table).getAllByRole('row').slice(1).map((row) => within(row).getAllByRole('cell'));
};

// Chip, price, actor, time and block of every row
const feed = () => rows().map((cells) => [0, 2, 3, 4, 5].map((i) => cells[i].textContent));

async function feedLoaded(count = 9) {
  await heading();
  await screen.findByRole('table');
  expect(rows()).toHaveLength(count);
}

const chip = (label) => screen.getByRole('button', { name: label });







// -----------------------------------------------------------
// Without a wallet
// -----------------------------------------------------------
//
// Without a wallet the page only asks to connect.
// -----------------------------------------------------------

describe('Without a wallet', () => {

  it('only asks the student to connect', async () => {
    renderHistory({ wallet: false });
    expect(screen.getByText(CONNECT)).toBeInTheDocument();
    await settle(100);
    expect(screen.queryByRole('table')).toBeNull();
  });
});







// -----------------------------------------------------------
// The feed
// -----------------------------------------------------------
//
// The feed: the newest hundred events asked for, "Loading..."
// meanwhile, then a row per event — chip, NFT, price, actor,
// local time, block and transaction — or "No activity yet".
// -----------------------------------------------------------

describe('The feed', () => {

  it('says what it shows — every contract event, newest first, each with its transaction', async () => {
    renderHistory();
    expect((await heading()).nextElementSibling).toHaveTextContent('Every contract event, newest first — each with its transaction on-chain');
  });


  it('asks the backend for the newest hundred events', async () => {
    const asked = given.capture('get', '/api/activity', f.activity());
    renderHistory();
    await feedLoaded();
    expect(asked.map((call) => call.url)).toEqual([url('/api/activity?limit=100')]);
  });


  it('says "Loading..." while the events load', async () => {
    given.hang('get', '/api/activity');
    renderHistory();
    await heading();
    expect(screen.getByText('Loading...')).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
  });


  it('heads the table Event, Item, Price, By, Time, Block, Tx', async () => {
    renderHistory();
    await feedLoaded();
    expect(screen.getAllByRole('columnheader').map((header) => header.textContent)).toEqual(HEADERS);
  });


  it('shows a row per event, newest first — chip, price, actor, local time, block', async () => {
    renderHistory();
    await feedLoaded();
    expect(feed()).toEqual(FEED);
  });


  it('names the buyer of a sale, the full address on hover', async () => {
    renderHistory();
    await feedLoaded();
    const sale = rows()[4];
    expect(within(sale[3]).getByText(f.short(f.BUYER))).toHaveAttribute('title', f.BUYER);
  });


  it('shows each event\'s NFT by name, linked to its own page', async () => {
    const { user } = renderHistory();
    await feedLoaded();
    expect(await within(rows()[0][1]).findByText('Vilnius at Dusk')).toBeInTheDocument();
    expect(await within(rows()[1][1]).findByText('Curonian Spit')).toBeInTheDocument();
    expect(await within(rows()[4][1]).findByText('PUG')).toBeInTheDocument();
    await user.click(within(rows()[4][1]).getByRole('link'));
    expect(currentPath()).toBe(`/nft/${f.PUGS}/2`);
  });


  it('links every transaction on Etherscan by its first ten characters, in a new tab that cannot reach back', async () => {
    renderHistory();
    await feedLoaded();
    const link = within(rows()[4][6]).getByRole('link');
    expect(link).toHaveTextContent(`${f.TX.pug2Bought.slice(0, 10)}... ↗`);
    expect(link).toHaveAttribute('href', `https://sepolia.etherscan.io/tx/${f.TX.pug2Bought}`);
    expect(link).toHaveAttribute('title', f.TX.pug2Bought);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });


  it('shows the times in the student\'s own zone', async () => {
    vi.stubEnv('TZ', 'UTC');
    renderHistory();
    await feedLoaded();
    expect(rows()[0][4]).toHaveTextContent('2026-09-22 09:56:20');
  });


  it('says "No activity yet" for a marketplace without events', async () => {
    given.json('get', '/api/activity', { activity: [] });
    renderHistory();
    expect(await screen.findByText(EMPTY)).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
  });


  it('leads back to the marketplace', async () => {
    const { user } = renderHistory();
    await feedLoaded();
    await user.click(screen.getByRole('link', { name: '← Back to Marketplace' }));
    expect(currentPath()).toBe('/');
  });

  it('shows an event type it does not know under its own name, and a row without a transaction a dash', async () => {
    given.json('get', '/api/activity', { activity: [{ ...f.activity().activity[0], type: 'Transferred', txHash: null }] });
    renderHistory();
    await feedLoaded(1);
    expect(feed()[0][0]).toBe('Transferred');
    expect(rows()[0][6]).toHaveTextContent(/^—$/);
  });
});







// -----------------------------------------------------------
// Filtering
// -----------------------------------------------------------
//
// The chips narrow the feed in the browser, asking the
// backend nothing new; a filter matching nothing says so in
// its own words.
// -----------------------------------------------------------

describe('Filtering', () => {

  it('offers All, Listed, Price update, Sold and Canceled', async () => {
    renderHistory();
    await heading();
    expect(['All', 'Listed', 'Price update', 'Sold', 'Canceled'].map((label) => chip(label).textContent))
      .toEqual(['All', 'Listed', 'Price update', 'Sold', 'Canceled']);
  });


  it.each([
    ['Listed', 6, 'Listed'],
    ['Price update', 1, 'Price update'],
    ['Sold', 1, 'Sold'],
    ['Canceled', 1, 'Canceled'],
  ])('narrows the feed to "%s"', async (label, count, shown) => {
    const { user } = renderHistory();
    await feedLoaded();
    await user.click(chip(label));
    expect(rows()).toHaveLength(count);
    expect(feed().every(([event]) => event === shown)).toBe(true);
  });


  it('brings the whole feed back with All, asking the backend nothing new', async () => {
    const asked = given.capture('get', '/api/activity', f.activity());
    const { user } = renderHistory();
    await feedLoaded();
    await user.click(chip('Sold'));
    await user.click(chip('All'));
    expect(feed()).toEqual(FEED);
    expect(asked).toHaveLength(1);
  });


  it('says the filter matches nothing — not that the marketplace has no activity', async () => {
    given.json('get', '/api/activity', { activity: f.activity().activity.filter((event) => event.type !== 'Bought') });
    const { user } = renderHistory();
    await feedLoaded(8);
    await user.click(chip('Sold'));
    expect(screen.getByText('No “Sold” events in the feed')).toBeInTheDocument();
    expect(screen.queryByText(EMPTY)).toBeNull();
  });

});







// -----------------------------------------------------------
// Backend contract
// -----------------------------------------------------------
//
// A failed read is "Error: <the message>" where the feed would
// be — never an empty marketplace.
// -----------------------------------------------------------

describeEndpointContract({
  path: '/api/activity',
  fixture: f.activity(),
  render: () => renderHistory(),
  chrome: () => screen.getByRole('heading', { level: 1, name: 'Marketplace Activity' }),
  loaded: () => feedLoaded(),
  failed: async (message) => {
    await heading();
    await settle(100);
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(await screen.findByText(`Error: ${message}`)).toBeInTheDocument();
  },
  loading: () => screen.getByText('Loading...'),
});
