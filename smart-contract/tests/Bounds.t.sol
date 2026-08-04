// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// ---------------------------------------------------------------------------------------
//  [*] Bounds tests — the numeric and identifier edges that break naive code
//
//  Nothing in this marketplace carries an upper limit: a price of one wei and a price of
//  2^256-1 are equally legal, and a tokenId is a full 256-bit word rather than a counter
//  that stops at a few thousand. Truncation to a smaller type, an off-by-one in a
//  comparison, or a listing keyed by only HALF of (collection, tokenId) would all pass
//  the ordinary suites and only show up at the edges probed here.
//
//  Covers:
//    - a price of type(uint256).max: listable, unpayable, still cancellable
//    - a price of one wei: a genuine sale, with exact payment still enforced
//    - tokenId 0 and tokenId type(uint256).max behaving like any other id
//    - the same tokenId in two collections staying two independent listings
//    - proceeds accumulating exactly across many sales, never overflowing
//    - fuzzed prices and fuzzed ids round-tripping through list / buy / cancel
//    - ids that collide across collections once the tokens have changed hands
// ---------------------------------------------------------------------------------------

import {MarketplaceTestBase} from "./base/MarketplaceTestBase.sol";
import {MockNft} from "./mocks/MockNft.sol";
import {
    NftMarketplace,
    NftMarketplace__AlreadyListed,
    NftMarketplace__PriceNotMet
} from "../src/NftMarketplace.sol";

