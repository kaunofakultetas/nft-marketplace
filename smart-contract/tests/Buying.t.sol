// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// ---------------------------------------------------------------------------------------
//  [*] Buy tests — exact payment, a live listing, and no way back in
//
//  The heart of the marketplace, and the only place a simulated EVM is truly required:
//  the stale-listing checks need a token to move behind the marketplace's back, and the
//  reentrancy test needs a contract buyer that strikes during safeTransferFrom.
// ---------------------------------------------------------------------------------------

import {MarketplaceTestBase} from "./base/MarketplaceTestBase.sol";
import {
    NftMarketplace__NotApprovedForMarketplace,
    NftMarketplace__ListingStale,
    NftMarketplace__PriceNotMet
} from "../src/NftMarketplace.sol";

contract BuyingTest is MarketplaceTestBase {

    // Token moves to the buyer, ETH is booked to the seller (not paid out yet), and the
    // event carries the seller the 2024 version omitted
    function test_BuyListing_TransfersTokenAndCreditsSeller() public {
        _list(TOKEN_ID, PRICE);

        vm.expectEmit(true, true, true, true);
        emit ItemBought(buyer, address(nft), TOKEN_ID, seller, PRICE);

        vm.prank(buyer);
        marketplace.buyListing{value: PRICE}(address(nft), TOKEN_ID);

        assertEq(nft.ownerOf(TOKEN_ID), buyer);
        assertEq(marketplace.getProceeds(seller), PRICE);
        assertEq(address(marketplace).balance, PRICE);
        assertEq(marketplace.getListing(address(nft), TOKEN_ID).price, 0);
    }

    // Paying less was always refused
    function test_BuyListing_RevertsOnUnderpayment() public {
        _list(TOKEN_ID, PRICE);

        vm.expectRevert(
            abi.encodeWithSelector(
                NftMarketplace__PriceNotMet.selector, address(nft), TOKEN_ID, PRICE
            )
        );
        vm.prank(buyer);
        marketplace.buyListing{value: PRICE - 1}(address(nft), TOKEN_ID);
    }

    // REGRESSION: the 2024 contract accepted an overpayment and credited the whole
    // msg.value to the seller while announcing the listing price
    function test_BuyListing_RevertsOnOverpayment() public {
        _list(TOKEN_ID, PRICE);

        vm.expectRevert(
            abi.encodeWithSelector(
                NftMarketplace__PriceNotMet.selector, address(nft), TOKEN_ID, PRICE
            )
        );
        vm.prank(buyer);
        marketplace.buyListing{value: PRICE + 1}(address(nft), TOKEN_ID);
    }

    // REGRESSION: a listing whose seller moved the token used to fail with a bare
    // ERC-721 revert from inside the token contract
    function test_BuyListing_RevertsWhenSellerNoLongerOwnsTheToken() public {
        _list(TOKEN_ID, PRICE);

        vm.prank(seller);
        nft.transferFrom(seller, stranger, TOKEN_ID);

        vm.expectRevert(
            abi.encodeWithSelector(
                NftMarketplace__ListingStale.selector, address(nft), TOKEN_ID
            )
        );
        vm.prank(buyer);
        marketplace.buyListing{value: PRICE}(address(nft), TOKEN_ID);
    }

    // Same for the other way a listing goes stale
    function test_BuyListing_RevertsWhenApprovalWasRevoked() public {
        _list(TOKEN_ID, PRICE);

        vm.prank(seller);
        nft.approve(address(0), TOKEN_ID);

        vm.expectRevert(NftMarketplace__NotApprovedForMarketplace.selector);
        vm.prank(buyer);
        marketplace.buyListing{value: PRICE}(address(nft), TOKEN_ID);
    }

    // Any payment that is not exactly the price is refused, whatever the numbers
    function testFuzz_BuyListing_RequiresExactPayment(uint96 rawPrice, uint96 rawPayment)
        public
    {
        uint256 price = _bound(uint256(rawPrice), 1, 50 ether);
        uint256 payment = _bound(uint256(rawPayment), 0, 50 ether);
        vm.assume(payment != price);

        _list(TOKEN_ID, price);
        vm.deal(buyer, payment);

        vm.expectRevert(
            abi.encodeWithSelector(
                NftMarketplace__PriceNotMet.selector, address(nft), TOKEN_ID, price
            )
        );
        vm.prank(buyer);
        marketplace.buyListing{value: payment}(address(nft), TOKEN_ID);
    }
}
