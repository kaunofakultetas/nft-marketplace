# Frontend tests

The vitest suite of the NFT marketplace SPA: every page, component, hook
and helper rendered in jsdom against doubles of everything behind the
endpoint — the backend's API, the Sepolia chain behind its RPC relay, the
IPFS gateway — and a MetaMask double in the browser, with no real backend,
chain, wallet, IPFS node or network anywhere.

## Running

```sh
../runTests.sh                      # the whole suite, in a throwaway container
../runTests.sh tests/pages          # a folder, a file, or -t "test name"
../runTests.sh --coverage           # + the coverage of src/, printed at the end
```

`runTests.sh` builds the builder stage of the production Dockerfile (so
`npm run build` must pass first) and runs vitest in it, with no network at
all — the host needs no node. When the stack runs the dev container
(`Dockerfile.dev`, see `docker-compose.yml`), that is quicker:

```sh
sudo docker exec -it -w /app -e TMPDIR=/app/node_modules/.tmp nft-vite npx vitest run tests/pages/home.test.jsx
```

(its root filesystem is read-only, so vitest's temp files go under
`node_modules/.tmp` — on disk, ignored by git and docker; not `/dev/shm`,
whose 64 MB fill up after a few dozen runs). `npx eslint tests` lints the
suite like the app.

## Layout

| Folder | What lives there |
|---|---|
| `support/` | The harness: `setup.js` (the polyfill, the doubles' lifecycle, the per-test slate, the guards), `render.jsx` (`renderPage`, `renderApp` — main.jsx's wagmi and query providers), `location.js`, `backend/` (the msw server with `given.*`, the default `handlers.js`, the world in `fixtures.js`, the `contract.js` matrix), `chain/sepolia.js` (the chain behind the RPC relay), `ipfs/gateway.js`, `wallets/metamask.js`, `shell/` (the source readers, request watchers, router probes), `diagnoses.js`, `toasts.js`, `nft-detail/` |
| `core/` | The app as a whole: the harness smoke test, the structural rules (every backend call has a handler, every contract call matches its ABI …), the runtime config, main.jsx's startup, App's shell and routing |
| `components/` | Shared components: Header, Footer, ConnectButton, ConnectPrompt, NFTBox, NftThumb, BuyNftModal, UpdateListingModal |
| `hooks/` | useNftMetadata — a token's metadata and every diagnosis of a wrongly minted one |
| `pages/` | One file per page (a folder for the NFT detail page), behaviour plus the backend contract of every endpoint the page reads |
| `contract/` | The route sweep: every route under every backend failure mode |
| `utils/` | The display, API and IPFS helpers |

## The world

`support/backend/fixtures.js` is one small marketplace every double answers
from, and its parts agree the way the live system does: the backend's
listings are the replay of its event story, the chain's owners match the
listings' sellers and the wallets' holdings, every listed token is approved
for the marketplace, the archive rows describe the files the gateway
serves (`core/structural.test.js` checks it stays so).

- **People**: `STUDENT` — the account in the MetaMask double — with a second
  account (`OTHER_ACCOUNT`, too poor to buy anything), the classmate who
  sells (`SELLER`) and the one who bought from the student (`BUYER`).
- **PUG** — the course's own NFT (the "Dogie" BasicNft, every token sharing
  the real PUG metadata): #0 the classmate's listing (re-priced), #1 the
  student's listing, #2 sold by the student, #3 the student's, unlisted.
- **ART** — a student-made collection minted every way it can go wrong: #0
  healthy and listed; #1 an image where the JSON should be; #2 a file that is
  not JSON; #3 JSON without "image"; #4 the non-standard "image_url"; #5
  metadata nobody hosts any more; #6 burned. `support/diagnoses.js` holds
  what the GUI must say about each, word for word.

## Rules

- **Nothing real.** Every request goes to an msw double: `/api/*` to the
  backend's (`handlers.js`), `POST /api/rpc` to the Sepolia double, `/ipfs/*`
  to the gateway double. A request no handler answers fails the test — add a
  default handler (a new endpoint in `src/`) or answer it in the test with
  `given.*`; `core/structural.test.js` checks every call in `src/` has a
  default handler. The container runs with no network, so a forgotten
  request can never leave it. A request the Sepolia double itself trips over
  fails the test too — that is a bug of the double, never a behaviour.
