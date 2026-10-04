// -----------------------------------------------------------
//  [*] Test support — the backend contract matrix
//
//  What a page must survive from its backend. For one endpoint
//  the page consumes, describeEndpointContract() generates a
//  test per response VARIANT — every way the answer can be
//  broken, wrong, late or missing:
//
//    failures (the backend's error answers carrying its own
//    sentence, Flask's HTML error page, the endpoint's empty
//    502 while the backend container is down, a dropped
//    connection, the password gate's login page where JSON
//    should be) — each must reach the screen the way THIS
//    page presents a failure (the `failed` callback: an error
//    box, a notice, a dash …), its own chrome still standing,
//    nothing crashing
//
//    modified bodies (an empty body, null, a string, a number,
//    the wrong container, an object where the list inside the
//    answer should be, every field missing, every leaf null,
//    types swapped, extra fields, a huge list, hostile
//    unicode/markup in every string) — the page must not
//    crash, also not once it has done what the answer leads
//    it to (the chain reads and IPFS fetches of the tokens it
//    names): no render error, its chrome still there, and
//    markup in a string rendered as text, never as elements
//
//    timing (a hang, a slow answer) — the loading state must
//    hold, then the data must land
//
//  A page test calls it once per endpoint, with the render and
//  the assertions that page understands; the variants a page
//  cannot meet are pinned with `pins` (it.fails, with a short
//  bug description) so the suite stays green while the defect
//  is on record.
//
//  Used by:
//    - page tests (tests/pages/*)
// -----------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { screen, waitFor, act } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server, url, apiError } from './server';


// What the hostile-string variant puts in every string field
export const HOSTILE_STRING = '💾 Ąžuolas <script>alert(1)</script> <img src=x onerror=alert(2)> {placeholder} \u0000';

// Flask's own page for an exception a route did not catch
export const FLASK_500_PAGE = '<!doctype html>\n<html lang=en>\n<title>500 Internal Server Error</title>\n<h1>Internal Server Error</h1>\n<p>The server encountered an internal error and was unable to complete your request. Either the server is overloaded or there is an error in the application.</p>\n';

// What the endpoint serves for any path once the password
// cookie is gone — the login app's page — and what JSON.parse
// says about it
export const LOGIN_PAGE = '<!doctype html>\n<html lang="en">\n  <head><title>NFT Marketplace</title></head>\n  <body><div id="root"></div></body>\n</html>\n';
export const LOGIN_PAGE_PARSE_ERROR = 'Unexpected token \'<\', "<!doctype "... is not valid JSON';

// What a fetch() over a dropped connection rejects with
export const DROPPED = 'Failed to fetch';

// apiGet's own sentence for a failure that carried none
export const httpFailure = (path, status) => `GET ${path} failed: HTTP ${status}`;







// -----------------------------------------------------------
// Body mutators
// -----------------------------------------------------------
//
// Pure transforms of a fixture body into a "modified" one.
// They walk arrays and plain objects; leaves are replaced
// according to the variant.
//
// Used by:
//   - VARIANTS (below), tests that build their own variants
// -----------------------------------------------------------

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

const mapLeaves = (value, fn) => {
  if (Array.isArray(value)) return value.map((v) => mapLeaves(v, fn));
  if (isPlainObject(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, mapLeaves(v, fn)]));
  return fn(value);
};

export const nullLeaves = (body) => mapLeaves(body, () => null);

export const swapTypes = (body) => mapLeaves(body, (v) => {
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') return v === '' ? 0 : 12345;
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return v;
});

export const hostileStrings = (body) => mapLeaves(body, (v) => (typeof v === 'string' ? HOSTILE_STRING : v));

export const withExtraFields = (body) => {
  const add = (o) => (isPlainObject(o) ? { ...o, extra_field: { deep: [1, 2, { x: null }] }, another: 'unexpected' } : o);
  if (Array.isArray(body)) return body.map(add);
  return add(body);
};

export const missingFields = (body) => (Array.isArray(body) ? body.map(() => ({})) : {});

export const wrongContainer = (body) => (Array.isArray(body) ? {} : []);

// The first list inside an object answer turned into an object
// of its rows — the answer still parses and the field is still
// there, but it is no list
export const objectForTheList = (body) => {
  if (!isPlainObject(body)) return body;
  const key = Object.keys(body).find((k) => Array.isArray(body[k]));
  return key ? { ...body, [key]: { ...body[key] } } : body;
};

