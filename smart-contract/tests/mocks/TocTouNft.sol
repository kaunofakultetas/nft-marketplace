// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// ---------------------------------------------------------------------------------------
//  [*] TocTouNft — a collection that gives two different answers in one transaction
//
//  buyListing asks ownerOf TWICE: once for the stale check, and once more inside the
//  approval check, which looks up isApprovedForAll(ownerOf(tokenId), marketplace). Time
//  of check is not time of use, and the collection is free to change its mind in between.
//
//  Both calls are STATICCALLs, so this mock cannot count them in storage — it branches on
//  gasleft() instead, which drops monotonically through a transaction and is therefore a
//  perfectly good clock. To make that clock readable it first burns a THIRD of whatever
//  gas it was handed, so consecutive answers sit far apart rather than a few hundred gas
//  apart; the round cap keeps an ordinary uncapped call (listing the token, say) from
//  burning hundreds of millions of gas.
//
//  getApproved deliberately names NOBODY: had it named the marketplace, the short-circuit
//  in the approval check would stop buyListing from asking ownerOf a second time at all.
//  Approval is a real little registry here, so the second answer decides WHOSE approval
//  the marketplace ends up reading.
//
//  Used by:
//    - tests/HostileToken.t.sol
// ---------------------------------------------------------------------------------------

contract TocTouNft {

    uint256 private constant MAX_BURN_ROUNDS = 3_000;

    address private immutable i_impostor;

    mapping(uint256 => address) private s_realOwner;
    mapping(address => bool) private s_approvedTheMarketplace;

    // Below this much remaining gas, ownerOf switches to naming the impostor. Zero — the
    // default — means it tells the truth every time, which is what listing the token
    // in the first place needs.
    uint256 private s_flipBelowGas;

    constructor(address impostor) {
        i_impostor = impostor;
    }

    function mint(address to, uint256 tokenId) external {
        s_realOwner[tokenId] = to;
    }

    function setFlipBelowGas(uint256 threshold) external {
        s_flipBelowGas = threshold;
    }

    function setApproval(address owner, bool approved) external {
        s_approvedTheMarketplace[owner] = approved;
    }

    function realOwnerOf(uint256 tokenId) external view returns (address) {
        return s_realOwner[tokenId];
    }


    // --- everything below is what the marketplace sees ---

    function ownerOf(uint256 tokenId) external view returns (address) {
        uint256 sink = _burnAThirdOfTheGas();
        address truth = s_realOwner[tokenId];

        // Never taken. It exists only so the burn feeds the return value and cannot be
        // deleted as dead code.
        if (sink == type(uint256).max) {
            return address(0);
        }

        return gasleft() > s_flipBelowGas ? truth : i_impostor;
    }

    function getApproved(uint256) external pure returns (address) {
        return address(0);
    }

    function isApprovedForAll(address owner, address) external view returns (bool) {
        return s_approvedTheMarketplace[owner];
    }

    function safeTransferFrom(address, address to, uint256 tokenId) external {
        s_realOwner[tokenId] = to;
    }

    // Burning a FRACTION rather than a fixed amount keeps the gap between two consecutive
    // answers proportional to whatever budget the caller allowed, so a test does not have
    // to guess absolute gas figures to land between them
    function _burnAThirdOfTheGas() private view returns (uint256 sink) {
        uint256 startGas = gasleft();
        uint256 floorGas = startGas - startGas / 3;

        for (uint256 i = 0; i < MAX_BURN_ROUNDS && gasleft() > floorGas; ++i) {
            sink = uint256(keccak256(abi.encodePacked(sink, i)));
        }
    }
}
