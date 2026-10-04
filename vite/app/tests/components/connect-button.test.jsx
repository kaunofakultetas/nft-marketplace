// -----------------------------------------------------------
//  [*] Tests — ConnectButton (the whole wallet UX in one pill)
//
//  Plain wagmi against the MetaMask double, state by state:
//  no wallet in the browser (MetaMask's download page, opened
//  safely in a new tab); a wallet the site may not use yet
//  ("Connect Wallet": MetaMask's account popup — approved,
//  declined, left open, already open in another tab — and a
//  wallet that knows no permissions popup); a returning
//  student, reconnected on load without any popup, also with
//  an older wallet found only on window.ethereum; the
//  connected pill — the wallet's Sepolia balance to four
//  decimals read through the relay, the short address, nothing
//  but the address while the balance is unknown; the wrong
//  network and the one-click switch (approved or declined);
//  the student's own moves inside MetaMask (another chain,
//  another account, every account locked away); and
//  disconnecting, which revokes the site's permission so the
//  next load starts disconnected.
// -----------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { screen, act, waitFor, cleanup } from '@testing-library/react';
import { renderPage } from '../support/render';
import { given } from '../support/backend/server';
import { settle } from '../support/backend/contract';
import * as f from '../support/backend/fixtures';
import { sepolia } from '../support/chain/sepolia';
import { installMetamask, rpcError, MAINNET, SEPOLIA, hexChain } from '../support/wallets/metamask';
import ConnectButton from '@/components/ConnectButton';


const renderButton = () => renderPage(<ConnectButton />);

// The connected pill: the balance and the short address
const pillName = (balance = '1.5000', account = f.STUDENT) => `${balance} ETH · ${f.short(f.checksummed(account))}`;
const pill = (balance, account) => screen.findByRole('button', { name: pillName(balance, account) });

const connectButton = () => screen.findByRole('button', { name: 'Connect Wallet' });
const wrongNetwork = () => screen.findByRole('button', { name: 'Wrong network — switch to Sepolia' });

// The popups MetaMask opened for this site
const popups = (metamask) => metamask.methods().filter((method) => ['wallet_requestPermissions', 'eth_requestAccounts'].includes(method));







// -----------------------------------------------------------
// No wallet in the browser
// -----------------------------------------------------------

describe('No wallet in the browser', () => {

  it('links to MetaMask\'s download page, opened in a new tab that cannot reach back', () => {
    renderButton();
    const link = screen.getByRole('link', { name: 'Install MetaMask' });
    expect(link).toHaveAttribute('href', 'https://metamask.io/download/');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.queryByRole('button')).toBeNull();
  });


  it('still offers the download for a wallet that only announces itself (EIP-6963) and stays off window.ethereum', async () => {
    installMetamask({ onWindow: false });
    renderButton();
    await settle(100);
    expect(screen.getByRole('link', { name: 'Install MetaMask' })).toBeInTheDocument();
  });
});







// -----------------------------------------------------------
// Connecting
// -----------------------------------------------------------

