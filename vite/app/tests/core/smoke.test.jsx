// -----------------------------------------------------------
//  [*] Tests — the test harness itself (smoke)
//
//  Proves the foundation before anything is built on it: the
//  runtime config comes from the double before every test; a
//  page's relative fetches reach the backend double and its
//  answers reach the screen; wagmi's reads cross the RPC relay
//  to the Sepolia double (folded into a multicall) and the
//  token URIs they return lead through the IPFS double to the
//  metadata on the cards; an owner read on its own request
//  reaches the same chain; a backend refusal becomes the
//  page's own error
//  presentation; a returning student's MetaMask double is
//  reconnected on load, and a transaction it sends is mined
//  by the chain; the real App boots at a route — and the
//  guards work: a request the double does not know fails the
//  test, and so does a React bug report on the console.
// -----------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderPage, renderApp } from '../support/render';
import { given } from '../support/backend/server';
import { allowUnhandledRequests, allowConsoleErrors } from '../support/setup';
import { expectNoCrash } from '../support/backend/contract';
import * as f from '../support/backend/fixtures';
import { sepolia, MULTICALL3 } from '../support/chain/sepolia';
import { installMetamask } from '../support/wallets/metamask';
import { getConfig } from '@/config';
import HomePage from '@/pages/Home/Page';
import MyNftsPage from '@/pages/MyNfts/Page';
import NftDetailPage from '@/pages/NftDetail/Page';
import ConnectButton from '@/components/ConnectButton';
import BuyNftModal from '@/components/BuyNftModal';


// An address the way the GUI shortens it
const short = (address) => `${address.slice(0, 6)}...${address.slice(-4)}`;







// -----------------------------------------------------------
// harness smoke
// -----------------------------------------------------------

describe('harness smoke', () => {

  it('loads the runtime config from the double before every test, the relay made absolute on the page\'s origin', () => {
    expect(getConfig()).toEqual({
      nftMarketplaceAddress: f.checksummed(f.MARKETPLACE),
      rpcUrl: 'http://localhost:3000/api/rpc',
      ipfsGateway: '/ipfs/',
      ipfsTimeout: 10000,
    });
  });


  it('renders a page whose reads reach every double — the API, the chain behind the relay and the IPFS gateway', async () => {
    installMetamask({ connected: true });
    renderPage(<HomePage />);

    expect(await screen.findByRole('heading', { level: 1, name: 'NFTs For Sale' })).toBeInTheDocument();
    expect(await screen.findByText('Vilnius at Dusk')).toBeInTheDocument();
    expect(screen.getByText('Floor Price').nextElementSibling).toHaveTextContent('0.02 ETH');
    expectNoCrash();

    expect(sepolia.readsOf('tokenURI').map((read) => read.via)).toContain('multicall');
    expect(sepolia.requests.filter((r) => r.method === 'eth_call').every((r) => r.params[0].to === MULTICALL3)).toBe(true);
  });


  it('reads an owner through wagmi and the relay, on its own request', async () => {
    renderPage(<NftDetailPage />, { route: `/nft/${f.PUGS}/0`, path: '/nft/:nftAddress/:tokenId' });

    expect(await screen.findByRole('link', { name: `${short(f.checksummed(f.SELLER))} ↗` })).toBeInTheDocument();
    expect(sepolia.readsOf('ownerOf')).toEqual([{ to: f.PUGS, functionName: 'ownerOf', args: [0n], via: 'direct' }]);
  });


  it('passes a backend refusal on to the page as its own error presentation', async () => {
    installMetamask({ connected: true });
    given.error('get', '/api/my-nfts/:wallet', 'Etherscan request failed: Etherscan answered HTTP 503', 502);
    renderPage(<MyNftsPage />);

    expect(await screen.findByText('Error: Etherscan request failed: Etherscan answered HTTP 503')).toBeInTheDocument();
  });


  it('reconnects a returning student and mines the transaction their wallet sends', async () => {
    const metamask = installMetamask({ connected: true });
    const { user } = renderPage(
      <>
        <ConnectButton />
        <BuyNftModal
          nftAddress={f.PUGS}
          tokenId="0"
          isVisible
          marketplaceAddress={getConfig().nftMarketplaceAddress}
          onClose={() => {}}
          price={f.wei('0.05')}
        />
      </>,
    );

    expect(await screen.findByRole('button', { name: `1.5000 ETH · ${short(f.checksummed(f.STUDENT))}` })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'OK' }));

    const toast = await screen.findByRole('status');
    expect(within(toast).getByText(/Successfully bought the NFT!/)).toBeInTheDocument();
    expect(metamask.sent.map((tx) => [tx.to, tx.call, tx.value])).toEqual([
      [f.MARKETPLACE, { functionName: 'buyListing', args: [f.checksummed(f.PUGS), 0n] }, BigInt(f.wei('0.05'))],
    ]);
    expect(metamask.sent[0].receipt.status).toBe('0x1');
    expect(sepolia.state.collections.get(f.PUGS).tokens.get('0').owner).toBe(f.STUDENT);
  });


  it('boots the real App at a route', async () => {
    renderApp({ route: '/about' });

    expect(await screen.findByRole('heading', { level: 1, name: 'About this marketplace' })).toBeInTheDocument();
    expect(screen.getByRole('navigation')).toBeInTheDocument();
    expect(screen.getByRole('contentinfo')).toHaveTextContent('Copyright © | All Rights Reserved | VUKnF');
  });


  it('records a request no handler answers (the test declares it expects one)', async () => {
    allowUnhandledRequests();
    await expect(fetch('/api/no-such-endpoint')).rejects.toThrow();
  });


  it('lets a test declare a console error it provokes on purpose', () => {
    allowConsoleErrors(/unique "key" prop/);
    console.error('Warning: Each child in a list should have a unique "key" prop.');
  });
});
