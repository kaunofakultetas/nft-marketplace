// -----------------------------------------------------------
//  [*] Tests — NFT detail: the actions panel
//
//  What the connected student can do with the token, decided
//  by who owns it (ownerOf through the relay, against the
//  wallet's account) and whether it is listed (the backend):
//  the owner of a listed token manages the listing in the
//  modal (a new price, or the listing cancelled); the owner of
//  an unlisted one is sent to /sell-nft with the token
//  prefilled; a visitor buys a listed token through the
//  confirmation modal — the Buy button disabled, with the
//  wallet's balance named, only once the balance read from
//  Sepolia definitely cannot cover the price, never while it
//  is still on its way; a visitor of an unlisted token is
//  told it is not for sale. Without a wallet there is no
//  panel; while the owner or the listing is still loading,
//  only its skeleton. Another account picked in MetaMask
//  turns an owner into a visitor.
// -----------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { screen, act, within } from '@testing-library/react';
import { http } from 'msw';
import { server, given, url } from '../../support/backend/server';
import { settle } from '../../support/backend/contract';
import { currentPath } from '../../support/shell/router';
import { renderDetail, panel } from '../../support/nft-detail/page';
import { toastSaying } from '../../support/toasts';
import * as f from '../../support/backend/fixtures';
import { sepolia } from '../../support/chain/sepolia';


// Multicall3's getEthBalance — how viem reads a wallet's ether
const GET_ETH_BALANCE = '4d2301cc';







// -----------------------------------------------------------
// Helpers
// -----------------------------------------------------------
//
// actions waits for the panel's heading and hands back the
// card; holdBalanceReads keeps the wallet's balance read
// unanswered while every other chain read passes.
// -----------------------------------------------------------

const actions = async () => (await screen.findByRole('heading', { level: 3, name: 'Actions' })).parentElement;

function holdBalanceReads() {
  server.use(http.post(url('/api/rpc'), async (info) => {
    const body = await info.request.clone().text();
    if (body.includes(GET_ETH_BALANCE)) return new Promise(() => {});
    return sepolia.relay(info);
  }));
}







// -----------------------------------------------------------
// Who sees what
// -----------------------------------------------------------
//
// Who gets which actions: none without a wallet, a skeleton
// while the listing loads, "not for sale" for a visitor of an
// unlisted token.
// -----------------------------------------------------------

describe('Who sees what', () => {

  it('shows no actions without a wallet', async () => {
    renderDetail(f.PUGS, '0', { wallet: false });
    await screen.findByText('Price updated');
    await settle(200);
    expect(screen.queryByRole('heading', { level: 3, name: 'Actions' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Buy Now/ })).toBeNull();
  });


  it('shows only a skeleton while the listing is still loading', async () => {
    given.hang('get', '/api/nft/:nftAddress/:tokenId');
    renderDetail(f.PUGS, '0');
    await screen.findByRole('heading', { level: 1, name: 'PUG' });
    await settle(200);
    expect(screen.queryByRole('heading', { level: 3, name: 'Actions' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Buy Now/ })).toBeNull();
  });


  it('tells a visitor an unlisted token is not for sale', async () => {
    renderDetail(f.PUGS, '2');
    const card = await actions();
    expect(within(card).getByText('This NFT is not currently for sale')).toBeInTheDocument();
    expect(within(card).queryByRole('button')).toBeNull();
  });
});







// -----------------------------------------------------------
// The owner
// -----------------------------------------------------------
//
// The owner's actions: managing a listing in the modal, the
// sell form for an unlisted token — and a visitor's view once
// another account is picked.
// -----------------------------------------------------------

