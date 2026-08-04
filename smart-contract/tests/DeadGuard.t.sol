// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// ---------------------------------------------------------------------------------------
//  [*] Dead-guard tests — the bug that made the 2024 contract lie
//
//  REGRESSION, all three. The 2024 isListed modifier compared a uint256 against < 0 and
//  therefore enforced NOTHING: every function it guarded happily ran on tokens that had
//  never been listed. The worst of them is updateListing, which could CREATE a listing
//  that had never been approved — the GUI then showed it as buyable, and buying it
//  failed deep inside the token contract.
//
//  If any test in this file ever fails, that bug is back.
// ---------------------------------------------------------------------------------------

import {MarketplaceTestBase} from "./base/MarketplaceTestBase.sol";
import {NftMarketplace__NotListed} from "../src/NftMarketplace.sol";

contract DeadGuardTest is MarketplaceTestBase {

    // Buying something nobody listed
    function test_BuyListing_RevertsIfNotListed() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                NftMarketplace__NotListed.selector, address(nft), TOKEN_ID
            )
        );
        vm.prank(buyer);
        marketplace.buyListing{value: PRICE}(address(nft), TOKEN_ID);
    }

    // Cancelling something nobody listed (the 2024 contract emitted a real event for it)
    function test_CancelListing_RevertsIfNotListed() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                NftMarketplace__NotListed.selector, address(nft), TOKEN_ID
            )
        );
        vm.prank(seller);
        marketplace.cancelListing(address(nft), TOKEN_ID);
    }

    // The dangerous one: repricing a token that was never listed used to CREATE a
    // listing, skipping the approval check that listItem enforces
    function test_UpdateListing_RevertsIfNotListed() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                NftMarketplace__NotListed.selector, address(nft), TOKEN_ID
            )
        );
        vm.prank(seller);
        marketplace.updateListing(address(nft), TOKEN_ID, PRICE);
    }
}