describe('Connecting', () => {

  it('offers "Connect Wallet" for a wallet the site may not use yet — and opens no popup on its own', async () => {
    const metamask = installMetamask();
    renderButton();
    expect(await connectButton()).toBeEnabled();
    await settle(100);
    expect(popups(metamask)).toEqual([]);
  });


  it('asks MetaMask for the account once, and shows the connected pill', async () => {
    const metamask = installMetamask();
    const { user } = renderButton();
    await user.click(await connectButton());
    expect(await pill()).toHaveAttribute('title', 'Disconnect');
    expect(popups(metamask)).toEqual(['wallet_requestPermissions']);
    expect(metamask.connected).toBe(true);
  });


  it('says "Connecting…" and takes no second click while MetaMask\'s popup is open', async () => {
    const metamask = installMetamask();
    const popup = metamask.hold('wallet_requestPermissions');
    const { user } = renderButton();
    await user.click(await connectButton());

    const pending = await screen.findByRole('button', { name: 'Connecting…' });
    expect(pending).toBeDisabled();
    await act(async () => popup.release());
    expect(await pill()).toBeInTheDocument();
  });


  it('goes back to "Connect Wallet" when the student declines — nothing connected, nothing left on screen', async () => {
    const metamask = installMetamask().decline('wallet_requestPermissions');
    const { user } = renderButton();
    await user.click(await connectButton());
    expect(await connectButton()).toBeEnabled();
    expect(metamask.connected).toBe(false);
    expect(screen.queryByRole('alert')).toBeNull();
  });


  it('goes back to "Connect Wallet" when MetaMask\'s popup is already open elsewhere (-32002)', async () => {
    const metamask = installMetamask();
    metamask.hang('wallet_requestPermissions');
    const { user } = renderButton();
    await user.click(await connectButton());
    expect(await screen.findByRole('button', { name: 'Connecting…' })).toBeDisabled();

    // A second page asking meanwhile is refused by MetaMask
    await expect(metamask.provider.request({ method: 'wallet_requestPermissions', params: [{ eth_accounts: {} }] }))
      .rejects.toMatchObject({ code: -32002 });
  });


  it('connects a wallet that knows no permissions popup through eth_requestAccounts', async () => {
    const metamask = installMetamask().fail('wallet_requestPermissions', rpcError(-32601, 'The method "wallet_requestPermissions" does not exist / is not available.'));
    const { user } = renderButton();
    await user.click(await connectButton());
    expect(await pill()).toBeInTheDocument();
    expect(popups(metamask)).toEqual(['wallet_requestPermissions', 'eth_requestAccounts']);
  });
});







// -----------------------------------------------------------
// A returning student
// -----------------------------------------------------------

describe('A returning student', () => {

  it('is reconnected on load without any popup', async () => {
    const metamask = installMetamask({ connected: true });
    renderButton();
    expect(await pill()).toBeInTheDocument();
    expect(popups(metamask)).toEqual([]);
  });


  it('is reconnected through an older wallet found only on window.ethereum once connected through it before', async () => {
    const metamask = installMetamask({ announce: false });
    const first = renderButton();
    await first.user.click(await connectButton());
    await pill();

    // The next page load: a fresh wagmi, the same browser
    // storage
    cleanup();
    renderButton();
    expect(await pill()).toBeInTheDocument();
    expect(popups(metamask)).toEqual(['wallet_requestPermissions']);
  });
});







// -----------------------------------------------------------
// The connected pill
// -----------------------------------------------------------

describe('The connected pill', () => {

  it('reads the balance from Sepolia through the relay', async () => {
    installMetamask({ connected: true });
    renderButton();
    await pill();
    expect(sepolia.readsOf('getEthBalance').map((read) => read.args)).toEqual([[f.checksummed(f.STUDENT)]]);
  });


  it.each([
    ['rounds to four decimals', 1234567890123456789n, '1.2346'],
    ['shows an empty wallet as zero', 0n, '0.0000'],
    ['shows a single wei as zero', 1n, '0.0000'],
    ['keeps every whole ether', 123456789000000000000000n, '123456.7890'],
  ])('%s', async (_, wei, text) => {
    installMetamask({ connected: true });
    sepolia.setBalance(f.STUDENT, wei);
    renderButton();
    expect(await pill(text)).toBeInTheDocument();
  });


  it('shows just the address while the balance is on its way', async () => {
    given.hang('post', '/api/rpc');
    installMetamask({ connected: true });
    renderButton();
    expect(await screen.findByRole('button', { name: f.short(f.checksummed(f.STUDENT)) })).toHaveAttribute('title', 'Disconnect');
  });


  it('shows just the address when the relay cannot read the balance', async () => {
    const relayed = given.capture('post', '/api/rpc', { error: 'RPC relay failed: the RPC provider did not answer in time' }, { status: 502 });
    installMetamask({ connected: true });
    renderButton();
    await waitFor(() => expect(relayed.length).toBeGreaterThanOrEqual(4), { timeout: 5000 });
    await settle(100);
    expect(screen.getByRole('button', { name: f.short(f.checksummed(f.STUDENT)) })).toBeInTheDocument();
  });
});