// The first list in the body (the body itself, or a field such
// as `listings` / `activity`) grown to n entries
export const hugeList = (body, n = 300) => {
  const grow = (list) => Array.from({ length: n }, (_, i) => {
    const row = list[i % list.length];
    return isPlainObject(row) ? { ...row } : row;
  });
  if (Array.isArray(body)) return body.length ? grow(body) : body;
  if (!isPlainObject(body)) return body;
  const key = Object.keys(body).find((k) => Array.isArray(body[k]) && body[k].length);
  return key ? { ...body, [key]: grow(body[key]) } : body;
};







// -----------------------------------------------------------
// VARIANTS
// -----------------------------------------------------------
//
// Every generated test: its name, the msw response it builds
// from a copy of the fixture, and what the page must do with
// that answer — 'failed' (show the failure), 'survives'
// (stand without crashing), 'hostile' (stand, with markup
// rendered as text), 'loading' (hold its loading state) or
// 'loaded' (show the data). A failure variant also knows the
// message utils/api.js makes of it for the path the page
// asked: the backend's sentence when the answer carried one,
// apiGet's own "failed: HTTP" sentence for an answer that
// carried none, the browser's words for a dropped connection,
// JSON.parse's for a page that is not JSON.
//
// Used by:
//   - describeEndpointContract (below)
// -----------------------------------------------------------

const jsonResponse = (body, status = 200) => HttpResponse.json(body, { status });
const htmlResponse = (body, status) => new HttpResponse(body, { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } });

export const VARIANTS = [
  { name: '500 { error } → the failure is shown', respond: () => jsonResponse(apiError('Internal server error'), 500), expect: 'failed', says: () => 'Internal server error' },
  { name: '502 { error } → the failure is shown', respond: () => jsonResponse(apiError('Etherscan request failed: Etherscan answered HTTP 503'), 502), expect: 'failed', says: () => 'Etherscan request failed: Etherscan answered HTTP 503' },
  { name: '404 { error } → the failure is shown', respond: () => jsonResponse(apiError('Not found'), 404), expect: 'failed', says: () => 'Not found' },
  { name: 'Flask\'s HTML error page (500) → the failure is shown', respond: () => htmlResponse(FLASK_500_PAGE, 500), expect: 'failed', says: (path) => httpFailure(path, 500) },
  { name: 'an empty 502 from the endpoint (the backend container is down) → the failure is shown', respond: () => new HttpResponse(null, { status: 502 }), expect: 'failed', says: (path) => httpFailure(path, 502) },
  { name: 'connection dropped → the failure is shown', respond: () => HttpResponse.error(), expect: 'failed', says: () => DROPPED },
  { name: 'the login page instead of JSON (200 text/html — the password cookie is gone) → the failure is shown', respond: () => htmlResponse(LOGIN_PAGE, 200), expect: 'failed', says: () => LOGIN_PAGE_PARSE_ERROR },
  { name: 'empty 200 body → page survives', respond: () => new HttpResponse(null, { status: 200 }), expect: 'survives' },
  { name: 'JSON null → page survives', respond: () => jsonResponse(null), expect: 'survives' },
  { name: 'a JSON string → page survives', respond: () => jsonResponse('unexpected'), expect: 'survives' },
  { name: 'a JSON number → page survives', respond: () => jsonResponse(42), expect: 'survives' },
  { name: 'wrong container (object for a list, list for an object) → page survives', respond: (fx) => jsonResponse(wrongContainer(fx)), expect: 'survives' },
  { name: 'an object where the answer\'s list should be → page survives', respond: (fx) => jsonResponse(objectForTheList(fx)), expect: 'survives' },
  { name: 'every field missing → page survives', respond: (fx) => jsonResponse(missingFields(fx)), expect: 'survives' },
  { name: 'every leaf null → page survives', respond: (fx) => jsonResponse(nullLeaves(fx)), expect: 'survives' },
  { name: 'types swapped (numbers as strings, strings as numbers) → page survives', respond: (fx) => jsonResponse(swapTypes(fx)), expect: 'survives' },
  { name: 'unknown extra fields → page survives and still shows the data', respond: (fx) => jsonResponse(withExtraFields(fx)), expect: 'loaded' },
  { name: 'a huge list (300 entries) → page survives', respond: (fx) => jsonResponse(hugeList(fx)), expect: 'survives' },
  { name: 'hostile strings (unicode + markup) → rendered as text, never as elements', respond: (fx) => jsonResponse(hostileStrings(fx)), expect: 'hostile' },
  { name: 'a hanging request → the loading state holds, nothing crashes', respond: () => new Promise(() => {}), expect: 'loading' },
  { name: 'a slow answer (200 ms) → the data lands', respond: async (fx) => { await new Promise((r) => setTimeout(r, 200)); return jsonResponse(fx); }, expect: 'loaded' },
];

