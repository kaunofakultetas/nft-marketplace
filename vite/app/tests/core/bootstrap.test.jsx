// -----------------------------------------------------------
//  [*] Tests — the entry point (main.jsx)
//
//  Startup is two steps: GET /api/config, then the provider
//  stack built FROM those values around <App />. Pinned down
//  here with the real module, imported fresh into a page with
//  its #root: nothing renders while the config is in flight;
//  once it lands the whole app stands — header, routed page,
//  footer — and wagmi reads the chain through the relay the
//  config names, not through any URL of its own; when the
//  config cannot be loaded (the backend container down, a
//  dropped connection, the password gate's login page where
//  JSON should be) the "Backend unavailable" screen says why,
//  and its Retry button reloads the page.
//
//  main.jsx runs on import and keeps its React root to itself;
//  the createRoot of react-dom/client is wrapped here so every
//  root it creates is unmounted after its test.
// -----------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http } from 'msw';
import { server, given, url } from '../support/backend/server';
import { settle, LOGIN_PAGE, LOGIN_PAGE_PARSE_ERROR, DROPPED } from '../support/backend/contract';
import { installLocationDouble } from '../support/location';
import { watchRequests } from '../support/shell/requests';
import { sepolia } from '../support/chain/sepolia';
import { installMetamask } from '../support/wallets/metamask';
import * as f from '../support/backend/fixtures';


// Every root main.jsx creates, unmounted after its test
const { roots } = vi.hoisted(() => ({ roots: [] }));

vi.mock('react-dom/client', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    createRoot: (...args) => {
      const root = actual.createRoot(...args);
      roots.push(root);
      return root;
    },
  };
});


beforeEach(() => {
  vi.resetModules();
  document.body.innerHTML = '<div id="root"></div>';
});

afterEach(() => {
  act(() => {
    for (const root of roots.splice(0)) root.unmount();
  });
});

// The page loading the bundle: main.jsx runs as it is imported
const boot = () => import('@/main');

const rootElement = () => document.getElementById('root');







// -----------------------------------------------------------
// Startup
// -----------------------------------------------------------

describe('startup', () => {

  it('renders nothing while the runtime config is in flight', async () => {
    given.hang('get', '/api/config');
    await boot();
    await settle(100);
    expect(rootElement()).toBeEmptyDOMElement();
  });


  it('mounts the whole app once the config is in — header, routed page, footer', async () => {
    await boot();
    expect(await screen.findByRole('heading', { level: 1, name: 'NFT Marketplace' })).toBeInTheDocument();
    expect(await screen.findByText('Please connect your wallet to browse the marketplace')).toBeInTheDocument();
    expect(screen.getByRole('contentinfo')).toHaveTextContent('Copyright © | All Rights Reserved | VUKnF');
    expect(screen.queryByText('Backend unavailable')).toBeNull();
  });


  it('reads the chain through the relay the config names — and only there', async () => {
    given.json('get', '/api/config', { ...f.config(), rpcUrl: '/api/rpc-elsewhere' });
    const relayed = [];
    server.use(http.post(url('/api/rpc-elsewhere'), async (info) => {
      relayed.push(info.request.url);
      return sepolia.relay(info);
    }));
    const defaultRelay = watchRequests('/api/rpc');
    installMetamask({ connected: true });

    await boot();
    expect(await screen.findByRole('button', { name: `1.5000 ETH · ${f.short(f.checksummed(f.STUDENT))}` })).toBeInTheDocument();
    expect(relayed.length).toBeGreaterThan(0);
    expect(defaultRelay).toEqual([]);
  });
});







// -----------------------------------------------------------
// The "Backend unavailable" screen
// -----------------------------------------------------------

describe('the "Backend unavailable" screen', () => {

  it.each([
    ['the backend container is down (an empty 502)', () => given.empty('get', '/api/config', 502), 'GET /api/config failed: HTTP 502'],
    ['the connection drops', () => given.networkError('get', '/api/config'), DROPPED],
    ['the password gate serves its login page', () => given.html('get', '/api/config', 200, LOGIN_PAGE), LOGIN_PAGE_PARSE_ERROR],
  ])('says the backend is unavailable, and why, when %s — the app never mounts', async (_, respond, reason) => {
    respond();
    await boot();
    expect(await screen.findByText('Backend unavailable')).toBeInTheDocument();
    expect(rootElement()).toHaveTextContent('Could not load the runtime configuration from /api/config.');
    expect(screen.getByText(reason)).toBeInTheDocument();
    expect(screen.queryByRole('navigation')).toBeNull();
  });


  it('reloads the page from its Retry button', async () => {
    const location = installLocationDouble('/my-nfts');
    given.empty('get', '/api/config', 502);
    await boot();
    await userEvent.click(await screen.findByRole('button', { name: 'Retry' }));
    expect(location.reloads).toBe(1);
  });
});