describe('The owner', () => {

  it('of a listed token is told so, and manages the listing in the modal', async () => {
    const { user } = renderDetail(f.PUGS, '1');
    const card = await actions();
    expect(within(card).getByText('Your NFT is currently listed for sale')).toBeInTheDocument();
    await user.click(within(card).getByRole('button', { name: 'Update Listing / Cancel' }));
    expect(screen.getByRole('heading', { level: 2, name: 'Manage Listing' })).toBeInTheDocument();
  });


  it('sends a new price for this very token from the modal, which then closes', async () => {
    const { user, metamask } = renderDetail(f.PUGS, '1');
    await user.click(within(await actions()).getByRole('button', { name: 'Update Listing / Cancel' }));
    await user.type(screen.getByPlaceholderText('Enter new price in ETH'), '0.15');
    await user.click(screen.getByRole('button', { name: 'Update Price' }));
    await toastSaying('Listing updated! The new price shows once the indexer scans the block (~30 s).');
    expect(metamask.sent.map(({ to, call }) => ({ to, ...call }))).toEqual([
      { to: f.MARKETPLACE, functionName: 'updateListing', args: [f.checksummed(f.PUGS), 1n, BigInt(f.wei('0.15'))] },
    ]);
    expect(screen.queryByRole('heading', { level: 2, name: 'Manage Listing' })).toBeNull();
  });


  it('closes the modal from Close and opens it again', async () => {
    const { user } = renderDetail(f.PUGS, '1');
    const manage = within(await actions()).getByRole('button', { name: 'Update Listing / Cancel' });
    await user.click(manage);
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('heading', { level: 2, name: 'Manage Listing' })).toBeNull();
    await user.click(manage);
    expect(screen.getByRole('heading', { level: 2, name: 'Manage Listing' })).toBeInTheDocument();
  });


  it('of an unlisted token is sent to the sell form with the token prefilled', async () => {
    const { user } = renderDetail(f.PUGS, '3');
    const card = await actions();
    expect(within(card).getByText('You own this NFT')).toBeInTheDocument();
    await user.click(within(card).getByRole('button', { name: 'List for Sale' }));
    expect(currentPath()).toBe(`/sell-nft?nftAddress=${f.PUGS}&tokenId=3`);
  });


  it('becomes a visitor when another account is picked in MetaMask', async () => {
    const { metamask } = renderDetail(f.PUGS, '1', { accounts: [f.STUDENT, f.OTHER_ACCOUNT] });
    await within(await actions()).findByText('Your NFT is currently listed for sale');
    act(() => metamask.changeAccounts([f.OTHER_ACCOUNT]));
    expect(await screen.findByRole('button', { name: 'Buy Now for 0.1 ETH' })).toBeInTheDocument();
  });
});







// -----------------------------------------------------------
// A visitor buying
// -----------------------------------------------------------
//
// A visitor buying through the confirmation — Buy disabled
// only once the wallet's balance definitely cannot cover the
// price.
// -----------------------------------------------------------

describe('A visitor buying', () => {

  it('buys a listed token for its price through the confirmation', async () => {
    const { user, metamask } = renderDetail(f.PUGS, '0');
    await user.click(await screen.findByRole('button', { name: 'Buy Now for 0.05 ETH' }));
    expect(screen.getByText(/Are you sure/)).toHaveTextContent('Are you sure you want to buy this NFT for 0.05 ETH?');
    await user.click(screen.getByRole('button', { name: 'OK' }));
    await toastSaying('Successfully bought the NFT! The marketplace updates once the indexer scans the block (~30 s).');
    expect(metamask.sent.map(({ to, call, value }) => ({ to, ...call, value }))).toEqual([
      { to: f.MARKETPLACE, functionName: 'buyListing', args: [f.checksummed(f.PUGS), 0n], value: BigInt(f.wei('0.05')) },
    ]);
  });


  it('closes the confirmation from Cancel without buying', async () => {
    const { user, metamask } = renderDetail(f.PUGS, '0');
    await user.click(await screen.findByRole('button', { name: 'Buy Now for 0.05 ETH' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByText(/Are you sure/)).toBeNull();
    expect(metamask.callsTo('eth_sendTransaction')).toEqual([]);
  });


  it('disables Buy and names the wallet\'s balance when it cannot cover the price', async () => {
    renderDetail(f.PUGS, '0', { accounts: [f.OTHER_ACCOUNT] });
    const button = await screen.findByRole('button', { name: 'Buy Now for 0.05 ETH' });
    expect(await screen.findByText('Insufficient balance — your wallet holds 0.0100 ETH')).toBeInTheDocument();
    expect(button).toBeDisabled();
  });


  it('lets a wallet holding exactly the price buy', async () => {
    sepolia.setBalance(f.OTHER_ACCOUNT, f.wei('0.05'));
    renderDetail(f.PUGS, '0', { accounts: [f.OTHER_ACCOUNT] });
    await settle(300);
    expect(await screen.findByRole('button', { name: 'Buy Now for 0.05 ETH' })).toBeEnabled();
    expect(screen.queryByText(/Insufficient balance/)).toBeNull();
  });


  it('keeps Buy usable while the wallet\'s balance is still on its way', async () => {
    holdBalanceReads();
    renderDetail(f.PUGS, '0', { accounts: [f.OTHER_ACCOUNT] });
    expect(await screen.findByRole('button', { name: 'Buy Now for 0.05 ETH' })).toBeEnabled();
    await settle(200);
    expect(screen.queryByText(/Insufficient balance/)).toBeNull();
  });


  it('reads the balance of the connected account from Sepolia', async () => {
    renderDetail(f.PUGS, '0');
    await screen.findByRole('button', { name: 'Buy Now for 0.05 ETH' });
    await settle(200);
    expect(sepolia.readsOf('getEthBalance').map((read) => read.args)).toContainEqual([f.checksummed(f.STUDENT)]);
    expect(panel('Actions')).toBeInTheDocument();
  });
});
