FROM ghcr.io/foundry-rs/foundry:stable

USER root
WORKDIR /contract


####################################
######## Test dependencies #########
####################################
# Baked into the image so a test run needs no network and writes nothing to the host:
# forge-std (the test framework, whose own ds-test submodule must come along) and
# OpenZeppelin v5 (ERC721 for the mock NFT, ReentrancyGuard for the marketplace).
# Both pinned to a tag; git is installed only if the Foundry base image lacks it.
#
# OpenZeppelin's non-contract folders are deleted afterwards: certora/ and test/ hold
# verification harnesses that import files existing only in OpenZeppelin's own CI, and
# they are pure weight in an image that just needs ERC721.
RUN if ! command -v git >/dev/null 2>&1; then apk add --no-cache git; fi && \
    git clone --depth 1 --recurse-submodules --shallow-submodules --branch v1.9.6 \
        https://github.com/foundry-rs/forge-std lib/forge-std && \
    git clone --depth 1 --branch v5.4.0 \
        https://github.com/OpenZeppelin/openzeppelin-contracts lib/openzeppelin-contracts && \
    rm -rf lib/openzeppelin-contracts/certora \
           lib/openzeppelin-contracts/test \
           lib/openzeppelin-contracts/scripts \
           lib/openzeppelin-contracts/docs \
           lib/openzeppelin-contracts/.github \
           lib/openzeppelin-contracts/.git \
           lib/forge-std/.git


####################################
########## The project #############
####################################
# Config first: editing the contract or a test then rebuilds only the layers below,
# never the dependency clone above
COPY foundry.toml ./
COPY src ./src
COPY tests ./tests


# Compile at BUILD time — a contract that does not compile fails the build instead of
# failing every test, and the test run starts from a warm cache
RUN forge build


# `docker run <image>` runs the whole suite at the quietest useful verbosity; anything
# after the image name is passed straight to forge, e.g.
# `test --match-test test_BuyListing_RevertsOnReentrancy`
ENTRYPOINT ["forge"]
CMD ["test"]
