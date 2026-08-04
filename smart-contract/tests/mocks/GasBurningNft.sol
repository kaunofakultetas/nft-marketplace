// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// ---------------------------------------------------------------------------------------
//  [*] GasBurningNft — a collection whose ownerOf costs a fortune to ask
//
//  Every guard in the marketplace asks the collection who owns a token, and the
//  collection alone decides what that answer costs. This one answers truthfully, but only
//  after burning millions of gas in a keccak loop: a STATICCALL cannot write state, yet
//  nothing stops it from spending. Burning is armed by a separate call because the
//  interesting case is a collection that behaves perfectly while it is being listed and
//  turns expensive only afterwards.
//
//  The tests drive it through gas-capped low-level calls. The point is not that the bomb
//  goes off — it is that the blast is confined to this collection's own listings.
//
//  Used by:
//    - tests/HostileToken.t.sol
// ---------------------------------------------------------------------------------------

import {NftMarketplace} from "../../src/NftMarketplace.sol";

contract GasBurningNft {

    // Several million gas per answer: far past any budget a caller would sanely lend
    uint256 private constant BURN_ROUNDS = 50_000;

    NftMarketplace private immutable i_marketplace;

    mapping(uint256 => address) private s_realOwner;
    bool private s_burning;

    constructor(NftMarketplace marketplace) {
        i_marketplace = marketplace;
    }

    function mint(address to, uint256 tokenId) external {
        s_realOwner[tokenId] = to;
    }

    function setBurning(bool on) external {
        s_burning = on;
    }

    function realOwnerOf(uint256 tokenId) external view returns (address) {
        return s_realOwner[tokenId];
    }


    // --- everything below is what the marketplace sees ---

    function ownerOf(uint256 tokenId) external view returns (address) {
        if (s_burning) {
            uint256 sink;
            for (uint256 i = 0; i < BURN_ROUNDS; ++i) {
                sink = uint256(keccak256(abi.encodePacked(sink, i)));
            }
            // Never taken. It exists only so the loop feeds the return value and the
            // optimiser cannot delete the whole thing as dead code.
            if (sink == 0) {
                return address(0);
            }
        }
        return s_realOwner[tokenId];
    }

    function getApproved(uint256) external view returns (address) {
        return address(i_marketplace);
    }

    function isApprovedForAll(address, address) external pure returns (bool) {
        return false;
    }

    function safeTransferFrom(address, address to, uint256 tokenId) external {
        s_realOwner[tokenId] = to;
    }
}
