// -----------------------------------------------------------
//  [*] Tests — the route sweep (every route × every backend state)
//
//  Every route of App.jsx, with a real token for the detail
//  page, rendered through the real App (renderApp) for a
//  returning student, under the conditions every page must
//  tolerate whatever it does inside:
//
//    - the default backend — the route renders its page and
//      makes only requests the doubles know (setup.js fails
//      the test on any other); its new-tab links carry
//      rel=noopener, its images an alt
//    - every backend GET answering 500 with the backend's
//      error body — the page shows ITS failure where it has
//      one (My NFTs says the backend's sentence), otherwise
//      simply still stands; nothing crashes
//    - every backend GET answering a JSON string — an answer
//      of the wrong shape: nothing crashes
//    - every backend GET dropping the connection — like the
//      500, in the browser's words
//    - the RPC relay down — every chain read failing: nothing
//      crashes
//
//  In every state the header and the footer stand — App.jsx
//  has no error boundary of its own, so a crashing page takes
//  them down with it, and the student is left with a blank
//  page. The per-page tests cover behaviour; this file is the
//  safety net no route can be forgotten by — its first test
//  checks it covers every route App.jsx declares.
// -----------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { HttpResponse } from 'msw';
import { renderApp } from '../support/render';
import { apiError, given } from '../support/backend/server';
import { expectNoCrash, settle, DROPPED } from '../support/backend/contract';
import { backendIdle, everyGet } from '../support/shell/requests';
import { appRoutes } from '../support/shell/source';
import * as f from '../support/backend/fixtures';
import { installMetamask } from '../support/wallets/metamask';


// The sentence every failing GET carries in the 500 mode
const MESSAGE = 'Internal server error';

const main = () => screen.getByRole('main');

// What shows a route rendered, and how it shows a failure
const heading = (name) => () => within(main()).findByRole('heading', { level: 1, name });
const text = (words) => () => within(main()).findByText(words);







// -----------------------------------------------------------
// ROUTES
// -----------------------------------------------------------
//
// Every route to sweep:
//
//   path    — where the student starts
//   shows   — finds what proves the page rendered
//   failed  — given the failure's message, finds how the page
//             presents a failed read — what went wrong, in so
//             many words; the message is the backend's sentence
//             (500 mode) or the browser's (connection dropped).
//             None: the page has no failure presentation of its
//             own (its page tests pin what it shows instead) —
//             it simply still shows
// -----------------------------------------------------------

const ROUTES = [
  { path: '/', shows: heading('NFTs For Sale') },
  { path: '/my-nfts', shows: heading('My NFTs'), failed: (message) => text(`Error: ${message}`)() },
  { path: '/sell-nft', shows: heading('Sell your NFT') },
  { path: '/history', shows: heading('Marketplace Activity') },
  { path: '/about', shows: heading('About this marketplace') },
  { path: `/nft/${f.PUGS}/0`, shows: heading('PUG') },
];

// The route × state combinations that fail today, each with
// what breaks — run as it.fails so the suite stays green
// while the defect is on record
const PINS = {
  '/ × JSON string': 'the stats bar crashes the storefront on stats without a volume — ethers.formatUnits(undefined)',
  '/about × JSON string': 'the instance facts crash the page on stats without a volume — ethers.formatUnits(undefined)',
};







// -----------------------------------------------------------
// Assertions shared by the states
// -----------------------------------------------------------

// The chrome around every page: the header's navigation and
// the footer
const expectChrome = () => {
  expect(screen.getByRole('navigation')).toBeInTheDocument();
  expect(screen.getByRole('contentinfo')).toBeInTheDocument();
};

// New-tab links cannot reach back into the marketplace,
// images say what they are (or that they are decoration)
const expectSafeMarkup = () => {
  for (const link of document.querySelectorAll('a[target="_blank"]')) {
    expect(link.getAttribute('rel') ?? '', link.getAttribute('href')).toMatch(/\bnoopener\b/);
  }
  for (const image of document.querySelectorAll('img')) {
    expect(image.hasAttribute('alt'), image.getAttribute('src')).toBe(true);
  }
};

// A failure mode: every GET answers `respond`; the route is
// rendered for the returning student and the backend let go
// idle
const renderFailing = async (path, respond) => {
  const gets = everyGet(respond);
  installMetamask({ connected: true });
  renderApp({ route: path });
  await backendIdle(gets);
  return gets;
};

// What a failed read looks like on this route: its own
// presentation, or the page simply still there
const expectFailureShown = async (route, message) => {
  expect(await (route.failed ? route.failed(message) : route.shows())).toBeInTheDocument();
};







// -----------------------------------------------------------
// The sweep
// -----------------------------------------------------------

describe('route sweep', () => {

  it('covers every route App.jsx declares', () => {
    const swept = ROUTES.map((route) => route.path);
    const uncovered = appRoutes()
      .filter((route) => route.element)
      .filter((route) => !swept.some((path) => new RegExp(`^${route.path.replace(/:\w+/g, '[^/]+')}$`).test(path)))
      .map((route) => route.path);
    expect(uncovered).toEqual([]);
  });


  describe.each(ROUTES)('$path', (route) => {

    const runner = (state) => (PINS[`${route.path} × ${state}`] ? it.fails : it);
    const named = (state, name) => (PINS[`${route.path} × ${state}`] ? `${name} — PINNED KNOWN BUG: ${PINS[`${route.path} × ${state}`]}` : name);


    runner('default')(named('default', 'renders under the default backend and asks only what the doubles know'), async () => {
      installMetamask({ connected: true });
      renderApp({ route: route.path });
      expect(await route.shows()).toBeInTheDocument();
      await settle(300);
      expect(window.location.pathname).toBe(route.path);
      expectNoCrash();
      expectChrome();
      expectSafeMarkup();
    });


    runner('500')(named('500', 'shows the failure, not a crash, when every GET answers 500 { error }'), async () => {
      await renderFailing(route.path, () => HttpResponse.json(apiError(MESSAGE), { status: 500 }));
      await expectFailureShown(route, MESSAGE);
      expectNoCrash();
      expectChrome();
    });


    runner('JSON string')(named('JSON string', 'survives every GET answering a JSON string'), async () => {
      await renderFailing(route.path, () => HttpResponse.json('unexpected answer'));
      await settle(300);
      expectNoCrash();
      expectChrome();
      expect(await route.shows()).toBeInTheDocument();
    });


    runner('dropped')(named('dropped', 'shows the failure, not a crash, when every GET drops the connection'), async () => {
      await renderFailing(route.path, () => HttpResponse.error());
      await expectFailureShown(route, DROPPED);
      expectNoCrash();
      expectChrome();
    });


    // The detail page's title is the token's name, read through
    // the chain — with the relay down it names the token by its
    // id instead; any title will do here
    runner('relay down')(named('relay down', 'survives every chain read failing at the RPC relay'), async () => {
      given.json('post', '/api/rpc', apiError('RPC relay failed: Read timed out.'), { status: 502 });
      installMetamask({ connected: true });
      renderApp({ route: route.path });
      expect(await within(main()).findByRole('heading', { level: 1 })).toBeInTheDocument();
      await settle(1500);
      await waitFor(() => expectChrome());
      expectNoCrash();
    });
  });
});
