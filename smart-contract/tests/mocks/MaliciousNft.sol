// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// ---------------------------------------------------------------------------------------
//  [*] MaliciousNft — a hostile ERC-721, the marketplace's biggest blind spot
//
//  The marketplace trades whatever nftAddress it is handed, so every purchase calls FOUR
//  functions on a stranger's contract. This mock is that stranger, in three flavours:
//
//    SkipTransfer        safeTransferFrom silently does nothing. The buyer pays and the
//                        token never moves — theft, unless the marketplace verifies.
//    LieAboutOwnership   the transfer does nothing either, but ownerOf then reports the
//                        buyer. Nothing on-chain can see through this; realOwnerOf()
//                        exposes the truth to the test.
//    ReenterMarketplace  safeTransferFrom calls straight back into buyListing for a
//                        second token, while the first sale is still open.
//
//  Only the four functions the marketplace actually calls are implemented — ownerOf,
//  getApproved, isApprovedForAll and the 3-argument safeTransferFrom.
//
//  Used by:
//    - tests/HostileToken.t.sol
//    - tests/Reentrancy.t.sol
// ---------------------------------------------------------------------------------------

import {NftMarketplace} from "../../src/NftMarketplace.sol";

contract MaliciousNft {

    enum Mode {
        SkipTransfer,
        LieAboutOwnership,
        ReenterMarketplace
    }

    Mode private immutable i_mode;
    NftMarketplace private immutable i_marketplace;

    mapping(uint256 => address) private s_realOwner;
    mapping(uint256 => address) private s_claimedOwner;

    uint256 private s_reentryTokenId;
    uint256 private s_reentryPrice;

    constructor(Mode mode, NftMarketplace marketplace) {
        i_mode = mode;
        i_marketplace = marketplace;
    }

    receive() external payable {}

    function mint(address to, uint256 tokenId) external {
        s_realOwner[tokenId] = to;
    }

    // Which listing the ReenterMarketplace flavour reaches for mid-sale
    function armReentry(uint256 tokenId, uint256 price) external {
        s_reentryTokenId = tokenId;
        s_reentryPrice = price;
    }

    // What the tests use to see past the lie
    function realOwnerOf(uint256 tokenId) external view returns (address) {
        return s_realOwner[tokenId];
    }


    // --- everything below is what the marketplace sees ---

    function ownerOf(uint256 tokenId) external view returns (address) {
        address claimed = s_claimedOwner[tokenId];
        return claimed == address(0) ? s_realOwner[tokenId] : claimed;
    }

    // Always "approved", so listItem never gets in the way of the real experiment
    function getApproved(uint256) external view returns (address) {
        return address(i_marketplace);
    }

    function isApprovedForAll(address, address) external pure returns (bool) {
        return false;
    }

    function safeTransferFrom(address, address to, uint256 tokenId) external {
        if (i_mode == Mode.SkipTransfer) {
            return;
        }

        if (i_mode == Mode.LieAboutOwnership) {
            s_claimedOwner[tokenId] = to;
            return;
        }

        i_marketplace.buyListing{value: s_reentryPrice}(address(this), s_reentryTokenId);
    }
}
