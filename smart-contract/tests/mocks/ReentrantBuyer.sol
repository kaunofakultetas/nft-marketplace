// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// ---------------------------------------------------------------------------------------
//  [*] ReentrantBuyer — the attacker the reentrancy test needs
//
//  A contract buyer. Because buyListing ends in safeTransferFrom, the NFT contract calls
//  this contract's onERC721Received hook WHILE the marketplace is still mid-purchase —
//  the exact moment a reentrancy attack strikes. This one uses that moment to try buying
//  a SECOND, still-listed token: the attempt has to be refused by nonReentrant, and the
//  refusal bubbles back out, reverting the whole attack.
//
//  (Re-entering the SAME listing is stopped one layer earlier — the listing was already
//  deleted before the transfer, checks-effects-interactions — which is why the attack
//  targets a different token, to prove the guard itself works.)
//
//  Used by:
//    - tests/Reentrancy.t.sol
// ---------------------------------------------------------------------------------------

import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {NftMarketplace} from "../../src/NftMarketplace.sol";

contract ReentrantBuyer is IERC721Receiver {

    NftMarketplace private immutable i_marketplace;

    address private s_nftAddress;
    uint256 private s_reentryTokenId;
    uint256 private s_reentryPrice;

    constructor(NftMarketplace marketplace) {
        i_marketplace = marketplace;
    }

    receive() external payable {}

    // Buys `tokenId` honestly, having armed the hook below to
    // strike at `reentryTokenId` on the way in
    function attack(
        address nftAddress,
        uint256 tokenId,
        uint256 price,
        uint256 reentryTokenId,
        uint256 reentryPrice
    ) external payable {
        s_nftAddress = nftAddress;
        s_reentryTokenId = reentryTokenId;
        s_reentryPrice = reentryPrice;

        i_marketplace.buyListing{value: price}(nftAddress, tokenId);
    }

    // The marketplace is mid-purchase right now — buying anything
    // else must be refused
    function onERC721Received(
        address,
        address,
        uint256,
        bytes calldata
    ) external returns (bytes4) {
        i_marketplace.buyListing{value: s_reentryPrice}(s_nftAddress, s_reentryTokenId);
        return IERC721Receiver.onERC721Received.selector;
    }
}
