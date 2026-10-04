# Backend regression tests

Four layers, from cheapest to heaviest:

| Layer | Files | Needs network? | When to run |
|---|---|---|---|
| Settings and schema | `test_main.py`, `test_database.py` | no | always |
| Offline regression | `test_etherscan.py`, `test_indexer.py`, `test_ownership.py`, `test_pinner.py`, `test_api_routes.py` | no | always |
| Known defects | `test_<area>_defects.py` — none open at the moment | no | always (expected failures) |
| Live smoke | `integration/test_live_smoke.py` | yes (running backend) | opt-in via `RUN_LIVE=1` |

The offline layers are the safety net: they must pass with no internet,
no Etherscan key, no RPC provider, no IPFS node and no database volume.
`test_api_routes.py` is the bridge to the GUI: it replays the same
marketplace story the frontend suite's fixtures tell through the REAL
indexer, and pins the backend's answers to exactly what those fixtures
assume — a change on one side shows up on the other.

## Running

The production image built under its own tag, the suite in a throwaway
container with no network — the one way to run the offline layers:

    ./runTests.sh                        # everything
    ./runTests.sh -p "test_pinner.py"    # one file
    ./runTests.sh -k reorg -v            # a name filter, verbose

The running backend's root filesystem is read-only (docker-compose.yml),
so the offline layers, which build their throwaway databases under
/tmp, cannot run inside it. The live smoke layer writes nothing — run it
there, against the backend that is up (its image must carry the tests;
every image built from this folder does):

    sudo docker exec -w /app -e RUN_LIVE=1 nft-backend python -m unittest tests.integration.test_live_smoke -v

## Conventions

- **Offline by default.** A test that talks to the network belongs under
  `integration/` and must skip itself unless `RUN_LIVE=1` is set.
  Etherscan is `helpers.FakeEtherscan` (or a scripted `requests.get` for
  the client itself), the kubo node and the gateway caches are
  `helpers.FakeKubo`, the relay's upstream is a mock. A real error worded
  by requests itself comes from `helpers.no_dns()` — no packet leaves.
- **`tests.helpers` is imported first.** It puts a throwaway environment
  in place before `main` is imported — a test marketplace address, an RPC
  URL and an Etherscan key that are not real (shaped like real ones, so
  the leak tests mean something) — and points `DB_PATH` at a scratch
  file: `app/database/db.py` binds its default path at import, and in the
  running container that default is the LIVE database. A late import is
  refused with an error. NEVER put a real key in a test.
- **Every database is a throwaway file with the REAL schema**
  (`helpers.DbTestCase`): the modules a test names in `DB_MODULES` read
  and write that file.
- **The daemons are never started.** Their loops are driven round by
  round: `helpers.sleeps(stop_at=n)` stands in for `time.sleep` and
  raises `helpers.StopLoop` — a BaseException, so the loops' catch-all
  lets it through. What they print is captured with `helpers.quiet()`.
- **Routes go through `helpers.make_app()`** — `main.py` reloaded and the
  blueprint registered exactly as its boot does. The routes' module-level
  `etherscan`, `wallet_holdings` and `_deployment` are patched per test.
  `test_main.py` runs the real `python main.py` boot (with the daemons and
  the dev server patched out) to pin the wiring itself.
- **The world** is the frontend fixtures' story (`helpers.STORY_LOGS`, the
  same addresses, blocks, prices and transactions). Keep the two in step.
- **A defect found by review but not yet fixed** gets its regression test
  UP FRONT, in `test_<area>_defects.py`, decorated
  `@unittest.expectedFailure`: the test states the wanted behaviour and
  fails today. Check a new one fails AT the defect — run it once without
  the decorator and read the failure. Once the fix lands, unittest reports
  an "unexpected success" — which fails the run — and that is the cue to
  drop the decorator and move the test into its home file.
- **Style:** test files carry the house file/class banners, but test
  methods use a one-line comment and single blank lines instead of full
  method banners — a test's name is its documentation.
