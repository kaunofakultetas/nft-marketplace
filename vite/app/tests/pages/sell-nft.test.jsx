// -----------------------------------------------------------
//  [*] Tests — Sell your NFT (route /sell-nft)
//
//  Listing is TWO wallet transactions: approve the marketplace
//  on the NFT's collection, wait for that approval to be mined
//  (read through the relay), then listItem on the marketplace
//  — the toasts narrate every step. Pinned down here: without
//  a wallet only the connect prompt; the form filled three
//  ways — a tap on one of the student's unlisted NFTs (the
//  listed one left out), the detail page's prefilled query
//  string with its notice, or by hand; the fields named by
//  their labels; the fields refused together when one is
//  empty, and a price refused before any popup when it is not
//  above zero or finer than ether's 18 decimals; the whole
//  flow against the MetaMask and Sepolia doubles, the listing
//  asked only once the approval is mined — never after an
//  approval that reverted, nor while the relay cannot confirm
//  it, each said in a toast — either popup declined; and the
//  proceeds card — the connected account's unwithdrawn
//  earnings read from the contract, withdrawn in one
//  transaction and read again once it is mined, or "No
//  proceeds to withdraw yet". And the backend contract
//  matrices of /api/my-nfts/<wallet> and /api/listings — the
//  picker offering nothing it cannot vouch for.
// -----------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { screen, act, waitFor, fireEvent } from '@testing-library/react';
import { renderPage } from '../support/render';
import { given } from '../support/backend/server';
import { describeEndpointContract, settle } from '../support/backend/contract';
import { toastSaying, toasts } from '../support/toasts';
import * as f from '../support/backend/fixtures';
import { sepolia } from '../support/chain/sepolia';
import { installMetamask } from '../support/wallets/metamask';
import SellNftPage from '@/pages/SellNft/Page';


const CONNECT = 'Please connect your wallet to sell an NFT';
const FILL_ALL = 'Please fill in all fields: NFT Address, Token ID, and Price';
const REJECTED = 'Transaction rejected in the wallet.';

// The narration, step by step
const CONFIRM_APPROVAL = 'Please confirm the approval transaction in your wallet';
const WAITING = 'Waiting for approval to be confirmed on blockchain...';
const APPROVED = 'Approval confirmed! Now listing your NFT...';
const CONFIRM_LISTING = 'Please confirm the listing transaction in your wallet';
const LISTED = 'Your NFT has been listed! It appears once the indexer scans the block (~30 s).';
const ABOVE_ZERO = 'Please enter a price greater than 0!';
const APPROVAL_REVERTED = 'The approval reverted on-chain — check that this NFT is yours. Nothing was listed.';
const APPROVAL_UNCONFIRMED = 'Could not confirm the approval — the chain cannot be read right now. Check the transaction on Etherscan before listing again.';

const WITHDRAWN = 'Proceeds withdrawn successfully!';







// -----------------------------------------------------------
// Helpers
// -----------------------------------------------------------
//
// renderSell mounts the page at a route (the bare /sell-nft
// unless the test brings a query string) for a returning
// student, and waits for the form; the MetaMask double comes
// back with the view. The fields are found by their
// placeholders; fill types into whichever the test names;
// list submits.
// sentCalls reads the transactions MetaMask sent, decoded.
// -----------------------------------------------------------

async function renderSell({ route = '/sell-nft', accounts } = {}) {
  const metamask = installMetamask({ connected: true, accounts });
  const view = renderPage(<SellNftPage />, { route });
  await screen.findByRole('heading', { level: 1, name: 'Sell your NFT' });
  return { ...view, metamask };
}

const addressField = () => screen.getByPlaceholderText('0x...');
const tokenIdField = () => screen.getByPlaceholderText('0');
const priceField = () => screen.getByPlaceholderText('0.1');

async function fill(user, { address, tokenId, price }) {
  if (address !== undefined) await user.type(addressField(), address);
  if (tokenId !== undefined) await user.type(tokenIdField(), tokenId);
  if (price !== undefined) await user.type(priceField(), price);
}

const list = (user) => user.click(screen.getByRole('button', { name: 'List NFT for Sale' }));

