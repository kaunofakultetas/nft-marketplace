// -----------------------------------------------------------
//  [*] Tests — the runtime configuration (config.js)
//
//  The bundle carries no environment: every deployment value
//  comes from GET /api/config before React mounts, and the
//  module hands it out synchronously afterwards. Pinned down
//  here: the accessor refuses to answer before the load;
//  the load keeps the marketplace address as given, resolves
//  the relay's relative path against the page's own origin
//  (wagmi's transport is handed a full URL) and leaves an
//  absolute one alone,
//  defaults the gateway prefix and the IPFS deadline — and
//  reads a deadline sent as text; it fails loudly, for
//  main.jsx's "Backend unavailable" screen, on an error
//  status, a body that is not JSON, a dropped connection and
//  an answer without an RPC URL.
//
//  Every test loads a fresh copy of the module
//  (vi.resetModules) — it keeps the config for the life of the
//  module.
// -----------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { given } from '../support/backend/server';
import { LOGIN_PAGE, LOGIN_PAGE_PARSE_ERROR, DROPPED } from '../support/backend/contract';
import * as f from '../support/backend/fixtures';


// A fresh module per test
let loadConfig;
let getConfig;

beforeEach(async () => {
  vi.resetModules();
  ({ loadConfig, getConfig } = await import('@/config'));
});

const answer = (fields) => given.json('get', '/api/config', { ...f.config(), ...fields });







// -----------------------------------------------------------
// Before the load
// -----------------------------------------------------------

describe('before the load', () => {

  it('refuses to answer before loadConfig() has run', () => {
    expect(() => getConfig()).toThrow(new Error('getConfig() called before loadConfig()'));
  });


  it('still refuses after a load that failed', async () => {
    given.empty('get', '/api/config', 502);
    await expect(loadConfig()).rejects.toThrow();
    expect(() => getConfig()).toThrow(new Error('getConfig() called before loadConfig()'));
  });
});







// -----------------------------------------------------------
// What the load keeps
// -----------------------------------------------------------

describe('what the load keeps', () => {

  it('hands out the backend\'s values — the relay made absolute on the page\'s origin — and returns them too', async () => {
    const loaded = await loadConfig();
    const expected = {
      nftMarketplaceAddress: f.checksummed(f.MARKETPLACE),
      rpcUrl: 'http://localhost:3000/api/rpc',
      ipfsGateway: '/ipfs/',
      ipfsTimeout: 10000,
    };
    expect(loaded).toEqual(expected);
    expect(getConfig()).toEqual(expected);
  });


  it('keeps an absolute RPC URL as it is', async () => {
    answer({ rpcUrl: 'https://rpc.sepolia.example.org/v1' });
    expect((await loadConfig()).rpcUrl).toBe('https://rpc.sepolia.example.org/v1');
  });


  it('keeps only the four values the GUI uses', async () => {
    answer({ etherscanApiKey: 'never-in-the-browser', debug: true });
    expect(Object.keys(await loadConfig()).sort()).toEqual(['ipfsGateway', 'ipfsTimeout', 'nftMarketplaceAddress', 'rpcUrl']);
  });


  it.each([
    ['missing', undefined],
    ['empty', ''],
  ])('defaults the gateway prefix to /ipfs/ when the backend\'s is %s', async (_, value) => {
    answer({ ipfsGateway: value });
    expect((await loadConfig()).ipfsGateway).toBe('/ipfs/');
  });


  it.each([
    ['a number', 2500, 2500],
    ['text holding a number', '2500', 2500],
    ['text with a unit after the number', '2500ms', 2500],
    ['missing', undefined, 10000],
    ['empty', '', 10000],
    ['not a number at all', 'soon', 10000],
    ['zero', 0, 10000],
  ])('reads an IPFS deadline that is %s', async (_, value, expected) => {
    answer({ ipfsTimeout: value });
    expect((await loadConfig()).ipfsTimeout).toBe(expected);
  });


  it('replaces the values of an earlier load', async () => {
    await loadConfig();
    answer({ ipfsGateway: '/archive/ipfs/' });
    await loadConfig();
    expect(getConfig().ipfsGateway).toBe('/archive/ipfs/');
  });


  it.each([
    ['missing', undefined],
    ['empty', ''],
  ])('refuses a config whose RPC URL is %s, rather than send every chain read to a path on this origin', async (_, value) => {
    answer({ rpcUrl: value });
    await expect(loadConfig()).rejects.toThrow('GET /api/config answered without an rpcUrl');
  });
});







// -----------------------------------------------------------
// Failed loads
// -----------------------------------------------------------
//
// Each throws, so main.jsx can show the reason on its
// "Backend unavailable" screen.
// -----------------------------------------------------------

describe('failed loads', () => {

  it.each([
    ['the endpoint\'s empty 502 (the backend container is down)', () => given.empty('get', '/api/config', 502), 502],
    ['a failure that carries the backend\'s sentence — it is not read', () => given.error('get', '/api/config', 'Missing required environment variables', 500), 500],
    ['the login app\'s 401', () => given.html('get', '/api/config', 401, LOGIN_PAGE), 401],
  ])('throws "GET /api/config failed: HTTP <status>" for %s', async (_, respond, status) => {
    respond();
    await expect(loadConfig()).rejects.toThrow(new Error(`GET /api/config failed: HTTP ${status}`));
  });


  it('throws JSON.parse\'s error for the login page served with a 200', async () => {
    given.html('get', '/api/config', 200, LOGIN_PAGE);
    await expect(loadConfig()).rejects.toThrow(new SyntaxError(LOGIN_PAGE_PARSE_ERROR));
  });


  it('throws fetch\'s own error for a dropped connection', async () => {
    given.networkError('get', '/api/config');
    await expect(loadConfig()).rejects.toMatchObject({ name: 'TypeError', message: DROPPED });
  });


  it('throws for a JSON null — there are no values to read', async () => {
    given.json('get', '/api/config', null);
    await expect(loadConfig()).rejects.toThrow(TypeError);
  });
});