- **Declare only the deviation.** Default handlers answer the happy path
  from `fixtures.js`; a test overrides one route with `given.json / error /
  html / text / empty / networkError / hang / slow / capture / sequence`,
  bends the chain with `sepolia.*` (an owner, a token URI, a burned token, a
  balance, proceeds, mining held until `sepolia.mine()`) and the wallet with
  `installMetamask({ … })` and its `decline / hold / hang / fail / answer`.
  Fixtures are shared: copy and edit (`{ ...f.stats(), floorPriceWei: null }`),
  never mutate them.
- **Globals through `vi.stubGlobal`.** The wallet (`window.ethereum`), the
  location double — all undone after each test by `setup.js`, which also
  clears localStorage (where wagmi remembers a connection), removes the
  toasts, rebuilds the chain and destroys every ethers provider.
- **No bug fixed from here.** A test that finds a defect in `src/` does not
  change `src/`: it pins the defect with `it.fails` and a one-line
  description after "PINNED KNOWN BUG:" (the contract matrix's `pins`, the
  route sweep's `PINS`), so the suite stays green while the bug is on
  record. A pin must fail AT the defect it names — flip it to `it` once and
  read the failure before trusting it. When a fix lands, the pin fails the
  suite: turn it back into a plain test.
- **Assert what a student sees.** Roles, labels and the texts verbatim; no
  snapshots, no class names, no implementation internals unless the
  behaviour lives there (the pulse of a skeleton is all there is of it).
  What the wallet was asked to send is read back decoded
  (`metamask.sent[i].call`), what the chain was asked from `sepolia.reads`.
- **Console discipline.** React's bug reports (a missing key, a hook order
  change …) fail the test; a test that provokes one on purpose declares it
  with `allowConsoleErrors(/…/)`.

## Practical notes

What the suite learned the hard way:

- **Connecting.** `installMetamask({ connected: true })` is a student who
  permitted the site before: wagmi reconnects them on load through the
  EIP-6963 announcement (`io.metamask`), no popup. A wallet found only on
  `window.ethereum` (`announce: false`) reconnects only after a first
  connection through the injected connector (its `injected.connected`
  flag). Pages render their connect prompt until the reconnect lands — wait
  for the page's heading.
- **Multicall.** wagmi turns viem's multicall batching on: the page's
  concurrent reads AND the wallet's balance (Multicall3's `getEthBalance`)
  arrive as one `eth_call` to Multicall3's `aggregate3`. `sepolia.readsOf(name)`
  lists each read with `via`.
- **Receipts.** A page waits for its transaction's receipt through the
  relay, asking every 2 s (`utils/chain.js`) — a test that holds mining
  waits up to that long after `sepolia.mine()`. A relay that fails ends the
  wait at once, after viem's own retries (about a second).
- **Toasts.** react-hot-toast keeps a module-level store (cleared after each
  test). `renderPage`'s outlet has the library's own durations, `renderApp`'s
  is App.jsx's (10 s, errors 15 s). A dismissed toast leaves on a timer set
  only once the dismissal has rendered — fake timers advance in steps.
- **Number fields.** user-event types a very small decimal into a number
  field as "1e-19"; a browser passes the digits — use `fireEvent.change`.
- **`window.alert`** is not implemented by jsdom —
  `vi.spyOn(window, 'alert').mockImplementation(() => {})`.
- **Time zone.** `setup.js` puts every test in Europe/Vilnius;
  `vi.stubEnv('TZ', …)` for another — undone after the test.
- **Crashes.** App.jsx has no error boundary: in the browser a crashing page
  goes blank. `renderPage` and `renderApp` put a test net around it, so a
  crash shows as "render crashed: …" and fails with the real message
  (`expectNoCrash`).
- **Dropped connections.** msw's error carries a `cause`; compare its name
  and message (`toMatchObject`), not the whole error.

## Style

The house style of the app: a file header banner saying what the file
covers, a banner per `describe` group, seven blank lines between
sections, two between tests; test names are sentences about behaviour
("tells the student the purchase is on its way"), not method names.
