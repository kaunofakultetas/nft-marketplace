// -----------------------------------------------------------
//  [*] Tests — UpdateListingModal (manage an existing listing)
//
//  Two actions on one modal, for the student's own listing:
//  a new price — refused in the browser, with an alert and no
//  wallet popup, unless it is above zero; then
//  updateListing(nftAddress, tokenId, price in wei) through
//  MetaMask — or cancelListing. Each tells the student how it
//  went in a toast and closes the modal on success; a
//  declined popup keeps it open with "Transaction rejected in
//  the wallet."; a price ether cannot hold is refused in
//  ethers' own words. × and Close just close — and a price
//  typed before closing goes with the closing: the reopened
//  modal sends only what its field shows. The price field is
//  named by its label.
// -----------------------------------------------------------

import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderPage } from '../support/render';
import { settle } from '../support/backend/contract';
import { toastSaying } from '../support/toasts';
import * as f from '../support/backend/fixtures';
import { sepolia } from '../support/chain/sepolia';
import { installMetamask } from '../support/wallets/metamask';
import { getConfig } from '@/config';
import ConnectButton from '@/components/ConnectButton';
import UpdateListingModal from '@/components/UpdateListingModal';


const UPDATED = 'Listing updated! The new price shows once the indexer scans the block (~30 s).';
const CANCELLED = 'Listing cancelled! It disappears once the indexer scans the block (~30 s).';
const PRICE_REFUSED = 'Please enter a price greater than 0!';







// -----------------------------------------------------------
// Helpers
// -----------------------------------------------------------
//
// renderModal shows the modal for the student's own listing
// (PUG #1, at 0.1 ETH) next to the wallet button and waits for
// the returning student's wallet to be connected; `modal`
// builds the element so a test can rerender it hidden or
// shown, the way the detail page toggles it. alertSpy stands
// in for window.alert, which jsdom does not implement.
// -----------------------------------------------------------

const modal = (props) => (
  <>
    <ConnectButton />
    <UpdateListingModal
      nftAddress={f.PUGS}
      tokenId="1"
      isVisible
      marketplaceAddress={getConfig().nftMarketplaceAddress}
      {...props}
    />
  </>
);

async function renderModal({ isVisible = true, onClose = vi.fn() } = {}) {
  const metamask = installMetamask({ connected: true });
  const view = renderPage(modal({ isVisible, onClose }));
  await screen.findByRole('button', { name: `1.5000 ETH · ${f.short(f.checksummed(f.STUDENT))}` });
  return { ...view, metamask, onClose };
}

const alertSpy = () => vi.spyOn(window, 'alert').mockImplementation(() => {});

const priceField = () => screen.getByPlaceholderText('Enter new price in ETH');
const updatePrice = () => screen.getByRole('button', { name: 'Update Price' });
const cancelListing = () => screen.getByRole('button', { name: 'Cancel Listing' });

const sentCalls = (metamask) => metamask.sent.map(({ to, call }) => ({ to, call }));







// -----------------------------------------------------------
// The modal
// -----------------------------------------------------------