const sentCalls = (metamask) => metamask.sent.map(({ to, call }) => ({ to, ...call }));

const chipName = (nftAddress, tokenId) => `${f.short(nftAddress)} #${tokenId}`;

const proceedsLine = () => screen.getByText(/^Withdraw .* ETH proceeds$/);







// -----------------------------------------------------------
// Without a wallet
// -----------------------------------------------------------

describe('Without a wallet', () => {

  it('only asks the student to connect', async () => {
    renderPage(<SellNftPage />, { route: '/sell-nft' });
    expect(screen.getByText(CONNECT)).toBeInTheDocument();
    await settle(100);
    expect(screen.queryByRole('heading', { level: 1, name: 'Sell your NFT' })).toBeNull();
  });
});







// -----------------------------------------------------------
// The form
// -----------------------------------------------------------

describe('The form', () => {

  it('says what listing takes — two wallet transactions', async () => {
    await renderSell();
    expect(screen.getByRole('heading', { level: 1, name: 'Sell your NFT' }).nextElementSibling)
      .toHaveTextContent('Two wallet transactions: approve the marketplace, then list');
  });


  it('has an address field, a token id and a price in ether — empty', async () => {
    await renderSell();
    expect(screen.getByText('NFT Address')).toBeInTheDocument();
    expect(screen.getByText('Token ID')).toBeInTheDocument();
    expect(screen.getByText('Price (in ETH)')).toBeInTheDocument();
    expect(addressField()).toHaveAttribute('type', 'text');
    expect(tokenIdField()).toHaveAttribute('type', 'number');
    expect(priceField()).toHaveAttribute('type', 'number');
    expect(addressField()).toHaveValue('');
    expect(screen.queryByText(/prefilled/)).toBeNull();
  });


  it('arrives prefilled from an NFT\'s page, and says so', async () => {
    await renderSell({ route: `/sell-nft?nftAddress=${f.PUGS}&tokenId=3` });
    expect(addressField()).toHaveValue(f.PUGS);
    expect(tokenIdField()).toHaveValue(3);
    expect(priceField()).toHaveValue(null);
    expect(screen.getByText('✅ NFT details have been prefilled! Just enter the price.')).toBeInTheDocument();
  });


  it('takes half a prefill without the notice', async () => {
    await renderSell({ route: `/sell-nft?nftAddress=${f.PUGS}` });
    expect(addressField()).toHaveValue(f.PUGS);
    expect(tokenIdField()).toHaveValue(null);
    expect(screen.queryByText(/prefilled/)).toBeNull();
  });


  it('names its fields for assistive tech by their labels', async () => {
    await renderSell();
    expect(screen.getByLabelText('NFT Address')).toBe(addressField());
    expect(screen.getByLabelText('Token ID')).toBe(tokenIdField());
    expect(screen.getByLabelText('Price (in ETH)')).toBe(priceField());
  });
});







// -----------------------------------------------------------
// The student's NFTs
// -----------------------------------------------------------

describe('The student\'s NFTs', () => {

  it('offers every unlisted NFT the wallet holds as a chip, the full address on hover — the listed one left out', async () => {
    await renderSell();
    expect(await screen.findByText('Your NFTs — tap to fill the form')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: chipName(f.PUGS, 3) })).toHaveAttribute('title', f.PUGS);
    expect(screen.getByRole('button', { name: chipName(f.ART, 2) })).toHaveAttribute('title', f.ART);
    expect(screen.queryByRole('button', { name: chipName(f.PUGS, 1) })).toBeNull();
  });


  it('fills the address and the token id from a tap', async () => {
    const { user } = await renderSell();
    await user.click(await screen.findByRole('button', { name: chipName(f.ART, 2) }));
    expect(addressField()).toHaveValue(f.ART);
    expect(tokenIdField()).toHaveValue(2);
  });


  it('offers no chips when the wallet holds nothing unlisted', async () => {
    given.json('get', '/api/my-nfts/:wallet', { nfts: [{ nftAddress: f.PUGS, tokenId: '1' }] });
    await renderSell();
    await settle(200);
    expect(screen.queryByText('Your NFTs — tap to fill the form')).toBeNull();
  });


  it.each([
    ['the holdings', '/api/my-nfts/:wallet', { nfts: { 0: { nftAddress: f.PUGS, tokenId: '3' } } }],
    ['the listings', '/api/listings', { listings: { 0: f.listings().listings[0] } }],
  ])('offers no chips when %s answer carries no list — it cannot vouch for what it would offer', async (_, path, body) => {
    given.json('get', path, body);
    await renderSell();
    await settle(200);
    expect(screen.queryByText('Your NFTs — tap to fill the form')).toBeNull();
    expect(screen.queryByTestId('render-crashed')).toBeNull();
    expect(addressField()).toBeInTheDocument();
  });
});







