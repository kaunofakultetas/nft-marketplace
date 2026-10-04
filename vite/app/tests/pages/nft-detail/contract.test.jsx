// -----------------------------------------------------------
//  [*] Tests — NFT detail: what the page must survive
//
//  The backend contract matrix of /api/nft/<nftAddress>/<id>,
//  the one backend read of the page — for the student visiting
//  a listed token, so the answer decides the price, the Buy
//  button, the timeline and the archive — and the page's other
//  two sources failing on their own: the IPFS gateway gone
//  (the token diagnosed as unreachable, everything else in
//  place) and the RPC relay gone.
//
//  Pinned: a failed backend read passes for a token that was
//  never traded ("not currently for sale", "No transaction
//  history yet"); an answer of the wrong shape crashes the
//  page (App.jsx has no error boundary — a blank page); with
//  the relay down the token is blamed — its owner "unknown
//  (ownerOf reverted)", its tokenURI "reverts on-chain".
// -----------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { given } from '../../support/backend/server';
import { describeEndpointContract, settle, variantNames } from '../../support/backend/contract';
import { renderDetail, stripes } from '../../support/nft-detail/page';
import { DIAGNOSES } from '../../support/diagnoses';
import * as f from '../../support/backend/fixtures';


const PROBLEM = '⚠ This NFT has a problem';







// -----------------------------------------------------------
// The other sources failing
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


  it.fails('does not blame the token when the RPC relay is gone — PINNED KNOWN BUG: the page says its owner is "unknown (ownerOf reverted)" and diagnoses "tokenURI() reverts on-chain"', async () => {
    given.json('post', '/api/rpc', { error: 'RPC relay failed: Read timed out.' }, { status: 502 });
    renderDetail(f.PUGS, '0');
    await screen.findByText('Price updated');
    await settle(2000);
    expect(screen.queryByText('unknown (ownerOf reverted)')).toBeNull();
    expect(screen.queryByText(DIAGNOSES.revert.message)).toBeNull();
  });
});







// -----------------------------------------------------------
// Backend contract
// -----------------------------------------------------------
//
// The page has no failure presentation of its own: a failed
// read must at least not pass for a token that was never
// traded — it does (pinned).
// -----------------------------------------------------------

const NEVER_TRADED = 'a failed read passes for a token never traded — "not currently for sale", "No transaction history yet"';

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
    await settle(100);
    expect(screen.queryByText('No transaction history yet')).toBeNull();
    expect(await screen.findByText(message, { exact: false }, { timeout: 1500 })).toBeInTheDocument();
  },
  loading: () => screen.getByRole('heading', { level: 3, name: 'Transaction History' }) && !screen.queryByText('No transaction history yet'),
  pins: {
    ...Object.fromEntries(variantNames('failed').map((name) => [name, NEVER_TRADED])),
    'types swapped (numbers as strings, strings as numbers) → page survives': 'a CID that is no string crashes the page — cid.slice on a number',
    'hostile strings (unicode + markup) → rendered as text, never as elements': 'a price that is no number crashes the page — ethers.formatUnits throws while rendering',
  },
});
