#!/bin/sh
# -----------------------------------------------------------
#  [*] Backend — regression test runner
#
#  Builds the backend's PRODUCTION image from this folder
#  under a tag of its own (the same Python, the same pinned
#  packages and the same source that ship — the running
#  backend's image is left alone) and runs the offline
#  unittest suite inside a throwaway container. The container
#  gets no network, so a test that reaches out fails instead
#  of passing by luck, no Etherscan key and no RPC URL — the
#  suite brings throwaway ones, so no test can spend a real
#  quota — and no database volume: every test builds its own
#  SQLite file. Extra arguments go to unittest's discovery —
#  a file pattern, a test-name filter, verbose output.
#
#  The live smoke layer needs the running backend and stays
#  opt-in; tests/README.md has that command.
# -----------------------------------------------------------
set -e
cd "$(dirname "$0")"

sudo docker build -t nft-backend-check .
sudo docker run --rm --name nft-backend-tests --network none \
  nft-backend-check python -m unittest discover -s tests "$@"
