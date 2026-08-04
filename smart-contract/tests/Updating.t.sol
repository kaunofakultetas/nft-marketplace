// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// ---------------------------------------------------------------------------------------
//  [*] Update tests — a reprice changes the price and nothing else
//
//  The important one here is the EVENT: a reprice announces ItemUpdated, never
//  ItemListed. The backend indexer counts on that distinction, and the 2024 contract
//  did not provide it.
// ---------------------------------------------------------------------------------------

import {MarketplaceTestBase} from "./base/MarketplaceTestBase.sol";
import {
    NftMarketplace__PriceMustBeAboveZero,
    NftMarketplace__NotSeller,
    NftMarketplace__NotApprovedForMarketplace
} from "../src/NftMarketplace.sol";

contract UpdatingTest is MarketplaceTestBase {

    // REGRESSION: the 2024 contract re-emitted ItemListed, leaving the indexer unable to
    // tell a reprice from a new listing (30 real listings looked like 40)
    function test_UpdateListing_EmitsItemUpdatedNotItemListed() public {
        _list(TOKEN_ID, PRICE);

        vm.expectEmit(true, true, true, true);
        emit ItemUpdated(seller, address(nft), TOKEN_ID, 2 ether);

        vm.prank(seller);
        marketplace.updateListing(address(nft), TOKEN_ID, 2 ether);

        assertEq(marketplace.getListing(address(nft), TOKEN_ID).price, 2 ether);
    }

    // A new owner inheriting a listing must not be able to reprice it: the proceeds would
    // still be routed to the previous owner
    function test_UpdateListing_RevertsForOwnerWhoIsNotTheSeller() public {
        _list(TOKEN_ID, PRICE);

        vm.prank(seller);
        nft.transferFrom(seller, stranger, TOKEN_ID);

        vm.expectRevert(NftMarketplace__NotSeller.selector);
        vm.prank(stranger);
        marketplace.updateListing(address(nft), TOKEN_ID, 2 ether);
    }

    // Zero is the not-listed sentinel here too
    function test_UpdateListing_RevertsOnZeroPrice() public {
        _list(TOKEN_ID, PRICE);

        vm.expectRevert(NftMarketplace__PriceMustBeAboveZero.selector);
        vm.prank(seller);
        marketplace.updateListing(address(nft), TOKEN_ID, 0);
    }

    // updateListing re-checks the approval, and nothing else in the suite exercises that
    // branch: a seller who revoked it must not be able to keep advertising a price the
    // marketplace could never honour
    function test_UpdateListing_RevertsWhenApprovalWasRevoked() public {
        _list(TOKEN_ID, PRICE);

        vm.prank(seller);
        nft.approve(address(0), TOKEN_ID);

        vm.expectRevert(NftMarketplace__NotApprovedForMarketplace.selector);
        vm.prank(seller);
        marketplace.updateListing(address(nft), TOKEN_ID, 2 ether);

        // ...and the old price survives the refusal untouched
        assertEq(marketplace.getListing(address(nft), TOKEN_ID).price, PRICE);
    }
}
