// -----------------------------------------------------------
//  [*] Tests — NFT detail: what the page must survive
//
//  The backend contract matrix of /api/nft/<nftAddress>/<id>,
//  the one backend read of the page — for the student visiting
//  a listed token, so the answer decides the price, the Buy
//  button, the timeline and the archive — and the page's other
//  two sources failing on their own: the IPFS gateway gone
//  (the token diagnosed as unreachable, everything else in
//  place) and the RPC relay gone — said as such, the token
//  never blamed. A failed backend read is said where the
//  history would be, and never passes for a token that was
//  never traded; an answer of the wrong shape never crashes
//  the page.
// -----------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { screen, within } from '@testing-library/react';
import { given } from '../../support/backend/server';
import { describeEndpointContract } from '../../support/backend/contract';
import { renderDetail, stripes, infoRow } from '../../support/nft-detail/page';
import { DIAGNOSES, UNREADABLE } from '../../support/diagnoses';
import * as f from '../../support/backend/fixtures';


const PROBLEM = '⚠ This NFT has a problem';







// -----------------------------------------------------------
// The other sources failing
// -----------------------------------------------------------
//
// The page's other two sources failing on their own — the
// IPFS gateway gone, the RPC relay gone — the backend's data
// standing either way.
// -----------------------------------------------------------

describe('The other sources failing', () => {

  it('keeps the backend\'s data and the owner when the IPFS gateway is gone — the token diagnosed as unreachable', async () => {
    given.networkError('get', '/ipfs/*');
    renderDetail(f.PUGS, '0');
    expect(await screen.findByRole('heading', { level: 3, name: PROBLEM })).toBeInTheDocument();
    expect(screen.getByText(DIAGNOSES.unreachable.message)).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Buy Now for 0.05 ETH' })).toBeInTheDocument();
    expect(stripes()).toHaveLength(2);
    expect(screen.getByRole('link', { name: `${f.short(f.checksummed(f.SELLER))} ↗` })).toBeInTheDocument();
  });


  it('does not blame the token when the RPC relay is gone — the chain cannot be read, and the page says so', async () => {
    given.json('post', '/api/rpc', { error: 'RPC relay failed: the RPC provider did not answer in time' }, { status: 502 });
    renderDetail(f.PUGS, '0');
    await screen.findByText('Price updated');
    expect(await screen.findByRole('heading', { level: 3, name: `⚠ ${UNREADABLE.title}` }, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByText(UNREADABLE.message)).toBeInTheDocument();
    expect(await within(infoRow('Current Owner:')).findByText('unknown (the chain cannot be read right now)', {}, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.queryByText('unknown (ownerOf reverted)')).toBeNull();
    expect(screen.queryByText(DIAGNOSES.revert.message)).toBeNull();
    expect(screen.queryByRole('heading', { level: 3, name: PROBLEM })).toBeNull();
  });
});







// -----------------------------------------------------------
// Backend contract
// -----------------------------------------------------------
//
// A failed read is "Error: <the message>" where the history
// would be, and the actions say the listing is unknown — it
// never passes for a token that was never traded.
// -----------------------------------------------------------

describeEndpointContract({
  path: '/api/nft/:nftAddress/:tokenId',
  fixture: f.nft(f.PUGS, '0'),
  render: () => renderDetail(f.PUGS, '0'),
  chrome: () => screen.getByRole('link', { name: '← Back to Marketplace' }),
  loaded: async () => {
    expect(await screen.findByRole('button', { name: 'Buy Now for 0.05 ETH' })).toBeInTheDocument();
    expect(stripes()).toHaveLength(2);
  },
  failed: async (message) => {
    await screen.findByRole('heading', { level: 3, name: 'Actions' });
    expect(await screen.findByText(`Error: ${message}`)).toBeInTheDocument();
    expect(screen.getByText('Whether this NFT is for sale could not be loaded')).toBeInTheDocument();
    expect(screen.queryByText('No transaction history yet')).toBeNull();
    expect(screen.queryByText('This NFT is not currently for sale')).toBeNull();
  },
  loading: () => screen.getByRole('heading', { level: 3, name: 'Transaction History' }) && !screen.queryByText('No transaction history yet'),
});
