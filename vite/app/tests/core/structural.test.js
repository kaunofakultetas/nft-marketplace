// -----------------------------------------------------------
//  [*] Tests — structural rules of the SPA
//
//  Rules about the code base as a whole rather than one
//  component, read from the source text:
//    - every backend read in src/ (apiGet and fetch — literal
//      and template URLs) has a default handler in the test
//      double and is a relative /api path; the only computed
//      URLs are apiGet's own fetch and the IPFS helper's, fed
//      the gateway URL of a tokenURI; the chain is reached
//      only through the runtime config's RPC relay (wagmi's
//      transport, every ethers provider); nothing else talks
//      to the network
//    - every contract call names a function of the ABI it
//      passes, with as many arguments as the function takes;
//      the marketplace ABI the app ships declares every
//      function as NftMarketplace.sol does, and its events
//      hash to the topics the backend indexes by; the ERC-721
//      functions the app calls are the standard's
//    - the route table: every page directory imported and
//      routed, each page module default-exporting its
//      component; the header linking every page without
//      parameters and nothing else; every link and navigation
//      in src/ leading to a declared route
//    - index.html: English, titled like the header's
//      wordmark; every image and icon the SPA points at
//      exists in public/
//    - the SPA keeps nothing in the browser itself — wagmi's
//      own storage is all that persists
//    - main.jsx builds the provider stack the tests' frame
//      (tests/support/render.jsx) mirrors
//    - the double's world agrees with itself: every listing
//      is its seller's token on the chain, approved for the
//      marketplace; every archived token is one the
//      marketplace has seen; every IPFS-addressed token URI
//      resolves on the gateway, except the file meant to be
//      lost
// -----------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parseAbi, toEventSelector, toEventSignature, toFunctionSignature } from 'viem';
import { defaultHandlers } from '../support/backend/handlers';
import * as f from '../support/backend/fixtures';
import { MARKETPLACE_ABI, ERC721_ABI } from '../support/chain/sepolia';
import { ipfsPath } from '../support/ipfs/gateway';
import { APP_ROOT, SRC, appRoutes, headerLinks, pageImports, readSource, sourceFiles, withoutComments } from '../support/shell/source';
import { nftAbi, nftMarketplaceAbi } from '@/constants';


// The code of every source file, comments blanked out
const CODE = sourceFiles().map(({ file, code }) => ({ file, code: withoutComments(code) }));

// A route pattern as a regular expression over a path
const routePattern = (path) => new RegExp(`^${path.replace(/:\w+/g, '[^/]+')}$`);

// The functions of an ABI by name
const functionsOf = (abi) => abi.filter((item) => item.type === 'function');







// -----------------------------------------------------------
// callArguments / enclosingObject
// -----------------------------------------------------------
//
// callArguments reads the argument list of the call whose "("
// sits at `open`, as top-level arguments — strings, templates
// and nested brackets respected. enclosingObject reads the
// object literal around a position: from the nearest "{" that
// is not closed before it to the "}" that closes it.
// -----------------------------------------------------------

