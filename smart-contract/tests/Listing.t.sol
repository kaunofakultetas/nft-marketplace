// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// ---------------------------------------------------------------------------------------
//  [*] Listing tests — listItem writes the listing, and refuses what it should
//
//  The marketplace never takes custody, so listing is only a promise backed by an
//  approval: these tests check the promise is recorded, announced, and never accepted
//  from someone who cannot keep it.
// ---------------------------------------------------------------------------------------

import {MarketplaceTestBase} from "./base/MarketplaceTestBase.sol";
import {
    NftMarketplace,
    NftMarketplace__PriceMustBeAboveZero,
    NftMarketplace__NotApprovedForMarketplace,
    NftMarketplace__AlreadyListed,
    NftMarketplace__NotOwner
} from "../src/NftMarketplace.sol";

contract ListingTest is MarketplaceTestBase {

    // The happy path: the listing is stored with its seller, and the event carries both
    function test_ListItem_StoresListingAndEmits() public {
        vm.prank(seller);
        nft.approve(address(marketplace), TOKEN_ID);

        vm.expectEmit(true, true, true, true);
        emit ItemListed(seller, address(nft), TOKEN_ID, PRICE);

        vm.prank(seller);
        marketplace.listItem(address(nft), TOKEN_ID, PRICE);

        NftMarketplace.Listing memory listing =
            marketplace.getListing(address(nft), TOKEN_ID);
        assertEq(listing.price, PRICE);
        assertEq(listing.seller, seller);
        // The marketplace never takes custody — the token stays put
        assertEq(nft.ownerOf(TOKEN_ID), seller);
    }

    // REGRESSION: the 2024 contract only accepted approve(), so a student who had used
    // setApprovalForAll was refused
    function test_ListItem_AcceptsSetApprovalForAll() public {
        vm.startPrank(seller);
        nft.setApprovalForAll(address(marketplace), true);
        marketplace.listItem(address(nft), TOKEN_ID, PRICE);
        vm.stopPrank();

        assertEq(marketplace.getListing(address(nft), TOKEN_ID).price, PRICE);
    }

    // Listing without any approval must be refused, not stored
    function test_ListItem_RevertsWithoutApproval() public {
        vm.expectRevert(NftMarketplace__NotApprovedForMarketplace.selector);
        vm.prank(seller);
        marketplace.listItem(address(nft), TOKEN_ID, PRICE);
    }

    // Price 0 is the "not listed" sentinel, so it can never be a real price
    function test_ListItem_RevertsOnZeroPrice() public {
        vm.prank(seller);
        nft.approve(address(marketplace), TOKEN_ID);

        vm.expectRevert(NftMarketplace__PriceMustBeAboveZero.selector);
        vm.prank(seller);
        marketplace.listItem(address(nft), TOKEN_ID, 0);
    }

    // Only the owner may sell it
    function test_ListItem_RevertsForNonOwner() public {
        vm.expectRevert(NftMarketplace__NotOwner.selector);
        vm.prank(stranger);
        marketplace.listItem(address(nft), TOKEN_ID, PRICE);
    }

    // Listing twice would silently overwrite the first listing
    function test_ListItem_RevertsIfAlreadyListed() public {
        _list(TOKEN_ID, PRICE);

        vm.expectRevert(
            abi.encodeWithSelector(
                NftMarketplace__AlreadyListed.selector, address(nft), TOKEN_ID
            )
        );
        vm.prank(seller);
        marketplace.listItem(address(nft), TOKEN_ID, PRICE);
    }
}
