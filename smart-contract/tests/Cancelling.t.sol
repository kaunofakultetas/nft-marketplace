// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// ---------------------------------------------------------------------------------------
//  [*] Cancel tests — taking a listing back off the market
//
//  Cancelling is guarded by CURRENT ownership rather than by seller, on purpose: that is
//  what lets someone clean up a listing they inherited together with the token.
// ---------------------------------------------------------------------------------------

import {MarketplaceTestBase} from "./base/MarketplaceTestBase.sol";

contract CancellingTest is MarketplaceTestBase {

    // The listing is gone afterwards, and the event names who removed it
    function test_CancelListing_ClearsListingAndEmits() public {
        _list(TOKEN_ID, PRICE);

        vm.expectEmit(true, true, true, false);
        emit ItemCanceled(seller, address(nft), TOKEN_ID);

        vm.prank(seller);
        marketplace.cancelListing(address(nft), TOKEN_ID);

        assertEq(marketplace.getListing(address(nft), TOKEN_ID).price, 0);
    }

    // The deliberate escape hatch for stale listings
    function test_CancelListing_NewOwnerCanClearInheritedListing() public {
        _list(TOKEN_ID, PRICE);

        vm.prank(seller);
        nft.transferFrom(seller, stranger, TOKEN_ID);

        vm.prank(stranger);
        marketplace.cancelListing(address(nft), TOKEN_ID);

        assertEq(marketplace.getListing(address(nft), TOKEN_ID).price, 0);
    }
}
