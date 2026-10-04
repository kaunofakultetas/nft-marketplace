// -----------------------------------------------------------
//  [*] Test support — the SPA's source, read as text
//
//  App.jsx declares its routes as JSX, not as an exported
//  object; the header's links and main.jsx's provider stack
//  are module-private too — so the structural rules and the
//  route sweep read them from the source text: every <Route>
//  with its path, index flag and element, nested into full
//  paths, the page modules App.jsx imports, the header's nav
//  links, and the wagmi config main.jsx builds. A small
//  brace-aware scanner, not a JSX parser: it reads the shapes
//  these files use and THROWS on anything it cannot read, so a
//  reshaped file fails loudly instead of yielding an empty
//  table every rule would pass over.
//
//  Split into:
//
//    APP_ROOT / SRC    — where the app and its source live
//    readSource        — one file as text
//    sourceFiles       — every .js / .jsx / .mjs under a folder
//    withoutComments   — code with the comments blanked out
//    routeTags         — the <Route> tags of a JSX text
//    appRoutes         — every route of App.jsx, full paths
//    pageImports       — the page modules App.jsx imports
//    headerLinks       — the header's nav links
//
//  Used by:
//    - core/structural.test.js — every rule
//    - contract/route-sweep.test.jsx — the route table the
//      sweep must cover
// -----------------------------------------------------------

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';


// vitest runs from vite/app (the container's /app)
export const APP_ROOT = process.cwd();
export const SRC = join(APP_ROOT, 'src');







// -----------------------------------------------------------
// readSource / sourceFiles
// -----------------------------------------------------------
//
// readSource reads one file, named by its path under vite/app,
// as text. sourceFiles reads every .js, .jsx and .mjs file
// under a folder — src unless told otherwise — each with its
// path relative to vite/app and its text.
//
// Used by:
//   - appRoutes / pageImports / headerLinks (below)
//   - core/structural.test.js
// -----------------------------------------------------------

export const readSource = (path) => readFileSync(join(APP_ROOT, path), 'utf8');

const walk = (dir) => readdirSync(dir).flatMap((name) => {
  const full = join(dir, name);
  return statSync(full).isDirectory() ? walk(full) : [full];
});

export const sourceFiles = (dir = SRC) => walk(dir)
  .filter((full) => /\.(jsx?|mjs)$/.test(full))
  .map((full) => ({ file: relative(APP_ROOT, full), code: readFileSync(full, 'utf8') }));







// -----------------------------------------------------------
// withoutComments
// -----------------------------------------------------------
//
// Blanks out block and line comments — a banner that names a
// call or a route tag must not count as code — keeping every
// line in place. A scanner, not a pattern: it steps over
// string and template literals, so a URL's "//" or a path's
// "/*" inside one (or inside a comment, like "/api/*") never
// opens a comment. A quote inside JSX text (an apostrophe in
// "NFT's") opens no string past its own line — JavaScript
// strings cannot cross one.
//
// Used by:
//   - appRoutes, pageImports, headerLinks (below)
//   - core/structural.test.js — the call and import scans
// -----------------------------------------------------------

export function withoutComments(code) {

  let out = '';
  let quote = null;

  for (let i = 0; i < code.length; i += 1) {
    const c = code[i];
    const next = code[i + 1];

    if (quote) {
      out += c;
      if (c === '\\') {
        out += next ?? '';
        i += 1;
      } else if (c === quote || (c === '\n' && quote !== '`')) {
        quote = null;
      }
      continue;
    }

    if (c === '/' && next === '/') {
      while (i < code.length && code[i] !== '\n') i += 1;
      out += '\n';
      continue;
    }

    if (c === '/' && next === '*') {
      const end = code.indexOf('*/', i + 2);
      const stop = end < 0 ? code.length : end + 2;
      out += code.slice(i, stop).replace(/[^\n]/g, '');
      i = stop - 1;
      continue;
    }

    if (c === '"' || c === "'" || c === '`') quote = c;
    out += c;
  }

  return out;
}







