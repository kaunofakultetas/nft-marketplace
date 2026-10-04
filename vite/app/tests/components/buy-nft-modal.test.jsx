// -----------------------------------------------------------
//  [*] Tests — BuyNftModal ("are you sure" before a purchase)
//
//  The purchase's last step: the question with the price in
//  ether, Cancel, and OK — which asks MetaMask to send
//  buyListing(nftAddress, tokenId) to the marketplace paying
//  EXACTLY the listing price (the contract refuses any other
//  amount), and tells the student how it went in a toast: the
//  purchase on its way, a rejection in friendly words, or the
//  first line of what the wallet said. The wallet's popup does
//  the real waiting; the chain double mines what it sends.
//
//  Pinned: the modal stays open after a successful purchase,
//  and OK stays live while MetaMask's confirmation is open —
//  either way a second click sends a second purchase.
// -----------------------------------------------------------

import { describe, it, expect, vi } from 'vitest';
import { screen, act, waitFor } from '@testing-library/react';
import { encodeErrorResult, parseAbi } from 'viem';
import { renderPage } from '../support/render';
import { settle } from '../support/backend/contract';
import { toastSaying } from '../support/toasts';
import * as f from '../support/backend/fixtures';
import { sepolia } from '../support/chain/sepolia';
import { installMetamask, rpcError } from '../support/wallets/metamask';
import { getConfig } from '@/config';
import ConnectButton from '@/components/ConnectButton';
import BuyNftModal from '@/components/BuyNftModal';


const SUCCESS = 'Successfully bought the NFT! The marketplace updates once the indexer scans the block (~30 s).';
const QUESTION = 'Are you sure you want to buy this NFT for 0.05 ETH?';

// PUG #0, listed by the classmate at 0.05 ETH
const PRICE = f.wei('0.05');







// -----------------------------------------------------------
// Helpers
// -----------------------------------------------------------
//
// renderModal shows the modal for PUG #0 next to the wallet
// button, and waits for the returning student's wallet to be
// connected — the modal lives on a page that shows it only
// then; `connected: false` leaves the wallet out.
// -----------------------------------------------------------

async function renderModal({ price = PRICE, isVisible = true, connected = true, onClose = vi.fn() } = {}) {
  const metamask = connected ? installMetamask({ connected: true }) : null;
  const view = renderPage(
    <>
      <ConnectButton />
      <BuyNftModal
        nftAddress={f.PUGS}
        tokenId="0"
        isVisible={isVisible}
        marketplaceAddress={getConfig().nftMarketplaceAddress}
        onClose={onClose}
        price={price}
      />
    </>,
  );
  if (connected) await screen.findByRole('button', { name: `1.5000 ETH · ${f.short(f.checksummed(f.STUDENT))}` });
  return { ...view, metamask, onClose };
}

const ok = () => screen.getByRole('button', { name: 'OK' });







// -----------------------------------------------------------
// The question
// -----------------------------------------------------------

describe('The question', () => {

  it('shows nothing while hidden', async () => {
    await renderModal({ isVisible: false });
    expect(screen.queryByText(/Are you sure/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'OK' })).toBeNull();
  });


  it('asks whether to buy the NFT for its price in ether, with Cancel and OK', async () => {
    await renderModal();
    expect(screen.getByText(/Are you sure/)).toHaveTextContent(QUESTION);
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(ok()).toBeInTheDocument();
  });


  it('says "???" where the price should be when it has none', async () => {
    await renderModal({ price: null });
    expect(screen.getByText(/Are you sure/)).toHaveTextContent('Are you sure you want to buy this NFT for ??? ETH?');
  });


  it('closes on Cancel without asking the wallet for anything', async () => {
    const { user, metamask, onClose } = await renderModal();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(metamask.callsTo('eth_sendTransaction')).toEqual([]);
  });
});







// -----------------------------------------------------------
// Buying
// -----------------------------------------------------------

describe('Buying', () => {

  it('asks MetaMask to send buyListing to the marketplace, paying exactly the listing price', async () => {
    const { user, metamask } = await renderModal();
    await user.click(ok());
    await toastSaying(SUCCESS);
    expect(metamask.sent.map(({ from, to, call, value }) => ({ from, to, call, value }))).toEqual([{
      from: f.STUDENT,
      to: f.MARKETPLACE,
      call: { functionName: 'buyListing', args: [f.checksummed(f.PUGS), 0n] },
      value: BigInt(PRICE),
    }]);
  });


  it('tells the student the purchase is on its way — and the chain hands them the token', async () => {
    const { user } = await renderModal();
    await user.click(ok());
    expect(await toastSaying(SUCCESS)).toBeInTheDocument();
    expect(sepolia.transactions[0].receipt.status).toBe('0x1');
    expect(sepolia.state.collections.get(f.PUGS).tokens.get('0').owner).toBe(f.STUDENT);
  });


  it('says "Transaction rejected in the wallet." when the student declines in MetaMask — and nothing is sent', async () => {
    const { user, metamask } = await renderModal();
    metamask.decline('eth_sendTransaction');
    await user.click(ok());
    expect(await toastSaying('Transaction rejected in the wallet.')).toBeInTheDocument();
    expect(sepolia.transactions).toEqual([]);
  });


  it('passes on viem\'s one sentence when MetaMask refuses a purchase the contract would revert', async () => {
    const { user, metamask } = await renderModal();
    const revert = encodeErrorResult({
      abi: parseAbi(['error NftMarketplace__PriceNotMet(address nftAddress, uint256 tokenId, uint256 price)']),
      errorName: 'NftMarketplace__PriceNotMet',
      args: [f.checksummed(f.PUGS), 0n, BigInt(PRICE)],
    });
    metamask.fail('eth_sendTransaction', rpcError(-32603, 'Internal JSON-RPC error.', { code: 3, message: 'execution reverted', data: revert }));
    await user.click(ok());
    expect(await toastSaying('The contract function "buyListing" reverted.')).toBeInTheDocument();
  });


  it('says the wallet is not connected when the student disconnected meanwhile', async () => {
    const { user, metamask } = await renderModal();
    act(() => metamask.changeAccounts([]));
    await screen.findByRole('button', { name: 'Connect Wallet' });
    await user.click(ok());
    expect(await toastSaying('Connector not connected.')).toBeInTheDocument();
  });


  it.fails('closes once the purchase has gone out — PINNED KNOWN BUG: onClose is never called on success, the question stays up and its OK buys again', async () => {
    const { user, onClose } = await renderModal();
    await user.click(ok());
    await toastSaying(SUCCESS);
    expect(onClose).toHaveBeenCalled();
  });


  it.fails('asks MetaMask once for a double click — PINNED KNOWN BUG: OK stays live while the confirmation is open, a second click queues a second purchase', async () => {
    const { user, metamask } = await renderModal();
    const confirmation = metamask.hold('eth_sendTransaction');
    await user.click(ok());
    await waitFor(() => expect(confirmation.called).toBe(true));
    await user.click(ok());
    await settle(100);
    await act(async () => confirmation.release());
    await settle(100);
    expect(metamask.callsTo('eth_sendTransaction')).toHaveLength(1);
  });
});
