// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// ---------------------------------------------------------------------------------------
//  [*] RejectingBuyer — a contract buyer that refuses the token it just bought
//
//  safeTransferFrom asks a contract recipient to acknowledge the token by returning the
//  magic selector. This one returns nonsense, so the ERC-721 rejects the transfer. The
//  purchase must unwind completely: no token moved, and the buyer's ETH still its own.
//
//  Used by:
//    - tests/Availability.t.sol
// ---------------------------------------------------------------------------------------

import {NftMarketplace} from "../../src/NftMarketplace.sol";

contract RejectingBuyer {

    NftMarketplace private immutable i_marketplace;

    constructor(NftMarketplace marketplace) {
        i_marketplace = marketplace;
    }

    receive() external payable {}

    function buy(address nftAddress, uint256 tokenId, uint256 price) external {
        i_marketplace.buyListing{value: price}(nftAddress, tokenId);
    }

    // Not IERC721Receiver.onERC721Received.selector — deliberately wrong
    function onERC721Received(
        address,
        address,
        uint256,
        bytes calldata
    ) external pure returns (bytes4) {
        return 0xdeadbeef;
    }
}