// -----------------------------------------------------------
// Listing
// -----------------------------------------------------------

describe('Listing', () => {

  it.each([
    ['the address', { tokenId: '3', price: '0.25' }],
    ['the token id', { address: f.PUGS, price: '0.25' }],
    ['the price', { address: f.PUGS, tokenId: '3' }],
  ])('refuses to start without %s — no wallet popup', async (_, fields) => {
    const { user, metamask } = await renderSell();
    await fill(user, fields);
    await list(user);
    expect(await toastSaying(FILL_ALL)).toBeInTheDocument();
    expect(metamask.callsTo('eth_sendTransaction')).toEqual([]);
  });


  it('approves the marketplace on the collection, then lists on the marketplace at the price in wei', async () => {
    const { user, metamask } = await renderSell();
    await user.click(await screen.findByRole('button', { name: chipName(f.PUGS, 3) }));
    await fill(user, { price: '0.25' });
    await list(user);

    expect(await toastSaying(LISTED)).toBeInTheDocument();
    expect(sentCalls(metamask)).toEqual([
      { to: f.PUGS, functionName: 'approve', args: [f.checksummed(f.MARKETPLACE), 3n] },
      { to: f.MARKETPLACE, functionName: 'listItem', args: [f.checksummed(f.PUGS), 3n, BigInt(f.wei('0.25'))] },
    ]);
    expect(sepolia.state.listings.get(`${f.PUGS}-3`)).toEqual({ price: BigInt(f.wei('0.25')), seller: f.STUDENT });
  });


  it('narrates every step in a toast', async () => {
    const { user, metamask } = await renderSell();
    const approval = metamask.hold('eth_sendTransaction');
    await fill(user, { address: f.PUGS, tokenId: '3', price: '0.25' });
    await list(user);

    expect(await toastSaying(CONFIRM_APPROVAL)).toBeInTheDocument();
    const listing = metamask.hold('eth_sendTransaction');
    await act(async () => approval.release());
    expect(await toastSaying(APPROVED)).toBeInTheDocument();
    expect(await toastSaying(CONFIRM_LISTING)).toBeInTheDocument();
    await act(async () => listing.release());
    expect(await toastSaying(LISTED)).toBeInTheDocument();
  });


  it('asks for the listing only once the approval is mined', async () => {
    const { user, metamask } = await renderSell();
    sepolia.holdMining();
    await fill(user, { address: f.PUGS, tokenId: '3', price: '0.25' });
    await list(user);

    expect(await toastSaying(WAITING)).toBeInTheDocument();
    await settle(500);
    expect(sentCalls(metamask).map((call) => call.functionName)).toEqual(['approve']);

    act(() => sepolia.mine());
    expect(await screen.findByText(LISTED, {}, { timeout: 9000 })).toBeInTheDocument();
    expect(sentCalls(metamask).map((call) => call.functionName)).toEqual(['approve', 'listItem']);
  });


  it('stops with "Transaction rejected in the wallet." when the student declines the approval — nothing is listed', async () => {
    const { user, metamask } = await renderSell();
    metamask.decline('eth_sendTransaction');
    await fill(user, { address: f.PUGS, tokenId: '3', price: '0.25' });
    await list(user);
    expect(await toastSaying(REJECTED)).toBeInTheDocument();
    expect(metamask.callsTo('eth_sendTransaction')).toHaveLength(1);
    expect(sepolia.transactions).toEqual([]);
  });


  it('says "Transaction rejected in the wallet." when the student declines the listing — the approval stays mined', async () => {
    const { user, metamask } = await renderSell();
    const approval = metamask.hold('eth_sendTransaction');
    await fill(user, { address: f.PUGS, tokenId: '3', price: '0.25' });
    await list(user);
    await waitFor(() => expect(approval.called).toBe(true));

    // The approval goes through; the next popup is declined
    metamask.decline('eth_sendTransaction');
    await act(async () => approval.release());

    expect(await toastSaying(REJECTED)).toBeInTheDocument();
    expect(sentCalls(metamask).map((call) => call.functionName)).toEqual(['approve']);
    expect(sepolia.state.collections.get(f.PUGS).tokens.get('3').approved).toBe(f.MARKETPLACE);
    expect(sepolia.state.listings.has(`${f.PUGS}-3`)).toBe(false);
  });


  it.each([
    ['zero', '0'],
    ['negative', '-1'],
  ])('refuses a %s price before the wallet is asked — the contract would refuse it only after the approval was paid for', async (_, price) => {
    const { user, metamask } = await renderSell();
    await fill(user, { address: f.PUGS, tokenId: '3', price });
    await list(user);
    expect(await toastSaying(ABOVE_ZERO)).toBeInTheDocument();
    await settle(300);
    expect(metamask.callsTo('eth_sendTransaction')).toEqual([]);
  });


  it('refuses a price with more decimals than ether holds in ethers\' own words, before the wallet is asked', async () => {
    const { user, metamask } = await renderSell();
    await fill(user, { address: f.PUGS, tokenId: '3' });

    // Typed key by key, user-event hands a number field's tiny
    // value on as "1e-19"; a browser passes the digits as typed
    fireEvent.change(priceField(), { target: { value: '0.0000000000000000001' } });
    await list(user);
    expect(await toastSaying('too many decimals for format')).toBeInTheDocument();
    expect(metamask.callsTo('eth_sendTransaction')).toEqual([]);
  });


  it('stops when the approval reverted on-chain — says so, and asks for no listing', async () => {
    const { user, metamask } = await renderSell();

    // PUG #0 is the classmate's — the student cannot approve it
    await fill(user, { address: f.PUGS, tokenId: '0', price: '0.25' });
    await list(user);
    expect(await toastSaying(APPROVAL_REVERTED)).toBeInTheDocument();
    expect(sepolia.transactions[0].receipt.status).toBe('0x0');
    await settle(300);
    expect(screen.queryByText(APPROVED)).toBeNull();
    expect(sentCalls(metamask).map((call) => call.functionName)).toEqual(['approve']);
  });


  it('says when the approval cannot be confirmed with the relay down — rather than waiting for ever', async () => {
    const { user, metamask } = await renderSell();
    given.json('post', '/api/rpc', { error: 'RPC relay failed: the RPC provider did not answer in time' }, { status: 502 });
    await fill(user, { address: f.PUGS, tokenId: '3', price: '0.25' });
    await list(user);
    expect(await screen.findByText(APPROVAL_UNCONFIRMED, {}, { timeout: 5000 })).toBeInTheDocument();
    expect(sentCalls(metamask).map((call) => call.functionName)).toEqual(['approve']);
    expect(toasts()).not.toContain(APPROVED);
  });
});