// -----------------------------------------------------------
// routeTags
// -----------------------------------------------------------
//
// Every opening, self-closing and closing <Route> tag of a
// JSX text, in order: an opening tag with its attribute text
// and whether it closes itself, a closing tag as a bare mark.
// An opening tag ends at the first ">" outside braces and
// quotes — an element attribute holds a whole component tag.
// A <Routes> tag is never taken for one.
//
// Used by:
//   - appRoutes (below)
// -----------------------------------------------------------

function routeTags(jsx) {

  const tags = [];

  for (let i = 0; i < jsx.length; i += 1) {
    if (jsx.startsWith('</Route>', i)) {
      tags.push({ close: true });
      continue;
    }
    if (!jsx.startsWith('<Route', i) || !/[\s/>]/.test(jsx[i + 6])) continue;

    let depth = 0;
    let quote = null;
    let end = i + 6;
    for (; end < jsx.length; end += 1) {
      const c = jsx[end];
      if (quote) {
        if (c === quote) quote = null;
      } else if (c === '"' || c === "'" || c === '`') {
        quote = c;
      } else if (c === '{') {
        depth += 1;
      } else if (c === '}') {
        depth -= 1;
      } else if (c === '>' && depth === 0) {
        break;
      }
    }

    const attrs = jsx.slice(i + 6, end);
    tags.push({ attrs, selfClosing: attrs.trimEnd().endsWith('/') });
    i = end;
  }

  return tags;
}







// -----------------------------------------------------------
// appRoutes
// -----------------------------------------------------------
//
// Every <Route> of App.jsx in declaration order, each with
// its path, whether it is an index route and the component it
// renders. The path is made absolute through its parents (an
// index route carries its parent's path, the root one '/'; a
// catch-all stays '*'). The component is the one named in the
// element attribute — null for a layout route that only
// groups children.
//
// Used by:
//   - core/structural.test.js — pages, header links
//   - contract/route-sweep.test.jsx — the sweep's coverage
// -----------------------------------------------------------

export function appRoutes() {

  const tags = routeTags(withoutComments(readSource('src/App.jsx')));
  if (tags.length === 0) throw new Error('no <Route> found in src/App.jsx — has the route table moved?');

  const routes = [];
  const parents = [''];

  for (const tag of tags) {
    if (tag.close) {
      parents.pop();
      continue;
    }

    const parent = parents[parents.length - 1];
    const path = tag.attrs.match(/\bpath="([^"]*)"/)?.[1] ?? null;
    const index = /(^|\s)index(?=[\s/]|$)/.test(tag.attrs);
    const element = tag.attrs.match(/\belement=\{\s*<(\w+)/)?.[1] ?? null;
    if (!index && path === null) throw new Error(`a <Route> with neither path nor index: <Route${tag.attrs}>`);

    const full = index ? (parent || '/') : (path === '*' ? '*' : `${parent}/${path.replace(/^\//, '')}`);
    routes.push({ path: full, index, element });

    if (!tag.selfClosing) parents.push(full);
  }

  if (parents.length !== 1) throw new Error('unbalanced <Route> nesting in src/App.jsx');
  return routes;
}







// -----------------------------------------------------------
// pageImports
// -----------------------------------------------------------
//
// Every page module App.jsx imports — the name it is imported
// under and its folder in src/pages, read from the default
// imports of a folder's Page module.
//
// Used by:
//   - core/structural.test.js
// -----------------------------------------------------------

export function pageImports() {
  const app = withoutComments(readSource('src/App.jsx'));
  return [...app.matchAll(/^import (\w+) from '@\/pages\/([^/']+)\/Page';$/gm)].map(([, name, dir]) => ({ name, dir }));
}







// -----------------------------------------------------------
// headerLinks
// -----------------------------------------------------------
//
// The header's nav links in their order — where each leads
// and the words on it — read from Header.jsx's NavItem tags.
//
// Used by:
//   - core/structural.test.js
//   - components/header.test.jsx — the links the bar must show
// -----------------------------------------------------------

export function headerLinks() {
  const header = withoutComments(readSource('src/components/Header.jsx'));
  const links = [...header.matchAll(/<NavItem to="([^"]+)">([^<]+)<\/NavItem>/g)].map(([, to, label]) => ({ to, label: label.trim() }));
  if (links.length === 0) throw new Error('no <NavItem> found in src/components/Header.jsx — has the nav moved?');
  return links;
}