// The names of the variants of one kind — for `only`
export const variantNames = (kind) => VARIANTS.filter((variant) => variant.expect === kind).map((variant) => variant.name);







// -----------------------------------------------------------
// describeEndpointContract
// -----------------------------------------------------------
//
// Generates the matrix for one endpoint: a describe block
// named after its method and path, one test per variant. The
// page test names the endpoint by its msw path and method (a
// GET unless it says otherwise) and hands over the happy
// body, of which every variant gets a fresh copy; the rest is
// what this page understands.
//
// `render` mounts the page; it may be async — an endpoint the
// page calls only after a click renders and clicks there, and
// is awaited. `chrome` runs after every variant: the page must
// still show its own frame. `loaded` is awaited for the
// variants that end with data on screen, `failed` for the
// failure variants — handed the message the variant's answer
// becomes for the path the page asked (see VARIANTS), for a
// page that says what went wrong to assert exactly that; a
// page with no visible failure state asserts what it shows
// instead — and the optional `loading` must hold while the
// request hangs. `only` narrows the run to the variants it
// names; `skip` and `pins` map a variant's name to a reason —
// a skipped variant is listed with its reason, a pinned one
// runs as it.fails with the bug in its title.
//
// Used by:
//   - page tests
// -----------------------------------------------------------

export function describeEndpointContract({ path, method = 'get', fixture, render, chrome, loaded, failed, loading, only, skip = {}, pins = {} }) {

  const variants = only ? VARIANTS.filter((v) => only.includes(v.name)) : VARIANTS;

  describe(`backend contract — ${method.toUpperCase()} ${path}`, () => {

    for (const variant of variants) {
      if (variant.name in skip) {
        it.skip(`${variant.name} (skipped: ${skip[variant.name]})`, () => {});
        continue;
      }

      const runner = variant.name in pins ? it.fails : it;
      const title = variant.name in pins ? `${variant.name} — PINNED KNOWN BUG: ${pins[variant.name]}` : variant.name;

      runner(title, async () => {
        let requested = null;
        server.use(http[method](url(path), async ({ request }) => {
          const asked = new URL(request.url);
          requested = asked.pathname + asked.search;
          return variant.respond(structuredClone(fixture));
        }));

        await render();

        if (variant.expect === 'loading') {
          // The request is in flight and stays so: the page must
          // show its loading state (when it has one) and nothing
          // else
          await waitFor(() => expect(requested).not.toBeNull());
          await settle();
          if (loading) await waitFor(() => expect(loading()).toBeTruthy());
          expectNoCrash();
          if (chrome) expect(chrome()).toBeTruthy();
          return;
        }

        if (variant.expect === 'failed') {
          await waitFor(() => expect(requested).not.toBeNull());
          await failed(variant.says(requested));
          expectNoCrash();
          if (chrome) expect(chrome()).toBeTruthy();
          return;
        }

        if (variant.expect === 'loaded') {
          await loaded();
          expectNoCrash();
          if (chrome) expect(chrome()).toBeTruthy();
          return;
        }

        // 'survives' and 'hostile': the answer must have landed
        // and the page taken it in — its frame up, or a crash —
        // then had time for what the answer leads it to do (the
        // chain reads and IPFS fetches of the tokens it names);
        // then it must simply still stand
        await waitFor(() => expect(requested).not.toBeNull());
        if (chrome) await waitFor(() => expect(screen.queryByTestId('render-crashed') || chrome()).toBeTruthy());
        await settle(300);
        expectNoCrash();
        if (chrome) expect(chrome()).toBeTruthy();
        if (variant.expect === 'hostile') {
          expect(document.querySelector('script')).toBeNull();
          expect(document.querySelector('img[src="x"]')).toBeNull();
        }
      });
    }
  });
}







// -----------------------------------------------------------
// settle / expectNoCrash
// -----------------------------------------------------------
//
// settle lets React flush the state updates an answered
// request triggers (a wait of a few macrotasks inside act —
// 30 ms unless the caller names another — so the updates are
// not reported as un-acted); expectNoCrash checks that the
// test net of renderPage / renderApp (data-testid
// render-crashed) never fired, and fails with its message
// when it did.
//
// Used by:
//   - describeEndpointContract (above), page tests, the route
//     sweep
// -----------------------------------------------------------

export async function settle(ms = 30) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

export function expectNoCrash() {
  const crashed = screen.queryByTestId('render-crashed');
  if (crashed) throw new Error(crashed.textContent);
}
