#!/bin/sh
# -----------------------------------------------------------
#  [*] Frontend — regression test runner
#
#  Builds the builder stage of the PRODUCTION Dockerfile (the
#  same node image and npm install that produce dist/ — so the
#  build itself must pass first) and runs the vitest suite
#  inside a throwaway container — what gets tested is exactly
#  what ships, and the host needs no node. The container gets
#  no network at all: the suite answers every request itself
#  (tests/support), so a request it forgot can never reach a
#  real backend, chain or IPFS node. Extra arguments go to
#  vitest (a file, -t "name", --coverage …).
#
#  While developing, the dev container is quicker (the stack
#  running Dockerfile.dev, see docker-compose.yml):
#    sudo docker exec -it -w /app -e TMPDIR=/app/node_modules/.tmp nft-vite npx vitest run
#  (its root filesystem is read-only — vitest's temp files go
#  under node_modules/.tmp, on disk; /dev/shm is only 64 MB)
# -----------------------------------------------------------
set -e
cd "$(dirname "$0")"

sudo docker build --target builder -t nft-vite-check .
sudo docker run --rm --name nft-vite-tests --network none --memory=6g --memory-swap=6g --cpus=6 \
  nft-vite-check npx vitest run --maxWorkers=4 "$@"
