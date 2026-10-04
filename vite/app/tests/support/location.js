// -----------------------------------------------------------
//  [*] Test support — the origin and the window.location double
//
//  jsdom's origin is pinned (vitest's default,
//  http://localhost:3000): the SPA's relative "/api/…" and
//  "/ipfs/…" requests resolve against it, config.js turns the
//  backend's relative RPC relay path into an absolute URL on
//  it, and the msw handlers listen on it (TEST_ORIGIN).
//
//  Routing needs no double: App.jsx runs its own
//  BrowserRouter, which jsdom supports through the History API
//  — tests set the start path with history.replaceState (see
//  render.jsx renderApp). What jsdom cannot do is a HARD
//  navigation: window.location.reload() logs "Not implemented"
//  and does nothing. The one place the app reloads — the
//  "Backend unavailable" screen's Retry button in main.jsx —
//  is tested with the installLocationDouble helper below,
//  which swaps the global `location` for a plain object that
//  COUNTS reloads instead.
//
//  Used by:
//    - backend/server.js, backend/handlers.js — TEST_ORIGIN
//    - wallets/metamask.js — the origin MetaMask names in its
//      "already pending" refusal
//    - core/bootstrap.test.jsx — installLocationDouble
// -----------------------------------------------------------

import { vi } from 'vitest';


export const TEST_ORIGIN = 'http://localhost:3000';







// -----------------------------------------------------------
// installLocationDouble
// -----------------------------------------------------------
//
// Replaces the global `location` (vi.stubGlobal — undone by
// setup.js' vi.unstubAllGlobals after the test) with a double
// at `path`: href / origin / pathname / search / hash read
// like the real thing, reload() is counted in `reloads`, and
// assigning href records the target in `navigations` instead
// of navigating. Meant for code that runs without App's
// BrowserRouter — main.jsx's "Backend unavailable" screen:
// under a router the router would read the double too
// (vitest's jsdom makes document.defaultView the global), so
// install it before such code renders and do not navigate
// afterwards.
//
// Used by:
//   - core/bootstrap.test.jsx
// -----------------------------------------------------------

export function installLocationDouble(path = '/') {
  const state = { url: new URL(path, TEST_ORIGIN) };
  const double = {
    navigations: [],
    reloads: 0,
    get href() { return state.url.href; },
    set href(value) {
      double.navigations.push(String(value));
      state.url = new URL(String(value), state.url);
    },
    get origin() { return state.url.origin; },
    get protocol() { return state.url.protocol; },
    get host() { return state.url.host; },
    get pathname() { return state.url.pathname; },
    get search() { return state.url.search; },
    get hash() { return state.url.hash; },
    assign(value) { double.href = value; },
    replace(value) { double.href = value; },
    reload() { double.reloads += 1; },
    toString() { return state.url.href; },
  };
  vi.stubGlobal('location', double);
  return double;
}