function callArguments(code, open) {

  const args = [];
  let depth = 0;
  let quote = null;
  let start = open + 1;

  for (let i = open; i < code.length; i += 1) {
    const c = code[i];
    if (quote) {
      if (c === '\\') i += 1;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') quote = c;
    else if ('([{'.includes(c)) depth += 1;
    else if (')]}'.includes(c)) {
      depth -= 1;
      if (depth === 0) {
        args.push(code.slice(start, i).trim());
        return args.filter(Boolean);
      }
    } else if (c === ',' && depth === 1) {
      args.push(code.slice(start, i).trim());
      start = i + 1;
    }
  }
  throw new Error(`unclosed call at ${open}`);
}

function enclosingObject(code, at) {
  let depth = 0;
  let open = at;
  for (; open >= 0; open -= 1) {
    if (code[open] === '}') depth += 1;
    if (code[open] === '{') {
      if (depth === 0) break;
      depth -= 1;
    }
  }
  if (open < 0) throw new Error(`no object around ${at}`);
  const fields = callArguments(code, open);
  return fields.join(',\n');
}







// -----------------------------------------------------------
// networkCalls
// -----------------------------------------------------------
//
// Every apiGet, fetch and fetchWithTimeout call in src/ (not
// their declarations), each with its file and its URL: a
// literal or template URL becomes its path, with template
// expressions turned into ":param" and the query string
// dropped; any other URL is kept as the expression it comes
// from.
// -----------------------------------------------------------

const CALL_RE = /\b(apiGet|fetchWithTimeout)\(|(?<![\w.$])fetch\(/g;

function networkCalls() {

  const calls = [];

  for (const { file, code } of CODE) {
    for (const match of code.matchAll(CALL_RE)) {
      if (/function\s+$/.test(code.slice(0, match.index))) continue;
      const via = match[1] ?? 'fetch';
      const [first = ''] = callArguments(code, match.index + match[0].length - 1);
      const literal = first.match(/^(?:"([^"]*)"|'([^']*)'|`([^`]*)`)$/);

      if (literal) {
        const raw = literal[1] ?? literal[2] ?? literal[3];
        calls.push({ file, via, url: raw.replace(/\$\{[^}]*\}/g, ':param').split('?')[0] });
      } else {
        calls.push({ file, via, expression: first });
      }
    }
  }

  return calls;
}

// A handler's path (absolute, msw params) against a call's
// path: segment-wise, a ":param" on either side matching
// anything
const handlerMatches = (handler, method, url) => {
  if (handler.info.method.toUpperCase() !== method) return false;
  const handlerPath = String(handler.info.path).replace(/^http:\/\/localhost:3000/, '');
  const hs = handlerPath.split('/');
  const cs = url.split('/');
  if (hs.length !== cs.length) return false;
  return hs.every((segment, i) => segment.startsWith(':') || cs[i].startsWith(':') || segment === cs[i]);
};







// -----------------------------------------------------------
// contractCalls
// -----------------------------------------------------------
//
// Every contract call in src/ — an object literal naming a
// functionName — with its file, the ABI it passes, the
// function and the number of arguments it hands over (none
// without an args field).
// -----------------------------------------------------------

function contractCalls() {
  return CODE.flatMap(({ file, code }) => [...code.matchAll(/functionName:\s*'(\w+)'/g)].map((match) => {
    const object = enclosingObject(code, match.index);
    const abi = object.match(/\babi:\s*(\w+)/)?.[1] ?? null;
    const argsAt = object.indexOf('args:');
    const args = argsAt < 0 ? 0 : callArguments(object, object.indexOf('[', argsAt)).length;
    return { file, abi, functionName: match[1], args };
  }));
}

const ABIS = { nftAbi, nftMarketplaceAbi };







// -----------------------------------------------------------
// internalTargets
// -----------------------------------------------------------
//
// Every place src/ sends the student inside the app — a Link
// or NavLink's `to`, a navigate() call — as its path with
// template expressions turned into ":param" and the query
// dropped.
// -----------------------------------------------------------

function internalTargets() {
  const found = [];
  for (const { file, code } of CODE) {
    for (const match of code.matchAll(/\bto=(?:"([^"]+)"|\{`([^`]+)`\})|\bnavigate\(`([^`]+)`\)/g)) {
      const raw = match[1] ?? match[2] ?? match[3];
      found.push({ file, path: raw.replace(/\$\{[^}]*\}/g, ':param').split('?')[0] });
    }
    // NavItem's own `to={to}` takes the header's literal targets
    if (/<NavLink\s[^>]*to=\{to\}/.test(code)) {
      for (const link of headerLinks()) found.push({ file, path: link.to });
    }
  }
  return found;
}







// -----------------------------------------------------------
// The backend calls
// -----------------------------------------------------------

describe('structural rules — the backend calls', () => {

  const calls = networkCalls();


  it('finds the SPA\'s calls — the config, every page\'s reads and the metadata fetch', () => {
    expect(calls.length).toBeGreaterThanOrEqual(12);
    const files = new Set(calls.map((call) => call.file));
    for (const file of ['src/config.js', 'src/pages/Home/Page.jsx', 'src/pages/MyNfts/Page.jsx', 'src/pages/SellNft/Page.jsx', 'src/pages/History/Page.jsx', 'src/pages/About/Page.jsx', 'src/pages/NftDetail/Page.jsx', 'src/hooks/useNftMetadata.js']) {
      expect(files, file).toContain(file);
    }
    expect(calls).toContainEqual({ file: 'src/pages/NftDetail/Page.jsx', via: 'apiGet', url: '/api/nft/:param/:param' });
    expect(calls).toContainEqual({ file: 'src/pages/History/Page.jsx', via: 'apiGet', url: '/api/activity' });
  });


  it('every backend read in src/ has a default handler in the test double', () => {
    const unhandled = calls
      .filter((call) => call.url && !defaultHandlers.some((handler) => handlerMatches(handler, 'GET', call.url)))
      .map((call) => `GET ${call.url} (${call.file})`);
    expect(unhandled).toEqual([]);
  });


  it('every literal URL is a relative /api path — no hardcoded host', () => {
    const elsewhere = calls.filter((call) => call.url && !call.url.startsWith('/api/')).map((call) => `${call.url} (${call.file})`);
    expect(elsewhere).toEqual([]);
  });


  it('the only computed URLs are apiGet\'s own fetch and the IPFS helper\'s, fed a tokenURI moved onto the gateway', () => {
    expect(calls.filter((call) => call.expression).map(({ file, via, expression }) => `${via}(${expression}) ${file}`).sort()).toEqual([
      'fetch(path) src/utils/api.js',
      'fetch(url) src/utils/ipfs.js',
      'fetchWithTimeout(toGatewayURL(tokenURI)) src/hooks/useNftMetadata.js',
    ]);
    expect(defaultHandlers.some((handler) => handler.info.method === 'GET' && String(handler.info.path).endsWith('/ipfs/*'))).toBe(true);
  });


  it('reaches the chain only through the runtime config\'s RPC relay — wagmi\'s transport and every ethers provider', () => {
    const main = withoutComments(readSource('src/main.jsx'));
    expect(main).toMatch(/\[sepolia\.id\]:\s*http\(config\.rpcUrl\)/);
    expect([...main.matchAll(/\bhttp\(/g)]).toHaveLength(1);

    const providers = CODE.flatMap(({ file, code }) => [...code.matchAll(/new\s+ethers\.JsonRpcProvider\(/g)].map((match) => {
      const [argument] = callArguments(code, match.index + match[0].length - 1);
      const fromConfig = argument === 'getConfig().rpcUrl'
        || new RegExp(`const\\s*\\{[^}]*\\b${argument}\\b[^}]*\\}\\s*=\\s*getConfig\\(\\)`).test(code);
      return { file, argument, fromConfig };
    }));
    expect(providers.map(({ file }) => file).sort()).toEqual(['src/pages/NftDetail/Page.jsx', 'src/pages/SellNft/Page.jsx']);
    expect(providers.filter((provider) => !provider.fromConfig)).toEqual([]);

    expect(defaultHandlers.some((handler) => handler.info.method === 'POST' && String(handler.info.path).endsWith('/api/rpc'))).toBe(true);
  });


  it('nothing else talks to the network — no XHR, socket, beacon, other ethers provider or raw wallet request', () => {
    const offenders = CODE.filter(({ code }) => (
      /\bnew\s+(XMLHttpRequest|WebSocket|EventSource)\b|\bsendBeacon\(|\baxios\b/.test(code)
      || /\b(WebSocketProvider|InfuraProvider|AlchemyProvider|EtherscanProvider|BrowserProvider|getDefaultProvider)\b/.test(code)
      || /\bethereum\.request\(/.test(code)
    )).map(({ file }) => file);
    expect(offenders).toEqual([]);
  });
});







// -----------------------------------------------------------
// The contracts
// -----------------------------------------------------------

describe('structural rules — the contracts', () => {

  it('finds every contract call — the reads and the six writes', () => {
    expect(contractCalls().map(({ functionName }) => functionName).sort()).toEqual([
      'approve', 'buyListing', 'cancelListing', 'getProceeds', 'listItem', 'tokenURI', 'updateListing', 'withdrawProceeds',
    ]);
  });


  it('every contract call names a function of the ABI it passes, with as many arguments as it takes', () => {
    for (const call of contractCalls()) {
      const label = `${call.functionName} (${call.file})`;
      expect(ABIS[call.abi], `${label} passes a known ABI`).toBeDefined();
      const fn = functionsOf(ABIS[call.abi]).find((item) => item.name === call.functionName);
      expect(fn, `${label} is in ${call.abi}`).toBeDefined();
      expect(call.args, `${label} argument count`).toBe(fn.inputs.length);
    }
  });


  it('the marketplace ABI the app ships declares every function as NftMarketplace.sol does', () => {
    for (const fn of functionsOf(MARKETPLACE_ABI)) {
      const shipped = functionsOf(nftMarketplaceAbi).find((item) => item.name === fn.name);
      expect(shipped, fn.name).toBeDefined();
      expect(toFunctionSignature(shipped), fn.name).toBe(toFunctionSignature(fn));
      expect(shipped.stateMutability, fn.name).toBe(fn.stateMutability);
    }
  });


  it('the marketplace\'s events hash to the topics the backend indexes by', () => {
    const shipped = nftMarketplaceAbi.filter((item) => item.type === 'event');
    const byName = { Listed: 'ItemListed', Updated: 'ItemUpdated', Bought: 'ItemBought', Canceled: 'ItemCanceled' };
    for (const [key, { signature, topic0 }] of Object.entries(f.EVENT_TOPICS)) {
      const event = shipped.find((item) => item.name === byName[key]);
      expect(event, key).toBeDefined();
      expect(toEventSignature(event), key).toBe(signature);
      expect(toEventSelector(signature), key).toBe(topic0);
    }
  });


  it('the ERC-721 functions the app calls are the standard\'s — in the ABI file and in the owner lookup', () => {
    for (const name of ['tokenURI', 'approve', 'ownerOf']) {
      const shipped = functionsOf(nftAbi).find((item) => item.name === name);
      const standard = functionsOf(ERC721_ABI).find((item) => item.name === name);
      expect(toFunctionSignature(shipped), name).toBe(toFunctionSignature(standard));
    }

    const lookup = readSource('src/pages/NftDetail/Page.jsx').match(/\['(function ownerOf[^']*)'\]/)?.[1];
    expect(lookup).toBeDefined();
    const [ownerOf] = parseAbi([lookup]);
    expect(toFunctionSignature(ownerOf)).toBe(toFunctionSignature(functionsOf(ERC721_ABI).find((item) => item.name === 'ownerOf')));
    expect(ownerOf.outputs.map((output) => output.type)).toEqual(['address']);
  });
});







// -----------------------------------------------------------
// The route table
// -----------------------------------------------------------

describe('structural rules — the route table', () => {

  it('reads App.jsx\'s routes', () => {
    expect(appRoutes().map(({ path, index, element }) => [path, index, element])).toEqual([
      ['/', true, 'HomePage'],
      ['/my-nfts', false, 'MyNftsPage'],
      ['/sell-nft', false, 'SellNftPage'],
      ['/history', false, 'HistoryPage'],
      ['/about', false, 'AboutPage'],
      ['/nft/:nftAddress/:tokenId', false, 'NftDetailPage'],
    ]);
  });


  it('imports every page directory under src/pages statically, and routes it', () => {
    const directories = readdirSync(join(SRC, 'pages')).filter((name) => statSync(join(SRC, 'pages', name)).isDirectory());
    const imports = pageImports();
    const routed = new Set(appRoutes().map((route) => route.element));

    for (const directory of directories) {
      expect(existsSync(join(SRC, 'pages', directory, 'Page.jsx')), `${directory}/Page.jsx`).toBe(true);
      const imported = imports.filter((entry) => entry.dir === directory);
      expect(imported, `${directory} imported once by App.jsx`).toHaveLength(1);
      expect(routed.has(imported[0].name), `${directory} (${imported[0].name}) is a route's element`).toBe(true);
    }
    expect(imports).toHaveLength(directories.length);
  });


  it('every page module default-exports its component', () => {
    for (const { dir } of pageImports()) {
      expect(readSource(`src/pages/${dir}/Page.jsx`), dir).toMatch(/^export default function \w+\(/m);
    }
  });


  it('the header links every page without parameters, and nothing else', () => {
    const plain = appRoutes().filter((route) => !route.path.includes(':')).map((route) => route.path);
    expect(headerLinks().map((link) => link.to).sort()).toEqual([...plain].sort());
  });


  it('every link and navigation in src/ leads to a route App.jsx declares', () => {
    const patterns = appRoutes().map((route) => routePattern(route.path));
    const targets = internalTargets();
    expect(targets.length).toBeGreaterThanOrEqual(10);
    const dead = targets.filter(({ path }) => !patterns.some((pattern) => pattern.test(path))).map(({ file, path }) => `${path} (${file})`);
    expect(dead).toEqual([]);
  });
});







// -----------------------------------------------------------
// index.html and the static assets
// -----------------------------------------------------------

describe('structural rules — index.html and the static assets', () => {

  it('declares the page English and titles it like the header\'s wordmark', () => {
    const html = readSource('index.html');
    expect(html).toMatch(/<html lang="en">/);
    const title = html.match(/<title>([^<]*)<\/title>/)?.[1];
    expect(title).toBe('NFT Marketplace');
    expect(readSource('src/components/Header.jsx')).toContain(`>${title}</h1>`);
  });


  it('every image and icon the SPA points at exists in public/', () => {
    const referenced = new Set([
      ...CODE.flatMap(({ code }) => [...code.matchAll(/\bsrc="(\/[^"]+)"/g)].map((match) => match[1])),
      ...[...readSource('index.html').matchAll(/<link[^>]+href="(\/[^"]+)"/g)].map((match) => match[1]),
    ]);
    expect([...referenced].sort()).toEqual(['/favicon.ico', '/img/logo_knf.png']);
    for (const path of referenced) expect(existsSync(join(APP_ROOT, 'public', path)), path).toBe(true);
  });
});







// -----------------------------------------------------------
// What the SPA remembers
// -----------------------------------------------------------

describe('structural rules — what the SPA remembers', () => {

  it('keeps nothing in the browser itself — no storage, cookie, IndexedDB or Cache API in src/', () => {
    const offenders = CODE.filter(({ code }) => /\b(localStorage|sessionStorage|indexedDB)\b|document\.cookie|\bcaches\./.test(code)).map(({ file }) => file);
    expect(offenders).toEqual([]);
  });
});







// -----------------------------------------------------------
// The provider stack
// -----------------------------------------------------------

describe('structural rules — the provider stack', () => {

  const wagmiConfig = [/chains:\s*\[sepolia\]/, /\[sepolia\.id\]:\s*http\(\w+(\(\))?\.rpcUrl\)/, /connectors:\s*\[injected\(\)\]/];


  it('main.jsx builds wagmi for Sepolia alone, on the relay, with the injected connector — under StrictMode, the query client inside', () => {
    const main = withoutComments(readSource('src/main.jsx'));
    for (const rule of wagmiConfig) expect(main).toMatch(rule);
    expect(main).toMatch(/<StrictMode>\s*<WagmiProvider config=\{wagmiConfig\}>\s*<QueryClientProvider client=\{queryClient\}>\s*<App \/>/);
  });


  it('the tests\' frame builds the same wagmi config (tests/support/render.jsx)', () => {
    const frame = withoutComments(readSource('tests/support/render.jsx'));
    for (const rule of wagmiConfig) expect(frame).toMatch(rule);
    expect(frame).toMatch(/http\(getConfig\(\)\.rpcUrl\)/);
  });
});







// -----------------------------------------------------------
// The double's world
// -----------------------------------------------------------

describe('structural rules — the double\'s world', () => {

  const tokenOnChain = (nftAddress, tokenId) => f.chainCollections[nftAddress]?.tokens[tokenId];


  it('every listing is its seller\'s token on the chain, approved for the marketplace', () => {
    for (const listing of f.listings().listings) {
      const token = tokenOnChain(listing.nftAddress, listing.tokenId);
      expect(token?.owner, `${listing.nftAddress} #${listing.tokenId}`).toBe(listing.seller);
      expect(token?.approved, `${listing.nftAddress} #${listing.tokenId}`).toBe(f.MARKETPLACE);
    }
  });


  it('every token in the story exists on the chain, and every archived token is one the story names', () => {
    const storyTokens = new Set(f.STORY.map((event) => `${event.nftAddress}-${event.tokenId}`));
    for (const key of storyTokens) {
      const [nftAddress, tokenId] = key.split('-');
      expect(tokenOnChain(nftAddress, tokenId), key).toBeDefined();
    }
    for (const key of Object.keys(f.ARCHIVE)) expect(storyTokens.has(key), key).toBe(true);
  });


  it('every IPFS-addressed token URI resolves on the gateway — except the file meant to be lost', () => {
    for (const [nftAddress, collection] of Object.entries(f.chainCollections)) {
      for (const [tokenId, { uri }] of Object.entries(collection.tokens)) {
        if (!uri.startsWith('ipfs://') || uri.includes(f.LOST_DIR)) continue;
        const path = ipfsPath(`http://localhost:3000/ipfs/${uri.slice('ipfs://'.length)}`);
        expect(f.ipfsFiles[path], `${nftAddress} #${tokenId}`).toBeDefined();
      }
    }
    expect(Object.keys(f.ipfsFiles).some((path) => path.includes(f.LOST_DIR))).toBe(false);
  });
});
