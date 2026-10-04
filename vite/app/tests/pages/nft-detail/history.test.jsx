// -----------------------------------------------------------
//  [*] Tests — NFT detail: the history timeline and the archive
//
//  The token's whole story as a timeline, newest at the top,
//  from the backend: each stripe its chip (Listed, Price
//  updated, Sold, Cancelled), the actor's FULL address linked
//  on Etherscan — "to" the buyer of a sale, "by" the seller
//  otherwise — its transaction one click away, the block time
//  in the student's zone with the block, and the price when
//  the event carries one; a skeleton while it loads, a line
//  when there is no story yet; an event type the page does not
//  know shown under its own name, never as a cancellation.
//  Under it the IPFS archive: the pinner's verdict on each of
//  the token's files — its kind, its CID shortened with the
//  full one on hover, its status — and no card at all for a
//  token the pinner never saw.
// -----------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { screen, within } from '@testing-library/react';
import { given } from '../../support/backend/server';
import { settle } from '../../support/backend/contract';
import { renderDetail, panel, stripes, archiveRows } from '../../support/nft-detail/page';
import * as f from '../../support/backend/fixtures';


// One stripe as it reads: the chip, the actor with its joiner
// and the transaction, the time and block, the price
const stripe = (chip, joiner, actor, when, block, price = '') => `${chip}${joiner} ${actor} · tx ↗${when} · block ${block}${price}`;

const timelineLoaded = () => screen.findAllByRole('link', { name: 'tx ↗' });







// -----------------------------------------------------------
// The timeline
// -----------------------------------------------------------

describe('The timeline', () => {

  it('tells a token\'s story newest first — a price update over its listing, by the seller, with the prices', async () => {
    renderDetail(f.PUGS, '0');
    await timelineLoaded();
    expect(stripes()).toEqual([
      stripe('Price updated', 'by', f.SELLER, '2026-09-22 11:08:44', 9712377, '0.05 ETH'),
      stripe('Listed', 'by', f.SELLER, '2026-09-22 09:54:08', 9712004, '0.08 ETH'),
    ]);
  });


  it('names the buyer of a sale — "to" — over the student\'s own listing', async () => {
    renderDetail(f.PUGS, '2');
    await timelineLoaded();
    expect(stripes()).toEqual([
      stripe('Sold', 'to', f.BUYER, '2026-09-22 11:33:44', 9712502, '0.03 ETH'),
      stripe('Listed', 'by', f.STUDENT, '2026-09-22 10:41:20', 9712240, '0.03 ETH'),
    ]);
  });


  it('shows a cancellation without a price', async () => {
    renderDetail(f.ART, '3');
    await timelineLoaded();
    expect(stripes()).toEqual([
      stripe('Cancelled', 'by', f.SELLER, '2026-09-22 12:33:32', 9712801),
      stripe('Listed', 'by', f.SELLER, '2026-09-22 12:25:20', 9712760, '0.5 ETH'),
    ]);
  });


  it('links every actor on Etherscan by the full address, and every transaction, in new tabs that cannot reach back', async () => {
    renderDetail(f.PUGS, '2');
    await timelineLoaded();
    const timeline = panel('Transaction History');

    const buyer = within(timeline).getByRole('link', { name: f.BUYER });
    expect(buyer).toHaveAttribute('href', `https://sepolia.etherscan.io/address/${f.BUYER}`);
    expect(buyer).toHaveAttribute('target', '_blank');
    expect(buyer).toHaveAttribute('rel', 'noopener noreferrer');

    const [sale] = within(timeline).getAllByRole('link', { name: 'tx ↗' });
    expect(sale).toHaveAttribute('href', `https://sepolia.etherscan.io/tx/${f.TX.pug2Bought}`);
    expect(sale).toHaveAttribute('title', f.TX.pug2Bought);
    expect(sale).toHaveAttribute('target', '_blank');
    expect(sale).toHaveAttribute('rel', 'noopener noreferrer');
  });


  it('says there is no history yet for a token the marketplace never saw', async () => {
    renderDetail(f.PUGS, '3');
    expect(await screen.findByText('No transaction history yet')).toBeInTheDocument();
    expect(panel('Transaction History')).toHaveTextContent('No transaction history yet');
    expect(stripes()).toEqual([]);
  });


  it('shows neither stripes nor "no history" while the history loads', async () => {
    given.hang('get', '/api/nft/:nftAddress/:tokenId');
    renderDetail(f.PUGS, '0');
    await screen.findByRole('heading', { level: 1, name: 'PUG' });
    await settle(100);
    expect(stripes()).toEqual([]);
    expect(screen.queryByText('No transaction history yet')).toBeNull();
  });


  it('marks an event type it does not know for what it is — under its own name, never as a cancellation', async () => {
    given.json('get', '/api/nft/:nftAddress/:tokenId', {
      ...f.nft(f.PUGS, '0'),
      events: [{ blockNumber: 9712990, buyer: null, price: null, seller: f.SELLER, timestamp: f.timeOf(9712990), txHash: f.TX.art0Listed, type: 'Transferred' }],
    });
    renderDetail(f.PUGS, '0');
    await timelineLoaded();
    expect(within(panel('Transaction History')).getByText('Transferred')).toBeInTheDocument();
    expect(within(panel('Transaction History')).queryByText('Cancelled')).toBeNull();
  });
});







// -----------------------------------------------------------
// The archive
// -----------------------------------------------------------

describe('The archive', () => {

  it('says what the course node does with the files, and gives the verdict on each', async () => {
    renderDetail(f.PUGS, '0');
    const card = (await screen.findByRole('heading', { level: 3, name: 'IPFS Archive' })).parentElement;
    expect(card).toHaveTextContent('The course IPFS node pins every marketplace NFT\'s files so they outlive their original host.');
    expect(archiveRows()).toEqual([
      ['image', `${f.PUG_IMAGE_CID.slice(0, 12)}...`, 'pinned'],
      ['metadata', `${f.PUG_JSON_CID.slice(0, 12)}...`, 'pinned'],
    ]);
  });


  it('shows each CID in full on hover', async () => {
    renderDetail(f.PUGS, '0');
    await screen.findByRole('heading', { level: 3, name: 'IPFS Archive' });
    expect(screen.getByText(`${f.PUG_JSON_CID.slice(0, 12)}...`)).toHaveAttribute('title', f.PUG_JSON_CID);
  });


  it('shows a file with no CID — a wrongly minted token\'s image — by its status alone', async () => {
    renderDetail(f.ART, '1');
    await screen.findByRole('heading', { level: 3, name: 'IPFS Archive' });
    expect(archiveRows()).toEqual([
      ['image', '', 'invalid'],
      ['metadata', `${f.ART_1_IMAGE_CID.slice(0, 12)}...`, 'pinned'],
    ]);
  });


  it('shows every status the pinner records as it is', async () => {
    given.json('get', '/api/nft/:nftAddress/:tokenId', {
      ...f.nft(f.PUGS, '0'),
      archive: [
        { cid: null, kind: 'image', status: 'unreachable' },
        { cid: null, kind: 'metadata', status: 'pending' },
      ],
    });
    renderDetail(f.PUGS, '0');
    await screen.findByRole('heading', { level: 3, name: 'IPFS Archive' });
    expect(archiveRows()).toEqual([['image', '', 'unreachable'], ['metadata', '', 'pending']]);
  });


  it('has no card for a token the pinner never saw', async () => {
    renderDetail(f.PUGS, '3');
    await screen.findByText('No transaction history yet');
    expect(screen.queryByRole('heading', { level: 3, name: 'IPFS Archive' })).toBeNull();
  });
});