describe('The modal', () => {

  it('shows nothing while hidden', async () => {
    await renderModal({ isVisible: false });
    expect(screen.queryByRole('heading', { name: 'Manage Listing' })).toBeNull();
  });


  it('offers a new price, cancelling the listing, and closing', async () => {
    await renderModal();
    expect(screen.getByRole('heading', { level: 2, name: 'Manage Listing' })).toBeInTheDocument();
    expect(screen.getByText('Update Listing Price (ETH)')).toBeInTheDocument();
    expect(priceField()).toHaveValue(null);
    expect(priceField()).toHaveAttribute('type', 'number');
    expect(updatePrice()).toBeInTheDocument();
    expect(cancelListing()).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
  });


  it.each(['×', 'Close'])('closes from %s without asking the wallet for anything', async (label) => {
    const { user, metamask, onClose } = await renderModal();
    await user.click(screen.getByRole('button', { name: label }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(metamask.callsTo('eth_sendTransaction')).toEqual([]);
  });


  it('names the price field for assistive tech by its label', async () => {
    await renderModal();
    expect(screen.getByLabelText('Update Listing Price (ETH)')).toBe(priceField());
  });
});







// -----------------------------------------------------------
// A new price
// -----------------------------------------------------------

describe('A new price', () => {

  it.each([
    ['left empty', null],
    ['zero', '0'],
    ['negative', '-1'],
  ])('refuses a price %s with an alert — no wallet popup', async (_, typed) => {
    const alert = alertSpy();
    const { user, metamask, onClose } = await renderModal();
    if (typed) await user.type(priceField(), typed);
    await user.click(updatePrice());
    expect(alert).toHaveBeenCalledWith(PRICE_REFUSED);
    expect(metamask.callsTo('eth_sendTransaction')).toEqual([]);
    expect(onClose).not.toHaveBeenCalled();
  });


  it('asks MetaMask to send updateListing with the price in wei, says so and closes', async () => {
    const { user, metamask, onClose } = await renderModal();
    await user.type(priceField(), '0.2');
    await user.click(updatePrice());
    expect(await toastSaying(UPDATED)).toBeInTheDocument();
    expect(sentCalls(metamask)).toEqual([{ to: f.MARKETPLACE, call: { functionName: 'updateListing', args: [f.checksummed(f.PUGS), 1n, BigInt(f.wei('0.2'))] } }]);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(sepolia.state.listings.get(`${f.PUGS}-1`).price).toBe(BigInt(f.wei('0.2')));
  });


  it('keeps the modal open with "Transaction rejected in the wallet." when the student declines', async () => {
    const { user, metamask, onClose } = await renderModal();
    metamask.decline('eth_sendTransaction');
    await user.type(priceField(), '0.2');
    await user.click(updatePrice());
    expect(await toastSaying('Transaction rejected in the wallet.')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(priceField()).toHaveValue(0.2);
  });


  it('refuses a price ether cannot hold in ethers\' own words, before any popup', async () => {
    const { user, metamask } = await renderModal();

    // Typed key by key, user-event hands a number field's tiny
    // value on as "1e-19"; a browser passes the digits as typed
    fireEvent.change(priceField(), { target: { value: '0.0000000000000000001' } });
    await user.click(updatePrice());
    expect(await toastSaying('too many decimals for format')).toBeInTheDocument();
    expect(metamask.callsTo('eth_sendTransaction')).toEqual([]);
  });


  it('sends only what the field shows after the modal was closed and opened again — the typed price goes with the closing', async () => {
    const alert = alertSpy();
    const onClose = vi.fn();
    const { user, metamask, rerender } = await renderModal({ onClose });
    await user.type(priceField(), '0.2');
    await user.click(screen.getByRole('button', { name: '×' }));
    rerender(modal({ isVisible: false, onClose }));
    rerender(modal({ isVisible: true, onClose }));

    expect(priceField()).toHaveValue(null);
    await user.click(updatePrice());
    await settle(100);
    expect(metamask.callsTo('eth_sendTransaction')).toEqual([]);
    expect(alert).toHaveBeenCalledWith(PRICE_REFUSED);
  });
});







// -----------------------------------------------------------
// Cancelling the listing
// -----------------------------------------------------------

describe('Cancelling the listing', () => {

  it('asks MetaMask to send cancelListing, says so and closes', async () => {
    const { user, metamask, onClose } = await renderModal();
    await user.click(cancelListing());
    expect(await toastSaying(CANCELLED)).toBeInTheDocument();
    expect(sentCalls(metamask)).toEqual([{ to: f.MARKETPLACE, call: { functionName: 'cancelListing', args: [f.checksummed(f.PUGS), 1n] } }]);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(sepolia.state.listings.has(`${f.PUGS}-1`)).toBe(false);
  });


  it('keeps the modal open with "Transaction rejected in the wallet." when the student declines', async () => {
    const { user, metamask, onClose } = await renderModal();
    metamask.decline('eth_sendTransaction');
    await user.click(cancelListing());
    expect(await toastSaying('Transaction rejected in the wallet.')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});
