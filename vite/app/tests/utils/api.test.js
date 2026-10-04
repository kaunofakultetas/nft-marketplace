// -----------------------------------------------------------
//  [*] Tests — the backend API helper (utils/api.js)
//
//  apiGet is every page's read: fetch() on the page's own
//  origin, a status check, the JSON parsed. A failure surfaces
//  as the backend's own sentence when its {"error"} body
//  carries one, otherwise as "GET <path> failed: HTTP <status>"
//  — Flask's HTML error page, the endpoint's empty 502 while
//  the backend container is down, a JSON body with no
//  sentence. What it does NOT guard against is passed on as
//  the platform raises it: a dropped connection, and a 200
//  that is not JSON — the password gate's login page served
//  where JSON should be, an empty body.
// -----------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { given, url } from '../support/backend/server';
import { FLASK_500_PAGE, LOGIN_PAGE, LOGIN_PAGE_PARSE_ERROR, DROPPED } from '../support/backend/contract';
import * as f from '../support/backend/fixtures';
import { apiGet } from '@/utils/api';







// -----------------------------------------------------------
// Successful answers
// -----------------------------------------------------------

describe('apiGet — successful answers', () => {

  it('returns the parsed JSON of the answer', async () => {
    expect(await apiGet('/api/listings')).toEqual(f.listings());
  });


  it('asks exactly the path it is given, query and all, on the page\'s own origin', async () => {
    const calls = given.capture('get', '/api/activity', f.activity());
    await apiGet('/api/activity?limit=100');
    expect(calls.map((call) => call.url)).toEqual([url('/api/activity?limit=100')]);
  });


  it('returns a JSON null as it is', async () => {
    given.json('get', '/api/stats', null);
    expect(await apiGet('/api/stats')).toBeNull();
  });
});







// -----------------------------------------------------------
// Failures
// -----------------------------------------------------------

describe('apiGet — failures', () => {

  it('throws the backend\'s own sentence when the failure carries one', async () => {
    given.error('get', '/api/my-nfts/:wallet', 'Etherscan request failed: 503 Server Error', 502);
    await expect(apiGet(`/api/my-nfts/${f.STUDENT}`)).rejects.toThrow(new Error('Etherscan request failed: 503 Server Error'));
  });


  it.each([
    ['Flask\'s HTML error page', () => given.html('get', '/api/stats', 500, FLASK_500_PAGE), 500],
    ['the endpoint\'s empty 502 (the backend container is down)', () => given.empty('get', '/api/stats', 502), 502],
    ['a JSON failure without an error field', () => given.json('get', '/api/stats', { message: 'busy' }, { status: 503 }), 503],
    ['a JSON failure whose error is empty', () => given.json('get', '/api/stats', { error: '' }, { status: 500 }), 500],
    ['a JSON null failure', () => given.json('get', '/api/stats', null, { status: 500 }), 500],
  ])('says which GET failed and with what status for %s', async (_, answer, status) => {
    answer();
    await expect(apiGet('/api/stats')).rejects.toThrow(new Error(`GET /api/stats failed: HTTP ${status}`));
  });


  it('passes a dropped connection on as fetch rejects it', async () => {
    given.networkError('get', '/api/stats');
    await expect(apiGet('/api/stats')).rejects.toMatchObject({ name: 'TypeError', message: DROPPED });
  });


  it('throws JSON.parse\'s own error for the login page served where JSON should be', async () => {
    given.html('get', '/api/listings', 200, LOGIN_PAGE);
    await expect(apiGet('/api/listings')).rejects.toThrow(new SyntaxError(LOGIN_PAGE_PARSE_ERROR));
  });


  it('throws for a successful answer with no body — there is no JSON to read', async () => {
    given.empty('get', '/api/listings');
    await expect(apiGet('/api/listings')).rejects.toThrow(SyntaxError);
  });
});
