// -----------------------------------------------------------
//  [*] Tests — ConnectPrompt
//
//  The one "connect your wallet" card every gated page shows:
//  the faculty logo (decoration), the page's own message, and
//  the real ConnectButton, so the student can act right where
//  they are told to — it follows the wallet's state like the
//  header's does.
// -----------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderPage } from '../support/render';
import { installMetamask } from '../support/wallets/metamask';
import ConnectPrompt from '@/components/ConnectPrompt';


const MESSAGE = 'Please connect your wallet to view your NFTs';







// -----------------------------------------------------------
// ConnectPrompt
// -----------------------------------------------------------
//
// The gate every wallet-bound page shows: its message beside
// the logo, and the wallet button in whichever state the
// browser's wallet calls for.
// -----------------------------------------------------------

describe('ConnectPrompt', () => {

  it('shows the page\'s message next to the faculty logo, which is decoration', () => {
    renderPage(<ConnectPrompt message={MESSAGE} />);
    expect(screen.getByText(MESSAGE)).toBeInTheDocument();
    expect(document.querySelector('img')).toHaveAttribute('src', '/img/logo_knf.png');
    expect(document.querySelector('img')).toHaveAttribute('alt', '');
  });


  it('offers MetaMask\'s download page when the browser has no wallet', () => {
    renderPage(<ConnectPrompt message={MESSAGE} />);
    expect(screen.getByRole('link', { name: 'Install MetaMask' })).toHaveAttribute('href', 'https://metamask.io/download/');
  });


  it('offers to connect when the browser has a wallet', async () => {
    installMetamask();
    renderPage(<ConnectPrompt message={MESSAGE} />);
    expect(await screen.findByRole('button', { name: 'Connect Wallet' })).toBeEnabled();
  });
});