// -----------------------------------------------------------
// Proceeds
// -----------------------------------------------------------

describe('Proceeds', () => {

  it('shows the student\'s unwithdrawn proceeds, read from the marketplace contract', async () => {
    await renderSell();
    expect(screen.getByRole('heading', { level: 3, name: 'Proceeds' })).toBeInTheDocument();
    await waitFor(() => expect(proceedsLine()).toHaveTextContent('Withdraw 0.03 ETH proceeds'));
    expect(sepolia.readsOf('getProceeds').map((read) => read.args)).toEqual([[f.checksummed(f.STUDENT)]]);
    expect(screen.getByRole('button', { name: 'Withdraw Now' })).toBeInTheDocument();
  });


  it('says there is nothing to withdraw yet for a wallet without proceeds', async () => {
    sepolia.setProceeds(f.STUDENT, 0n);
    await renderSell();
    await settle(300);
    expect(proceedsLine()).toHaveTextContent('Withdraw 0.0 ETH proceeds');
    expect(screen.getByText('No proceeds to withdraw yet')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Withdraw Now' })).toBeNull();
  });


  it('withdraws in one transaction and says so — the ether in the student\'s wallet', async () => {
    const { user, metamask } = await renderSell();
    await user.click(await screen.findByRole('button', { name: 'Withdraw Now' }));
    expect(await toastSaying(WITHDRAWN)).toBeInTheDocument();
    expect(sentCalls(metamask)).toEqual([{ to: f.MARKETPLACE, functionName: 'withdrawProceeds', args: [] }]);
    expect(sepolia.state.proceeds.get(f.STUDENT)).toBe(0n);
    expect(sepolia.state.balances.get(f.STUDENT)).toBe(BigInt(f.wei('1.53')));
  });


  it('says "Transaction rejected in the wallet." when the student declines the withdrawal', async () => {
    const { user, metamask } = await renderSell();
    metamask.decline('eth_sendTransaction');
    await user.click(await screen.findByRole('button', { name: 'Withdraw Now' }));
    expect(await toastSaying(REJECTED)).toBeInTheDocument();
    expect(sepolia.state.proceeds.get(f.STUDENT)).toBe(BigInt(f.wei('0.03')));
  });


  it('stops offering what was withdrawn — the proceeds read again once the withdrawal is mined', async () => {
    const { user } = await renderSell();
    await user.click(await screen.findByRole('button', { name: 'Withdraw Now' }));
    await toastSaying(WITHDRAWN);
    expect(proceedsLine()).toHaveTextContent('Withdraw 0.0 ETH proceeds');
    expect(screen.getByText('No proceeds to withdraw yet')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Withdraw Now' })).toBeNull();
  });


  it('shows the proceeds of another account picked in MetaMask — an account without any reads 0', async () => {
    const { metamask } = await renderSell({ accounts: [f.STUDENT, f.OTHER_ACCOUNT] });
    await waitFor(() => expect(proceedsLine()).toHaveTextContent('Withdraw 0.03 ETH proceeds'));
    act(() => metamask.changeAccounts([f.OTHER_ACCOUNT]));
    await waitFor(() => expect(sepolia.readsOf('getProceeds')).toHaveLength(2));
    await settle(300);
    expect(proceedsLine()).toHaveTextContent('Withdraw 0.0 ETH proceeds');
  });
});







// -----------------------------------------------------------
// Backend contract
// -----------------------------------------------------------
//
// The page reads the backend for the picker alone: the
// wallet's holdings, and the listings to leave out what is
// listed already. The picker is a convenience — the fields
// take any token by hand — so its way of failing is to stay
// away: without both answers, both of them lists, it offers
// nothing it cannot vouch for. The form stands whatever the
// backend says.
// -----------------------------------------------------------

const PICKER = 'Your NFTs — tap to fill the form';

const form = () => screen.getByRole('heading', { level: 1, name: 'Sell your NFT' });

async function pickerStaysAway() {
  await settle(100);
  expect(screen.queryByText(PICKER)).toBeNull();
  expect(addressField()).toBeInTheDocument();
}

describeEndpointContract({
  path: '/api/my-nfts/:wallet',
  fixture: f.myNfts(f.STUDENT),
  render: () => renderSell(),
  chrome: form,
  loaded: async () => {
    expect(await screen.findByRole('button', { name: chipName(f.PUGS, 3) })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: chipName(f.ART, 2) })).toBeInTheDocument();
  },
  failed: () => pickerStaysAway(),
  loading: () => !screen.queryByText(PICKER),
});


describeEndpointContract({
  path: '/api/listings',
  fixture: f.listings(),
  render: () => renderSell(),
  chrome: form,
  loaded: async () => {
    expect(await screen.findByRole('button', { name: chipName(f.PUGS, 3) })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: chipName(f.PUGS, 1) })).toBeNull();
  },
  failed: () => pickerStaysAway(),
  loading: () => !screen.queryByText(PICKER),
});