contract BoundsTest is MarketplaceTestBase {

    uint256 private constant MAX_PRICE = type(uint256).max;
    uint256 private constant MAX_TOKEN_ID = type(uint256).max;
    uint256 private constant SHARED_TOKEN_ID = 5;
    uint256 private constant COLLIDING_TOKEN_ID = 9;


    // The fixture's _list only ever speaks for the shared collection and the shared
    // seller; the cross-collection tests need any owner to list on any collection
    function _listAs(
        MockNft collection,
        address owner,
        uint256 tokenId,
        uint256 price
    ) private {
        vm.startPrank(owner);
        collection.approve(address(marketplace), tokenId);
        marketplace.listItem(address(collection), tokenId, price);
        vm.stopPrank();
    }

    // The exact PriceNotMet payload for one listing, so a bounds test can demand the
    // RIGHT refusal rather than accept any revert at all
    function _priceNotMet(
        address collection,
        uint256 tokenId,
        uint256 price
    ) private pure returns (bytes memory) {
        return abi.encodeWithSelector(
            NftMarketplace__PriceNotMet.selector, collection, tokenId, price
        );
    }


    // The largest number the EVM has must survive being stored and read back untouched,
    // and a listing nobody on earth could pay for must still be retractable — otherwise
    // a fat-fingered price would lock the token out of the market for good
    function test_MaxPrice_ListsSafelyAndStaysCancellable() public {
        _list(TOKEN_ID, MAX_PRICE);

        NftMarketplace.Listing memory listing =
            marketplace.getListing(address(nft), TOKEN_ID);
        assertEq(listing.price, MAX_PRICE, "the asking price did not survive storage");
        assertEq(listing.seller, seller);

        // No wallet can ever hold 2^256-1 wei, so every payment that CAN be made is
        // refused — and refused quoting the real price, not a truncated one
        bytes memory refusal = _priceNotMet(address(nft), TOKEN_ID, MAX_PRICE);

        vm.expectRevert(refusal);
        vm.prank(buyer);
        marketplace.buyListing{value: 100 ether}(address(nft), TOKEN_ID);

        vm.expectRevert(refusal);
        vm.prank(buyer);
        marketplace.buyListing{value: 1}(address(nft), TOKEN_ID);

        assertEq(marketplace.getProceeds(seller), 0, "a refused buy credited someone");
        assertEq(address(marketplace).balance, 0);
        assertEq(nft.ownerOf(TOKEN_ID), seller);

        vm.prank(seller);
        marketplace.cancelListing(address(nft), TOKEN_ID);

        listing = marketplace.getListing(address(nft), TOKEN_ID);
        assertEq(listing.price, 0, "the extreme listing could not be cancelled");
        assertEq(listing.seller, address(0), "a cleared listing kept its seller");
    }

    // The way out of an extreme price is a reprice, and it must leave no residue of the
    // old number behind: the sale that follows pays the new price and only the new price
    function test_MaxPrice_RepricedDownBecomesBuyableAgain() public {
        _list(TOKEN_ID, MAX_PRICE);

        vm.prank(seller);
        marketplace.updateListing(address(nft), TOKEN_ID, PRICE);

        assertEq(marketplace.getListing(address(nft), TOKEN_ID).price, PRICE);

        vm.prank(buyer);
        marketplace.buyListing{value: PRICE}(address(nft), TOKEN_ID);

        assertEq(nft.ownerOf(TOKEN_ID), buyer);
        assertEq(marketplace.getProceeds(seller), PRICE);
        assertEq(address(marketplace).balance, PRICE);
    }

    // One wei is the smallest legal price — the very next value above the "not listed"
    // sentinel. It must behave like any other sale, and exact payment must still hold at
    // a scale where a single wei either way is the whole difference
    function test_OneWeiPrice_IsARealSaleAndStillNeedsExactPayment() public {
        _list(TOKEN_ID, 1);

        bytes memory refusal = _priceNotMet(address(nft), TOKEN_ID, 1);

        vm.expectRevert(refusal);
        vm.prank(buyer);
        marketplace.buyListing{value: 0}(address(nft), TOKEN_ID);

        vm.expectRevert(refusal);
        vm.prank(buyer);
        marketplace.buyListing{value: 2}(address(nft), TOKEN_ID);

        uint256 sellerBefore = seller.balance;

        vm.prank(buyer);
        marketplace.buyListing{value: 1}(address(nft), TOKEN_ID);

        assertEq(nft.ownerOf(TOKEN_ID), buyer);
        assertEq(marketplace.getProceeds(seller), 1);

        vm.prank(seller);
        marketplace.withdrawProceeds();

        assertEq(seller.balance, sellerBefore + 1, "one wei went missing on the way out");
        assertEq(address(marketplace).balance, 0);
    }

    // Both ends of the id space at once: id 0 is the value a "does this exist?" check is
    // most likely to confuse with nothing, and 2^256-1 is the value a smaller type would
    // silently truncate. Neither may behave differently from an ordinary id
    function test_TokenIdZeroAndMaxTokenIdBehaveIdentically() public {
        nft.mint(seller, MAX_TOKEN_ID);

        _list(TOKEN_ID, PRICE);
        _list(MAX_TOKEN_ID, PRICE);

        assertEq(marketplace.getListing(address(nft), TOKEN_ID).seller, seller);
        assertEq(marketplace.getListing(address(nft), MAX_TOKEN_ID).seller, seller);

        vm.startPrank(buyer);
        marketplace.buyListing{value: PRICE}(address(nft), TOKEN_ID);
        marketplace.buyListing{value: PRICE}(address(nft), MAX_TOKEN_ID);
        vm.stopPrank();

        assertEq(nft.ownerOf(TOKEN_ID), buyer);
        assertEq(nft.ownerOf(MAX_TOKEN_ID), buyer);
        assertEq(marketplace.getProceeds(seller), 2 * PRICE);
        assertEq(marketplace.getListing(address(nft), TOKEN_ID).price, 0);
        assertEq(marketplace.getListing(address(nft), MAX_TOKEN_ID).price, 0);
    }

    // The tokenId also rides in an indexed event topic, which is the only form the
    // backend indexer ever sees it in. An extreme id must come back out of the log
    // exactly as it went in, and the reprice / cancel path must accept it too
    function test_MaxTokenId_SurvivesEventsRepriceAndCancel() public {
        nft.mint(seller, MAX_TOKEN_ID);

        vm.prank(seller);
        nft.approve(address(marketplace), MAX_TOKEN_ID);

        vm.expectEmit(true, true, true, true);
        emit ItemListed(seller, address(nft), MAX_TOKEN_ID, PRICE);

        vm.prank(seller);
        marketplace.listItem(address(nft), MAX_TOKEN_ID, PRICE);

        vm.expectEmit(true, true, true, true);
        emit ItemUpdated(seller, address(nft), MAX_TOKEN_ID, 3 ether);

        vm.prank(seller);
        marketplace.updateListing(address(nft), MAX_TOKEN_ID, 3 ether);

        assertEq(marketplace.getListing(address(nft), MAX_TOKEN_ID).price, 3 ether);

        vm.expectEmit(true, true, true, false);
        emit ItemCanceled(seller, address(nft), MAX_TOKEN_ID);

        vm.prank(seller);
        marketplace.cancelListing(address(nft), MAX_TOKEN_ID);

        assertEq(marketplace.getListing(address(nft), MAX_TOKEN_ID).price, 0);
    }

    // Ids are only unique WITHIN a collection, and almost every collection starts at 0 —
    // so the same id in two collections is the normal case, not an exotic one. A listing
    // keyed by tokenId alone would let one collection's sale consume the other's listing
    function test_SameTokenId_InTwoCollectionsAreIndependentListings() public {
        MockNft second = new MockNft();

        nft.mint(seller, SHARED_TOKEN_ID);
        second.mint(stranger, SHARED_TOKEN_ID);

        _list(SHARED_TOKEN_ID, PRICE);
        _listAs(second, stranger, SHARED_TOKEN_ID, 2 * PRICE);

        NftMarketplace.Listing memory first =
            marketplace.getListing(address(nft), SHARED_TOKEN_ID);
        NftMarketplace.Listing memory other =
            marketplace.getListing(address(second), SHARED_TOKEN_ID);

        assertEq(first.price, PRICE);
        assertEq(first.seller, seller);
        assertEq(other.price, 2 * PRICE);
        assertEq(other.seller, stranger);

        // One collection's price must never be accepted for the other's token
        vm.expectRevert(_priceNotMet(address(nft), SHARED_TOKEN_ID, PRICE));
        vm.prank(buyer);
        marketplace.buyListing{value: 2 * PRICE}(address(nft), SHARED_TOKEN_ID);

        // The listing above already proves an id busy in one collection is free in the
        // other; the SAME id in the SAME collection must still be refused
        vm.expectRevert(
            abi.encodeWithSelector(
                NftMarketplace__AlreadyListed.selector, address(nft), SHARED_TOKEN_ID
            )
        );
        vm.prank(seller);
        marketplace.listItem(address(nft), SHARED_TOKEN_ID, PRICE);

        // Cancelling one leaves the other exactly where it was
        vm.prank(seller);
        marketplace.cancelListing(address(nft), SHARED_TOKEN_ID);

        assertEq(marketplace.getListing(address(nft), SHARED_TOKEN_ID).price, 0);
        assertEq(
            marketplace.getListing(address(second), SHARED_TOKEN_ID).price, 2 * PRICE
        );

        // Buying the survivor pays ITS seller and nobody else
        vm.prank(buyer);
        marketplace.buyListing{value: 2 * PRICE}(address(second), SHARED_TOKEN_ID);

        assertEq(second.ownerOf(SHARED_TOKEN_ID), buyer);
        assertEq(nft.ownerOf(SHARED_TOKEN_ID), seller, "the wrong token moved");
        assertEq(marketplace.getProceeds(stranger), 2 * PRICE);
        assertEq(marketplace.getProceeds(seller), 0, "the wrong seller was paid");
    }

    // The other half of the same key: two ids inside ONE collection must not share a
    // listing either, whichever of the two is touched first
    function test_TwoTokenIds_InOneCollectionAreIndependentListings() public {
        _list(TOKEN_ID, PRICE);
        _list(OTHER_TOKEN_ID, 2 * PRICE);

        vm.prank(seller);
        marketplace.cancelListing(address(nft), TOKEN_ID);

        assertEq(marketplace.getListing(address(nft), TOKEN_ID).price, 0);
        assertEq(marketplace.getListing(address(nft), OTHER_TOKEN_ID).price, 2 * PRICE);

        vm.prank(buyer);
        marketplace.buyListing{value: 2 * PRICE}(address(nft), OTHER_TOKEN_ID);

        assertEq(nft.ownerOf(OTHER_TOKEN_ID), buyer);
        assertEq(nft.ownerOf(TOKEN_ID), seller, "the cancelled token moved anyway");
        assertEq(marketplace.getProceeds(seller), 2 * PRICE);
    }

    // Proceeds are the one number that GROWS without ever being reset until a withdrawal.
    // Across a run of sales priced from a single wei to several ether the running total
    // must stay exact — a rounding step or a narrower accumulator would show up here
    function test_Proceeds_AccumulateExactlyAcrossManySales() public {
        uint256[6] memory prices =
            [uint256(1), 3, 1 gwei, 0.25 ether, 1 ether, 3 ether];

        uint256 expected;

        for (uint256 i = 0; i < prices.length; i++) {
            uint256 tokenId = 100 + i;
            nft.mint(seller, tokenId);
            _list(tokenId, prices[i]);

            vm.prank(buyer);
            marketplace.buyListing{value: prices[i]}(address(nft), tokenId);

            expected += prices[i];
            assertEq(
                marketplace.getProceeds(seller),
                expected,
                "the proceeds drifted mid-run"
            );
        }

        assertEq(address(marketplace).balance, expected);

        uint256 sellerBefore = seller.balance;

        vm.prank(seller);
        marketplace.withdrawProceeds();

        assertEq(seller.balance, sellerBefore + expected, "the payout was not exact");
        assertEq(marketplace.getProceeds(seller), 0);
        assertEq(address(marketplace).balance, 0);
    }

    // A listing records WHO gets paid at listing time, so a token that changes hands
    // afterwards is the classic way for money to reach the wrong address. The previous
    // owner must earn nothing from a sale made by the new one
    function test_TransferChain_PaysTheNewOwnerAndNeverThePreviousOne() public {
        _list(TOKEN_ID, PRICE);

        vm.prank(seller);
        nft.transferFrom(seller, stranger, TOKEN_ID);

        // The inherited listing has to be cleared before the new owner can sell
        vm.prank(stranger);
        marketplace.cancelListing(address(nft), TOKEN_ID);

        _listAs(nft, stranger, TOKEN_ID, 3 ether);

        vm.prank(buyer);
        marketplace.buyListing{value: 3 ether}(address(nft), TOKEN_ID);

        assertEq(nft.ownerOf(TOKEN_ID), buyer);
        assertEq(marketplace.getProceeds(stranger), 3 ether);
        assertEq(marketplace.getProceeds(seller), 0, "the previous owner was paid");
    }

    // PROPERTY: whoever the ETH goes to must be whoever owned the token at the moment of
    // the sale. A listing left standing while the token makes a round trip out and back
    // becomes live again, so either the marketplace refuses it or it pays the current
    // owner — what it must never do is pay the wallet that merely held it in between.
    function test_TransferRoundTrip_PaysWhoeverOwnedTheTokenAtSaleTime() public {
        _list(TOKEN_ID, PRICE);

        vm.prank(seller);
        nft.transferFrom(seller, stranger, TOKEN_ID);
        vm.prank(stranger);
        nft.transferFrom(stranger, seller, TOKEN_ID);

        // Each transfer clears the token's approval, so the listing needs a fresh one
        vm.prank(seller);
        nft.approve(address(marketplace), TOKEN_ID);

        address ownerAtSaleTime = nft.ownerOf(TOKEN_ID);
        uint256 buyerBefore = buyer.balance;

        vm.prank(buyer);
        try marketplace.buyListing{value: PRICE}(address(nft), TOKEN_ID) {
            assertEq(nft.ownerOf(TOKEN_ID), buyer, "the buyer paid and got nothing");
            assertEq(marketplace.getProceeds(ownerAtSaleTime), PRICE);
        } catch {
            // Refusing a listing that outlived a transfer is equally safe
            assertEq(buyer.balance, buyerBefore, "the buy failed but the ETH moved");
            assertEq(nft.ownerOf(TOKEN_ID), seller);
        }

        // Either way the wallet that only passed the token through earns nothing
        assertEq(marketplace.getProceeds(stranger), 0, "the middleman was paid");
    }

    // The two edges combined: the same id in two collections, one of which has already
    // changed hands, so the recorded sellers differ AND the ids match. Paying for one
    // must credit that collection's seller and leave the twin listing untouched
    function test_CollidingIds_AfterATransferChainStillPayTheRightSeller() public {
        MockNft second = new MockNft();

        nft.mint(seller, COLLIDING_TOKEN_ID);
        second.mint(stranger, COLLIDING_TOKEN_ID);

        _list(COLLIDING_TOKEN_ID, PRICE);

        vm.prank(stranger);
        second.transferFrom(stranger, buyer, COLLIDING_TOKEN_ID);
        _listAs(second, buyer, COLLIDING_TOKEN_ID, 4 ether);

        assertEq(
            marketplace.getListing(address(nft), COLLIDING_TOKEN_ID).seller, seller
        );
        assertEq(
            marketplace.getListing(address(second), COLLIDING_TOKEN_ID).seller, buyer
        );

        vm.deal(stranger, 10 ether);
        vm.prank(stranger);
        marketplace.buyListing{value: PRICE}(address(nft), COLLIDING_TOKEN_ID);

        assertEq(nft.ownerOf(COLLIDING_TOKEN_ID), stranger);
        assertEq(second.ownerOf(COLLIDING_TOKEN_ID), buyer, "the twin token moved");
        assertEq(marketplace.getProceeds(seller), PRICE);
        assertEq(marketplace.getProceeds(buyer), 0, "the twin's seller was paid");
        assertEq(
            marketplace.getListing(address(second), COLLIDING_TOKEN_ID).price, 4 ether
        );
    }

    // Any price at all must reach the seller intact: nothing skimmed on the way in, on
    // the way out, or lost to rounding in between
    function testFuzz_Price_RoundTripsExactlyThroughListBuyWithdraw(uint96 rawPrice)
        public
    {
        uint256 price = _bound(uint256(rawPrice), 1, 50 ether);

        _list(TOKEN_ID, price);
        vm.deal(buyer, price);

        uint256 sellerBefore = seller.balance;

        vm.prank(buyer);
        marketplace.buyListing{value: price}(address(nft), TOKEN_ID);

        assertEq(buyer.balance, 0, "the buyer paid something other than the price");
        assertEq(marketplace.getProceeds(seller), price);

        vm.prank(seller);
        marketplace.withdrawProceeds();

        assertEq(seller.balance, sellerBefore + price, "the seller was short-changed");
        assertEq(marketplace.getProceeds(seller), 0);
        assertEq(address(marketplace).balance, 0);
    }

    // The whole 256-bit id space, not just the small numbers a hand-written test picks:
    // every id must list, cancel, list again and sell like any other. Ids 0 and 1 are
    // excluded only because the fixture already minted them
    function testFuzz_TokenId_ListsBuysAndCancelsWhateverTheId(uint256 rawTokenId)
        public
    {
        uint256 tokenId = _bound(rawTokenId, 2, type(uint256).max);

        nft.mint(seller, tokenId);

        _list(tokenId, PRICE);
        assertEq(marketplace.getListing(address(nft), tokenId).price, PRICE);

        vm.prank(seller);
        marketplace.cancelListing(address(nft), tokenId);
        assertEq(marketplace.getListing(address(nft), tokenId).price, 0);
        assertEq(marketplace.getListing(address(nft), tokenId).seller, address(0));

        _list(tokenId, PRICE);

        vm.prank(buyer);
        marketplace.buyListing{value: PRICE}(address(nft), tokenId);

        assertEq(nft.ownerOf(tokenId), buyer);
        assertEq(marketplace.getProceeds(seller), PRICE);
        assertEq(marketplace.getListing(address(nft), tokenId).price, 0);
    }

    // The same id in two collections, at two unrelated prices, over the whole id space:
    // buying one must never disturb the other's price, seller or token
    function testFuzz_SameTokenId_InTwoCollectionsStaysIndependent(
        uint256 rawTokenId,
        uint96 rawPriceA,
        uint96 rawPriceB
    ) public {
        uint256 tokenId = _bound(rawTokenId, 2, type(uint256).max);
        uint256 priceA = _bound(uint256(rawPriceA), 1, 10 ether);
        uint256 priceB = _bound(uint256(rawPriceB), 1, 10 ether);

        MockNft second = new MockNft();
        nft.mint(seller, tokenId);
        second.mint(stranger, tokenId);

        _list(tokenId, priceA);
        _listAs(second, stranger, tokenId, priceB);

        vm.deal(buyer, priceB);
        vm.prank(buyer);
        marketplace.buyListing{value: priceB}(address(second), tokenId);

        assertEq(second.ownerOf(tokenId), buyer);
        assertEq(marketplace.getProceeds(stranger), priceB);

        // The twin listing is untouched: same id, different collection, different row
        assertEq(marketplace.getListing(address(second), tokenId).price, 0);
        assertEq(marketplace.getListing(address(nft), tokenId).price, priceA);
        assertEq(marketplace.getListing(address(nft), tokenId).seller, seller);
        assertEq(nft.ownerOf(tokenId), seller);
        assertEq(marketplace.getProceeds(seller), 0);
    }
}
