#!/bin/bash
############################################################
#  [*] Smart contract test runner
#
#  Builds the test image (see Dockerfile — Foundry plus the
#  pinned forge-std and OpenZeppelin sources, with the
#  contract and tests copied in) and runs the suite inside
#  it. The whole thing is self-contained: nothing is
#  installed on this host, nothing is written into this
#  folder, no network is needed at test time, and every
#  result is printed straight to this console.
#
#  The tests execute in Foundry's own in-process EVM: no
#  chain, no node, no wallet, no gas paid.
#
#  Run with NO arguments it only prints the options and
#  exits — nothing is built and nothing is run. `all` is the
#  everyday one; every other argument is handed straight to
#  `forge test`, so anything forge accepts works here.
#
#  -q is this script's own: it hides the docker build
#  chatter and every passing test, leaving the per-suite
#  results.
#
#  Colour is handled here too, because nothing inside the
#  container can work it out for itself — see STEP 3.
#
#  The first run downloads the image and clones the
#  dependencies into it (~1 min); later runs reuse the
#  cached layers and only recompile what changed.
############################################################

set -e
set -o pipefail
cd "$(dirname "$0")"

IMAGE="nft-marketplace-tests"




# STEP 1: no arguments means "tell me how to use this" — print the options and stop.
# The everyday one is marked, and emphasised when the terminal can show it.
# =================================================================================
if [ $# -eq 0 ]; then
    if [ -t 1 ]; then
        BOLD="\033[1m"
        DIM="\033[2m"
        RESET="\033[0m"
    else
        BOLD=""
        DIM=""
        RESET=""
    fi

    printf '\n==> Options\n\n'
    printf "  ${BOLD}→ ./runTests.sh all                 the whole suite, one line per test${RESET}\n"
    printf "  ${DIM}                                    ↑ the everyday one${RESET}\n\n"
    printf '    ./runTests.sh -q                  only the per-suite results\n'
    printf '    ./runTests.sh -vv                 + console logs written by the tests\n'
    printf '    ./runTests.sh -vvv                + execution traces for failing tests\n'
    printf '    ./runTests.sh -vvvv               + execution traces for every test\n\n'
    printf '    ./runTests.sh --match-path tests/Security.t.sol    one file\n'
    printf '    ./runTests.sh --match-test test_Attack_SellerBuys  one test\n'
    printf '    ./runTests.sh --gas-report        gas cost per contract function\n'
    printf '    ./runTests.sh --help              every flag forge test accepts\n\n'
    exit 0
fi




# STEP 2: this script's own arguments, peeled off before the rest goes to forge —
# -q for a quiet run, `all` for "no extra flags, just run everything".
# ==============================================================================
QUIET=0
if [ "$1" = "-q" ] || [ "$1" = "--quiet" ]; then
    QUIET=1
    shift
fi

if [ "$1" = "all" ]; then
    shift
fi




# STEP 3: colour. `docker run` gives the container a PIPE for stdout, never a
# terminal, so forge's own auto-detection can only ever decide against colour —
# the terminal it would need to ask about is out here. Forcing it on is skipped
# when this script's output is redirected, so a saved log stays free of escape
# codes, and skipped again if the caller passed a --color of their own.
# =============================================================================
COLOR=()
if [ -t 1 ]; then
    COLOR=(--color always)

    for arg in "$@"; do
        case "$arg" in
            --color*) COLOR=() ;;
        esac
    done
fi




# STEP 4: build, then run. Both are quietened together — a silent run that still
# printed twenty lines of docker layers would not be silent.
# ==============================================================================
if [ "$QUIET" = "1" ]; then
    sudo docker build -q -t "$IMAGE" . > /dev/null

    # Keep the suite verdicts, the failures and the final tally; drop the rest.
    # A failure line begins with the escape that paints it red, so the anchor has
    # to step over any colour before it looks for the word — without that, turning
    # colour on would quietly hide every failing test from this view
    ESC=$'\033'
    sudo docker run --rm "$IMAGE" test "${COLOR[@]}" "$@" \
        | grep -E "^(${ESC}\[[0-9;]*m)*(Ran |Suite result|Encountered|\[FAIL)" || true
else
    echo "==> Building the test image"
    sudo docker build -t "$IMAGE" .

    echo
    echo "==> Running the test suite"
    sudo docker run --rm "$IMAGE" test "${COLOR[@]}" "$@"
fi
