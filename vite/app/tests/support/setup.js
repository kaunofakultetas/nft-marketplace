// -----------------------------------------------------------
//  [*] Test support — the vitest setup file
//
//  Runs before every test file (test.setupFiles in
//  vite.config.js):
//
//    - jest-dom matchers (toBeInTheDocument, toBeDisabled, …)
//    - the browser API jsdom lacks that a library the app uses
//      touches: matchMedia (react-hot-toast asks whether the
//      student prefers reduced motion)
//    - the msw double of everything behind the endpoint
//      (backend/server.js): started once per file, handlers
//      reset after every test, and a request that no handler
//      answers FAILS the test — a page calling a route the
//      double does not know is exactly the kind of drift this
//      suite exists to catch
//    - the runtime config loaded before every test from the
//      double's /api/config, as main.jsx's bootstrap loads it
//      before the first render — every module below the root
//      may call getConfig() synchronously
//    - a clean slate per test: DOM, URL (back to "/"), title,
//      localStorage (where wagmi remembers a connection),
//      the toasts (react-hot-toast keeps them in a module-level
//      store), the Sepolia double's state, timers, stubbed
//      globals (the wallet double), environment variables,
//      mocks
//    - the students' time zone (Europe/Vilnius) for every
//      test — the dates the pages show are local times; a test
//      may stub another
//    - a console guard: React's own bug reports (a missing
//      key, a state update on another component while
//      rendering, an unknown DOM prop, a hook-order change)
//      fail the test that caused them; act() warnings are
//      printed but tolerated (an answer landing after the last
//      assertion is not a defect)
//
//  Nothing here reaches a real backend, chain, wallet, IPFS
//  node or the network — the whole suite is self-contained to
//  vite/app, and runTests.sh runs it with no network at all.
// -----------------------------------------------------------

import '@testing-library/jest-dom/vitest';
import { afterAll, afterEach, beforeAll, beforeEach, vi } from 'vitest';
import { cleanup, configure } from '@testing-library/react';
import toast from 'react-hot-toast';
import { server, unhandledRequests, given } from './backend/server';
import * as f from './backend/fixtures';
import { sepolia } from './chain/sepolia';
import { loadConfig } from '@/config';


// Messages console.error may carry that mean the code under
// test has a bug (not a test-timing artefact)
const FATAL_CONSOLE_PATTERNS = [
  /unique "key" prop/,
  /Cannot update a component .* while rendering a different component/,
  /Maximum update depth exceeded/,
  /React does not recognize the .* prop on a DOM element/,
  /Invalid DOM property/,
  /change in the order of Hooks/,
  /Rendered more hooks than during the previous render/,
  /Rendered fewer hooks than expected/,
  /Invalid hook call/,
  /Objects are not valid as a React child/,
];







// -----------------------------------------------------------
// Browser API polyfills
// -----------------------------------------------------------
//
// Installed once per file, before any component code runs.
// Each stub is the smallest thing that keeps the library that
// needs it from throwing.
//
// Used by:
//   - every rendered toast, implicitly
// -----------------------------------------------------------

function matchMediaStub(query) {
  return {
    matches: false,
    media: query,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() { return false; },
  };
}

// findBy*/waitFor give up after 1 s by default — too little
// for a page that waits on wagmi's reconnect, a chain read and
// an IPFS fetch on a loaded machine; nothing in the suite is
// meant to be timing-sensitive at that scale
configure({ asyncUtilTimeout: 5000 });

beforeAll(() => {
  window.matchMedia = matchMediaStub;
});







// -----------------------------------------------------------
// Backend double lifecycle
// -----------------------------------------------------------
//
// One msw server per test file: the default handlers (the
// happy path for every route the SPA reaches) come back after
// each test, so a test only ever declares the deviation it is
// about. A request no handler matched is recorded by
// backend/server.js and fails the test in afterEach — unless
// the test declared it expects one (allowUnhandledRequests).
//
// Used by:
//   - every test, implicitly
// -----------------------------------------------------------

let unhandledAllowed = false;

export function allowUnhandledRequests() {
  unhandledAllowed = true;
}

// A test that deliberately provokes one of the FATAL console
// messages declares the pattern(s) it expects — those lines
// are then not counted against it
const allowedConsoleErrors = [];

export function allowConsoleErrors(...patterns) {
  allowedConsoleErrors.push(...patterns);
}

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'bypass' });
});

afterAll(() => {
  server.close();
});







// -----------------------------------------------------------
// withConfig
// -----------------------------------------------------------
//
// Answers /api/config with the fixture changed by the test's
// fields and loads it again, as a reload of the page would
// pick up a changed compose environment — a short IPFS
// deadline, another gateway prefix.
//
// Used by:
//   - the tests of the IPFS deadline and the gateway prefix
// -----------------------------------------------------------

export async function withConfig(overrides) {
  given.json('get', '/api/config', { ...f.config(), ...overrides });
  await loadConfig();
}







// -----------------------------------------------------------
// Per-test slate
// -----------------------------------------------------------
//
// Before: the URL back at "/", an empty title, the students'
// time zone, the Sepolia double rebuilt, the runtime config
// loaded, the console guard armed. After: React trees
// unmounted, every ethers provider destroyed, handlers reset,
// storage wiped, toasts removed, real timers, stubbed
// globals, environment variables and mocks undone, vitest's
// rejection listeners back in place — then the
// unhandled-request, Sepolia-double and console verdicts,
// which come last so the cleanup has happened even when they
// fail the test.
//
// Used by:
//   - every test, implicitly
// -----------------------------------------------------------

const consoleErrors = [];
let originalConsoleError;

beforeEach(async () => {
  window.history.replaceState(null, '', '/');
  document.title = '';
  vi.stubEnv('TZ', 'Europe/Vilnius');
  sepolia.reset();
  unhandledAllowed = false;
  unhandledRequests.length = 0;
  consoleErrors.length = 0;
  allowedConsoleErrors.length = 0;
  await loadConfig();
  originalConsoleError = console.error;
  console.error = (...args) => {
    consoleErrors.push(args.map((a) => (a instanceof Error ? a.message : String(a))).join(' '));
    originalConsoleError(...args);
  };
});

afterEach(async () => {
  cleanup();
  server.resetHandlers();
  localStorage.clear();
  sessionStorage.clear();
  toast.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  console.error = originalConsoleError;

  if (unhandledRequests.length && !unhandledAllowed) {
    const list = unhandledRequests.map((r) => `${r.method} ${r.url}`).join('\n  ');
    throw new Error(`request(s) the double has no handler for — add one in tests/support/backend/handlers.js or answer it in the test:\n  ${list}`);
  }

  if (sepolia.faults.length) {
    throw new Error(`the Sepolia double failed on a request — a bug of the double, fix tests/support/chain/sepolia.js:\n  ${sepolia.faults.join('\n  ')}`);
  }

  const fatal = consoleErrors.filter((msg) =>
    FATAL_CONSOLE_PATTERNS.some((re) => re.test(msg)) && !allowedConsoleErrors.some((re) => re.test(msg)));
  if (fatal.length) {
    throw new Error(`console.error reported a defect during this test:\n  ${fatal.join('\n  ')}`);
  }
});
