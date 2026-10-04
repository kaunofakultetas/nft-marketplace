// -----------------------------------------------------------
//  [*] Tests — About this marketplace (route /about)
//
//  The teaching page about the system itself, open without a
//  wallet: the instance's live facts from /api/stats — the
//  network and chain id, the marketplace contract linked on
//  Etherscan, the deployment block and time, the indexer's
//  block, the events indexed, the listings, the lifetime sales
//  and volume — each "…" until the stats are in; the four
//  moving parts of the pipeline; the IPFS archive — a chip per
//  pin status with its count and what it means; and the
//  contract's interface — its functions with a note each, and
//  its events with the signature and the real keccak-256 topic
//  hash as the backend sends them. And the backend contract
//  matrix of /api/stats.
//
//  Pinned: the page says the indexer reads "these three"
//  events above a list of four; stats of the wrong shape crash
//  the page.
// -----------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderPage } from '../support/render';
import { given } from '../support/backend/server';
import { describeEndpointContract, settle } from '../support/backend/contract';
import * as f from '../support/backend/fixtures';
import AboutPage from '@/pages/About/Page';


// What every archive status means, word for word
const MEANINGS = {
  pinned: 'copied to the course IPFS node and kept forever',
  pending: 'still searching the IPFS network for the file — retried every minute',
  skipped: 'not stored on IPFS at all (Arweave or a plain web server) — nothing we can pin',
  invalid: 'the token was minted with broken metadata, so its files cannot be identified',
  unreachable: 'nobody on the IPFS network still hosts the file — it was lost before this archive existed',
};

const FUNCTIONS = [
  ['listItem(address, uint256, uint256)', 'approve first, then list for a price'],
  ['buyListing(address, uint256)', 'payable — send EXACTLY the listing price'],
  ['updateListing(address, uint256, uint256)', 'change the price (re-emits ItemListed)'],
  ['cancelListing(address, uint256)', 'take the token off the market'],
  ['withdrawProceeds()', 'pull your accumulated sale earnings'],
  ['getListing(address, uint256)', 'view — price and seller'],
  ['getProceeds(address)', 'view — withdrawable balance'],
];







// -----------------------------------------------------------
// Helpers
// -----------------------------------------------------------
//
// fact reads the value of one instance fact by its label;
// section finds a card by its title; factsLoaded waits until
// the stats are on the page.
// -----------------------------------------------------------

const renderAbout = () => renderPage(<AboutPage />);

const fact = (label) => screen.getByText(label, { selector: 'span' }).nextElementSibling;

const section = (title) => screen.getByRole('heading', { level: 2, name: title }).parentElement;

async function factsLoaded() {
  await screen.findByText('Sepolia testnet (chain id 11155111)');
}







// -----------------------------------------------------------
// The page
// -----------------------------------------------------------

describe('The page', () => {

  it('says what it is about, without asking for a wallet', async () => {
    renderAbout();
    expect(screen.getByRole('heading', { level: 1, name: 'About this marketplace' }).nextElementSibling)
      .toHaveTextContent('A teaching NFT marketplace of VU Kaunas Faculty — real contract, real chain, machinery on display');
    expect(screen.queryByText(/connect your wallet/)).toBeNull();
    await factsLoaded();
  });


  it('has its four cards in order — the instance, how it works, the archive, the contract', async () => {
    renderAbout();
    await factsLoaded();
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
      'The instance', 'How it works', 'The IPFS archive', 'NFT Marketplace contract interface',
    ]);
  });
});







// -----------------------------------------------------------
// The instance
// -----------------------------------------------------------

describe('The instance', () => {

  it('shows the live facts from the stats', async () => {
    renderAbout();
    await factsLoaded();
    expect(fact('Network')).toHaveTextContent('Sepolia testnet (chain id 11155111)');
    expect(fact('Deployed')).toHaveTextContent('block 9650112 · 2026-09-13 19:35:44');
    expect(fact('Indexed to block')).toHaveTextContent('9713040');
    expect(fact('Events indexed')).toHaveTextContent('9');
    expect(fact('Active listings')).toHaveTextContent('4');
    expect(fact('Lifetime sales')).toHaveTextContent('1 (0.03 ETH volume)');
  });


  it('links the marketplace contract on Etherscan, in a new tab that cannot reach back', async () => {
    renderAbout();
    await factsLoaded();
    const link = within(fact('Marketplace contract')).getByRole('link', { name: `${f.MARKETPLACE} ↗` });
    expect(link).toHaveAttribute('href', `https://sepolia.etherscan.io/address/${f.MARKETPLACE}`);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });


  it('says "…" for every fact while the stats load', async () => {
    given.hang('get', '/api/stats');
    renderAbout();
    await settle(100);
    for (const label of ['Network', 'Marketplace contract', 'Deployed', 'Indexed to block', 'Events indexed', 'Active listings', 'Lifetime sales']) {
      expect(fact(label), label).toHaveTextContent(/^…$/);
    }
  });


  it('says "…" for a deployment the backend could not look up on Etherscan', async () => {
    given.json('get', '/api/stats', { ...f.stats(), deployedAt: null, deploymentBlock: null });
    renderAbout();
    await factsLoaded();
    expect(fact('Deployed')).toHaveTextContent(/^…$/);
  });


  it('says "…" for every fact when the stats cannot be read — and nothing else breaks', async () => {
    given.error('get', '/api/stats', 'Internal server error', 500);
    renderAbout();
    await settle(200);
    expect(fact('Network')).toHaveTextContent(/^…$/);
    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(4);
  });
});