// -----------------------------------------------------------
// The wrong network
// -----------------------------------------------------------

describe('The wrong network', () => {

  it('turns the pill into "Wrong network — switch to Sepolia" while MetaMask sits on another chain', async () => {
    installMetamask({ connected: true, chainId: MAINNET });
    renderButton();
    expect(await wrongNetwork()).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: pillName() })).toBeNull();
  });


  it('switches MetaMask to Sepolia in one click and shows the pill', async () => {
    const metamask = installMetamask({ connected: true, chainId: MAINNET });
    const { user } = renderButton();
    await user.click(await wrongNetwork());
    expect(await pill()).toBeInTheDocument();
    expect(metamask.callsTo('wallet_switchEthereumChain').map((call) => call.params)).toEqual([[{ chainId: hexChain(SEPOLIA) }]]);
    expect(metamask.chainId).toBe(SEPOLIA);
  });


  it('stays on "Wrong network" when the student declines the switch', async () => {
    const metamask = installMetamask({ connected: true, chainId: MAINNET }).decline('wallet_switchEthereumChain');
    const { user } = renderButton();
    await user.click(await wrongNetwork());
    await settle(100);
    expect(await wrongNetwork()).toBeInTheDocument();
    expect(metamask.chainId).toBe(MAINNET);
  });
});







// -----------------------------------------------------------
// The student's moves inside MetaMask
// -----------------------------------------------------------

describe('The student\'s moves inside MetaMask', () => {

  it('follows a chain switch made in MetaMask — away from Sepolia and back', async () => {
    const metamask = installMetamask({ connected: true });
    renderButton();
    await pill();
    act(() => metamask.changeChain(MAINNET));
    expect(await wrongNetwork()).toBeInTheDocument();
    act(() => metamask.changeChain(SEPOLIA));
    expect(await pill()).toBeInTheDocument();
  });


  it('follows an account switch — the other account\'s address and balance', async () => {
    const metamask = installMetamask({ connected: true, accounts: [f.STUDENT, f.OTHER_ACCOUNT] });
    renderButton();
    await pill();
    act(() => metamask.changeAccounts([f.OTHER_ACCOUNT]));
    expect(await pill('0.0100', f.OTHER_ACCOUNT)).toBeInTheDocument();
  });


  it('goes back to "Connect Wallet" when every account is locked away', async () => {
    const metamask = installMetamask({ connected: true });
    renderButton();
    await pill();
    act(() => metamask.changeAccounts([]));
    expect(await connectButton()).toBeInTheDocument();
  });
});







// -----------------------------------------------------------
// Disconnecting
// -----------------------------------------------------------

describe('Disconnecting', () => {

  it('disconnects from the pill — the site\'s permission revoked in MetaMask', async () => {
    const metamask = installMetamask({ connected: true });
    const { user } = renderButton();
    await user.click(await pill());
    expect(await connectButton()).toBeInTheDocument();
    expect(metamask.callsTo('wallet_revokePermissions')).toHaveLength(1);
    expect(metamask.connected).toBe(false);
  });


  it('stays disconnected on the next load', async () => {
    const metamask = installMetamask({ connected: true });
    const first = renderButton();
    await first.user.click(await pill());
    await connectButton();

    cleanup();
    renderButton();
    expect(await connectButton()).toBeInTheDocument();
    await settle(100);
    expect(screen.queryByRole('button', { name: pillName() })).toBeNull();
    expect(popups(metamask)).toEqual([]);
  });
});