// -----------------------------------------------------------
// How it works
// -----------------------------------------------------------

describe('How it works', () => {

  it('names the four moving parts in order', async () => {
    renderAbout();
    const parts = within(section('How it works')).getAllByRole('listitem');
    const leads = [
      'Your wallet talks to the contract directly.',
      'A backend indexer mirrors the chain.',
      'Chain reads go through a relay.',
      'An IPFS node archives every NFT.',
    ];
    expect(parts).toHaveLength(4);
    parts.forEach((part, i) => expect(part.textContent.startsWith(leads[i]), leads[i]).toBe(true));
    expect(parts[2]).toHaveTextContent('/api/rpc');
    await factsLoaded();
  });
});







// -----------------------------------------------------------
// The IPFS archive
// -----------------------------------------------------------

describe('The IPFS archive', () => {

  const chips = () => within(section('The IPFS archive')).queryAllByText(/^\d+ \w+$/).map((chip) => [chip.textContent, chip.nextElementSibling.textContent]);


  it('shows a chip per status with its count, and what it means', async () => {
    renderAbout();
    await factsLoaded();
    expect(chips()).toEqual([['2 invalid', MEANINGS.invalid], ['10 pinned', MEANINGS.pinned]]);
  });


  it('explains every status the pinner records', async () => {
    given.json('get', '/api/stats', { ...f.stats(), archive: { invalid: 2, pending: 3, pinned: 10, skipped: 1, unreachable: 4 } });
    renderAbout();
    await factsLoaded();
    expect(chips()).toEqual([
      ['2 invalid', MEANINGS.invalid],
      ['3 pending', MEANINGS.pending],
      ['10 pinned', MEANINGS.pinned],
      ['1 skipped', MEANINGS.skipped],
      ['4 unreachable', MEANINGS.unreachable],
    ]);
  });


  it('shows no chip while nothing has been archived yet', async () => {
    given.json('get', '/api/stats', { ...f.stats(), archive: {} });
    renderAbout();
    await factsLoaded();
    expect(chips()).toEqual([]);
  });
});







// -----------------------------------------------------------
// The contract interface
// -----------------------------------------------------------

describe('The contract interface', () => {

  it('lists the functions students call, each with its note', async () => {
    renderAbout();
    await factsLoaded();
    const card = section('NFT Marketplace contract interface');
    expect(FUNCTIONS.map(([signature]) => within(card).getByText(signature).nextElementSibling.textContent))
      .toEqual(FUNCTIONS.map(([, note]) => note));
  });


  it('shows each event the backend sends with its signature, its meaning and its topic hash', async () => {
    renderAbout();
    await factsLoaded();
    const card = section('NFT Marketplace contract interface');
    const events = [
      ['Listed', 'a token was put up for sale'],
      ['Updated', 'a listing’s asking price changed'],
      ['Bought', 'someone bought a listed token (carries buyer, seller and price)'],
      ['Canceled', 'a listing was taken off the market'],
    ];
    for (const [key, meaning] of events) {
      const signature = within(card).getByText(f.EVENT_TOPICS[key].signature);
      expect(signature.parentElement).toHaveTextContent(`${f.EVENT_TOPICS[key].signature} — ${meaning}${f.EVENT_TOPICS[key].topic0}`);
    }
  });


  it('leaves out an event the backend does not send', async () => {
    const { Updated: _, ...eventTopics } = f.EVENT_TOPICS;
    given.json('get', '/api/stats', { ...f.stats(), eventTopics });
    renderAbout();
    await factsLoaded();
    expect(screen.queryByText(f.EVENT_TOPICS.Updated.signature)).toBeNull();
    expect(screen.getByText(f.EVENT_TOPICS.Bought.signature)).toBeInTheDocument();
  });


  it.fails('counts the events it lists — PINNED KNOWN BUG: the page says the indexer reads "these three" above a list of four', async () => {
    renderAbout();
    await factsLoaded();
    expect(screen.getByText(/just by reading these/)).not.toHaveTextContent('these three');
  });
});







// -----------------------------------------------------------
// Backend contract
// -----------------------------------------------------------
//
// Every fact stays "…" when the stats fail — the page's way
// of saying it does not know.
// -----------------------------------------------------------

const NO_VOLUME = 'stats without a volume crash the page — ethers.formatUnits(undefined) throws while rendering';

describeEndpointContract({
  path: '/api/stats',
  fixture: f.stats(),
  render: () => renderAbout(),
  chrome: () => screen.getByRole('heading', { level: 1, name: 'About this marketplace' }),
  loaded: () => factsLoaded(),
  failed: async () => {
    await settle(100);
    expect(fact('Network')).toHaveTextContent(/^…$/);
  },
  loading: () => fact('Network').textContent === '…',
  pins: {
    'a JSON string → page survives': NO_VOLUME,
    'a JSON number → page survives': NO_VOLUME,
    'wrong container (object for a list, list for an object) → page survives': NO_VOLUME,
    'every field missing → page survives': NO_VOLUME,
    'every leaf null → page survives': 'a null volume crashes the page — ethers.formatUnits(null) throws while rendering',
    'hostile strings (unicode + markup) → rendered as text, never as elements': 'a volume that is no number crashes the page — ethers.formatUnits throws while rendering',
  },
});
