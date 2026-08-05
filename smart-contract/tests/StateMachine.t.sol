// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// ---------------------------------------------------------------------------------------
//  [*] State-machine tests — a listing is either absent or live, and never both
//
//  Every marketplace bug that is not about money is about a transition that should not
//  have been possible: buying something already bought, cancelling a cancel, repricing a
//  sale that is over. The listing mapping IS the state machine — a price of 0 means
//  absent, anything else means live — so both ways out of the live state must be one-way
//  and must leave nothing behind for the next lifecycle to trip over.
//
//  Covers:
//    - buy, cancel and update attempted after the listing is already gone
//    - one token cannot be sold twice, and one sale cannot pay the seller twice
//    - who may re-list after a sale (the new owner) and who may not (the old seller)
//    - the stale listing a new owner inherits, and the cancel-first route out of it
//    - a cancelled or bought listing leaves neither a price nor a seller behind
//    - listings of other tokens and other collections are never touched
//    - repeated resale round trips keep the proceeds ledger exact to the wei
// ---------------------------------------------------------------------------------------

import {MarketplaceTestBase} from "./base/MarketplaceTestBase.sol";
import {MockNft} from "./mocks/MockNft.sol";
import {
    NftMarketplace,
    NftMarketplace__AlreadyListed,
    NftMarketplace__ListingStale,
    NftMarketplace__NotListed,
    NftMarketplace__NotOwner,
    NftMarketplace__PriceNotMet
} from "../src/NftMarketplace.sol";

contract StateMachineTest is MarketplaceTestBase {

    uint256 private constant HIGHER_PRICE = 3 ether;
    uint256 private constant RESALE_ROUNDS = 3;


    // The fixture's _list always acts as the seller, but a lifecycle that changes hands
    // needs the same two steps performed by whoever holds the token now
    function _listAs(address holder, uint256 tokenId, uint256 price) private {
        vm.startPrank(holder);
        nft.approve(address(marketplace), tokenId);
        marketplace.listItem(address(nft), tokenId, price);
        vm.stopPrank();
    }

    // Every "the listing is gone" claim checks BOTH fields: a price of 0 alone would
    // still leave a seller address behind for anything that reads the struct
    function _assertNoListing(address nftAddress, uint256 tokenId) private {
        NftMarketplace.Listing memory listing =
            marketplace.getListing(nftAddress, tokenId);
        assertEq(listing.price, 0, "a price survived the transition");
        assertEq(listing.seller, address(0), "a seller survived the transition");
    }

    // The named error is asserted rather than a bare revert, so a test cannot pass on the
    // wrong refusal — NotOwner instead of NotListed would be a different bug entirely
    function _expectNotListed(uint256 tokenId) private {
        vm.expectRevert(
            abi.encodeWithSelector(
                NftMarketplace__NotListed.selector, address(nft), tokenId
            )
        );
    }


    // A cancelled listing must be unreachable, and the refusal has to bounce the money
    // with it — ETH accepted for a listing that no longer exists would be stranded
    function test_BuyAfterCancel_IsRefused() public {
        _list(TOKEN_ID, PRICE);

        vm.prank(seller);
        marketplace.cancelListing(address(nft), TOKEN_ID);

        uint256 buyerBefore = buyer.balance;

        _expectNotListed(TOKEN_ID);
        vm.prank(buyer);
        marketplace.buyListing{value: PRICE}(address(nft), TOKEN_ID);

        assertEq(buyer.balance, buyerBefore, "the buyer paid for a dead listing");
        assertEq(marketplace.getProceeds(seller), 0);
        assertEq(address(marketplace).balance, 0);
        assertEq(nft.ownerOf(TOKEN_ID), seller);
    }

    // Cancelling twice must not fire a second ItemCanceled: the indexer would record a
    // withdrawal from the market for a listing that had already left it
    function test_CancelAfterCancel_IsRefused() public {
        _list(TOKEN_ID, PRICE);

        vm.prank(seller);
        marketplace.cancelListing(address(nft), TOKEN_ID);

        _expectNotListed(TOKEN_ID);
        vm.prank(seller);
        marketplace.cancelListing(address(nft), TOKEN_ID);

        _assertNoListing(address(nft), TOKEN_ID);
    }

    // A sale is the other exit from the live state, so afterwards there is nothing left
    // to cancel — for the old seller or for the new owner. An ItemCanceled emitted here
    // would tell the indexer to retire a listing the sale had already retired
    function test_CancelAfterBuy_IsRefusedForEveryone() public {
        _list(TOKEN_ID, PRICE);

        vm.prank(buyer);
        marketplace.buyListing{value: PRICE}(address(nft), TOKEN_ID);

        _expectNotListed(TOKEN_ID);
        vm.prank(seller);
        marketplace.cancelListing(address(nft), TOKEN_ID);

        _expectNotListed(TOKEN_ID);
        vm.prank(buyer);
        marketplace.cancelListing(address(nft), TOKEN_ID);
    }

    // Repricing a finished sale must be impossible from either side — an ItemUpdated
    // after an ItemBought would put the token back on the market without an owner's say
    function test_UpdateAfterBuy_IsRefusedForEveryone() public {
        _list(TOKEN_ID, PRICE);

        vm.prank(buyer);
        marketplace.buyListing{value: PRICE}(address(nft), TOKEN_ID);

        _expectNotListed(TOKEN_ID);
        vm.prank(seller);
        marketplace.updateListing(address(nft), TOKEN_ID, HIGHER_PRICE);

        _expectNotListed(TOKEN_ID);
        vm.prank(buyer);
        marketplace.updateListing(address(nft), TOKEN_ID, HIGHER_PRICE);

        _assertNoListing(address(nft), TOKEN_ID);
    }

    // Cancel has to be final for updates too, or a reprice would quietly recreate the
    // listing its owner had deliberately withdrawn — the 2024 contract did exactly that
    function test_UpdateAfterCancel_IsRefused() public {
        _list(TOKEN_ID, PRICE);

        vm.prank(seller);
        marketplace.cancelListing(address(nft), TOKEN_ID);

        _expectNotListed(TOKEN_ID);
        vm.prank(seller);
        marketplace.updateListing(address(nft), TOKEN_ID, HIGHER_PRICE);

        _assertNoListing(address(nft), TOKEN_ID);
    }

    // The most expensive failure this state machine could have: one token sold twice. The
    // second attempt must be refused whoever makes it, and must book nothing
    function test_BuyTwice_IsRefusedAndPaysTheSellerOnce() public {
        _list(TOKEN_ID, PRICE);
        vm.deal(stranger, 10 ether);

        uint256 buyerBefore = buyer.balance;

        vm.prank(buyer);
        marketplace.buyListing{value: PRICE}(address(nft), TOKEN_ID);

        _expectNotListed(TOKEN_ID);
        vm.prank(buyer);
        marketplace.buyListing{value: PRICE}(address(nft), TOKEN_ID);

        // Not by a second buyer either — the refusal is a property of the listing, not of
        // who is asking
        _expectNotListed(TOKEN_ID);
        vm.prank(stranger);
        marketplace.buyListing{value: PRICE}(address(nft), TOKEN_ID);

        assertEq(marketplace.getProceeds(seller), PRICE, "the seller was paid twice");
        assertEq(address(marketplace).balance, PRICE, "the marketplace holds too much");
        assertEq(buyer.balance, buyerBefore - PRICE, "the buyer paid twice");
        assertEq(stranger.balance, 10 ether, "the second buyer paid for nothing");
        assertEq(nft.ownerOf(TOKEN_ID), buyer);
    }

    // Selling ends the old seller's claim completely: the listing is consumed, so the
    // only thing between them and selling the same token again is the ownership check
    function test_OldSellerCannotRelistTheTokenTheySold() public {
        _list(TOKEN_ID, PRICE);

        vm.prank(buyer);
        marketplace.buyListing{value: PRICE}(address(nft), TOKEN_ID);

        vm.expectRevert(NftMarketplace__NotOwner.selector);
        vm.prank(seller);
        marketplace.listItem(address(nft), TOKEN_ID, HIGHER_PRICE);

        _assertNoListing(address(nft), TOKEN_ID);
        assertEq(marketplace.getProceeds(seller), PRICE, "a second sale was booked");
    }

    // The lifecycle must not trap a token: whoever just bought it is an ordinary owner
    // and can put it straight back on the market, at their own price and in their name
    function test_BuyerCanRelistTheTokenTheyJustBought() public {
        _list(TOKEN_ID, PRICE);

        vm.prank(buyer);
        marketplace.buyListing{value: PRICE}(address(nft), TOKEN_ID);

        _listAs(buyer, TOKEN_ID, HIGHER_PRICE);

        NftMarketplace.Listing memory listing =
            marketplace.getListing(address(nft), TOKEN_ID);
        assertEq(listing.price, HIGHER_PRICE);
        assertEq(listing.seller, buyer, "the resale would pay the previous owner");

        // And the resale completes, crediting the second seller without disturbing what
        // the first one is still owed
        vm.deal(stranger, 10 ether);
        vm.prank(stranger);
        marketplace.buyListing{value: HIGHER_PRICE}(address(nft), TOKEN_ID);

        assertEq(nft.ownerOf(TOKEN_ID), stranger);
        assertEq(marketplace.getProceeds(buyer), HIGHER_PRICE);
        assertEq(marketplace.getProceeds(seller), PRICE);
    }

    // A token that changes hands while listed arrives with the previous owner's listing
    // still attached, and listing is refused until it is cleared. That is friction, not a
    // trap: cancel is guarded by CURRENT ownership, so the way out needs nobody's help
    function test_NewOwnerMustCancelTheInheritedListingBeforeListing() public {
        _list(TOKEN_ID, PRICE);

        vm.prank(seller);
        nft.transferFrom(seller, stranger, TOKEN_ID);

        vm.prank(stranger);
        nft.approve(address(marketplace), TOKEN_ID);

        vm.expectRevert(
            abi.encodeWithSelector(
                NftMarketplace__AlreadyListed.selector, address(nft), TOKEN_ID
            )
        );
        vm.prank(stranger);
        marketplace.listItem(address(nft), TOKEN_ID, HIGHER_PRICE);

        // The escape hatch, taken alone and in one extra transaction
        vm.prank(stranger);
        marketplace.cancelListing(address(nft), TOKEN_ID);

        vm.prank(stranger);
        marketplace.listItem(address(nft), TOKEN_ID, HIGHER_PRICE);

        NftMarketplace.Listing memory listing =
            marketplace.getListing(address(nft), TOKEN_ID);
        assertEq(listing.price, HIGHER_PRICE);
        assertEq(listing.seller, stranger, "the inherited seller survived the re-list");
    }

    // Re-listing after a cancel must start from nothing: a listing that kept the old
    // price would sell too cheaply, one that kept the old seller would pay the wrong
    // wallet, so both fields are checked against a lifecycle that changed both
    function test_RelistAfterCancel_StartsClean() public {
        _list(TOKEN_ID, PRICE);

        vm.prank(seller);
        marketplace.cancelListing(address(nft), TOKEN_ID);

        vm.prank(seller);
        nft.transferFrom(seller, buyer, TOKEN_ID);

        vm.prank(buyer);
        nft.approve(address(marketplace), TOKEN_ID);

        // A brand-new listing announces ItemListed, never ItemUpdated — the indexer
        // treats the two differently and a re-list is genuinely new
        vm.expectEmit(true, true, true, true);
        emit ItemListed(buyer, address(nft), TOKEN_ID, HIGHER_PRICE);

        vm.prank(buyer);
        marketplace.listItem(address(nft), TOKEN_ID, HIGHER_PRICE);

        NftMarketplace.Listing memory listing =
            marketplace.getListing(address(nft), TOKEN_ID);
        assertEq(listing.price, HIGHER_PRICE, "the cancelled price came back");
        assertEq(listing.seller, buyer, "the cancelled seller came back");
    }

    // Whatever the two prices are, the cancelled one must die with the cancel: a buyer
    // still holding the previously advertised price must not be able to take the token
    function testFuzz_RelistAfterCancel_OnlyTheNewPriceBuysIt(
        uint96 rawFirstPrice,
        uint96 rawSecondPrice
    ) public {
        uint256 firstPrice = _bound(uint256(rawFirstPrice), 1, 50 ether);
        uint256 secondPrice = _bound(uint256(rawSecondPrice), 1, 50 ether);
        vm.assume(firstPrice != secondPrice);

        _list(TOKEN_ID, firstPrice);

        vm.prank(seller);
        marketplace.cancelListing(address(nft), TOKEN_ID);

        _list(TOKEN_ID, secondPrice);

        vm.expectRevert(
            abi.encodeWithSelector(
                NftMarketplace__PriceNotMet.selector,
                address(nft),
                TOKEN_ID,
                secondPrice
            )
        );
        vm.prank(buyer);
        marketplace.buyListing{value: firstPrice}(address(nft), TOKEN_ID);

        vm.prank(buyer);
        marketplace.buyListing{value: secondPrice}(address(nft), TOKEN_ID);

        assertEq(marketplace.getProceeds(seller), secondPrice);
    }

    // PROPERTY: a cancel erases the seller as well as the price. Half an entry left in
    // the slot is what lets a later transition pay a party who is no longer involved
    function test_CancelLeavesNoResidue() public {
        _list(TOKEN_ID, PRICE);

        vm.prank(seller);
        marketplace.cancelListing(address(nft), TOKEN_ID);

        _assertNoListing(address(nft), TOKEN_ID);
    }

    // The same demand on the other exit: after a completed sale the slot must be as empty
    // as it was before the token was ever listed, with the proceeds the only trace left
    function test_BuyLeavesNoResidue() public {
        _list(TOKEN_ID, PRICE);

        vm.prank(buyer);
        marketplace.buyListing{value: PRICE}(address(nft), TOKEN_ID);

        _assertNoListing(address(nft), TOKEN_ID);
        assertEq(marketplace.getProceeds(seller), PRICE);
    }

    // Selling a token back and forth is the longest legal path through the machine. Each
    // round must consume its own listing and credit its own seller, so nothing can be
    // inherited from the round before it — including the money
    function test_RepeatedResale_KeepsTheLedgerExact() public {
        vm.deal(seller, 10 ether);

        uint256 sellerStart = seller.balance;
        uint256 buyerStart = buyer.balance;

        address holder = seller;
        uint256 sellerEarned;
        uint256 buyerEarned;
        uint256 sellerSpent;
        uint256 buyerSpent;

        for (uint256 round = 1; round <= RESALE_ROUNDS; round++) {
            address counterparty = holder == seller ? buyer : seller;
            uint256 price = round * 1 ether;

            _listAs(holder, TOKEN_ID, price);

            vm.prank(counterparty);
            marketplace.buyListing{value: price}(address(nft), TOKEN_ID);

            if (holder == seller) {
                sellerEarned += price;
                buyerSpent += price;
            } else {
                buyerEarned += price;
                sellerSpent += price;
            }

            // The next round cannot even begin unless this one closed cleanly
            _assertNoListing(address(nft), TOKEN_ID);
            assertEq(nft.ownerOf(TOKEN_ID), counterparty);

            holder = counterparty;
        }

        assertEq(marketplace.getProceeds(seller), sellerEarned);
        assertEq(marketplace.getProceeds(buyer), buyerEarned);
        assertEq(address(marketplace).balance, sellerEarned + buyerEarned);

        vm.prank(seller);
        marketplace.withdrawProceeds();
        vm.prank(buyer);
        marketplace.withdrawProceeds();

        // Every wei of the round trip is accounted for on both sides, and none of it is
        // left over in the marketplace
        assertEq(seller.balance, sellerStart - sellerSpent + sellerEarned);
        assertEq(buyer.balance, buyerStart - buyerSpent + buyerEarned);
        assertEq(address(marketplace).balance, 0);
    }

    // The state machine is per token: ending one token's listing must not disturb another
    // token's, whether the ending is a cancel or a sale
    function test_EndingOneListingLeavesTheOtherAlone() public {
        _list(TOKEN_ID, PRICE);
        _list(OTHER_TOKEN_ID, HIGHER_PRICE);

        vm.prank(seller);
        marketplace.cancelListing(address(nft), TOKEN_ID);

        NftMarketplace.Listing memory survivor =
            marketplace.getListing(address(nft), OTHER_TOKEN_ID);
        assertEq(survivor.price, HIGHER_PRICE, "a cancel reached the wrong token");
        assertEq(survivor.seller, seller);

        vm.prank(buyer);
        marketplace.buyListing{value: HIGHER_PRICE}(address(nft), OTHER_TOKEN_ID);

        // The sale of one must not revive the cancelled other
        _assertNoListing(address(nft), TOKEN_ID);
        _assertNoListing(address(nft), OTHER_TOKEN_ID);
        assertEq(marketplace.getProceeds(seller), HIGHER_PRICE);
    }

    // Listings are keyed by collection AND token, so the same tokenId in a second
    // collection is a separate machine — every collection starts numbering at 0, which
    // makes a key collision here silently plausible rather than obviously wrong
    function test_SameTokenIdInAnotherCollectionIsASeparateListing() public {
        MockNft other = new MockNft();
        other.mint(seller, TOKEN_ID);

        _list(TOKEN_ID, PRICE);

        vm.startPrank(seller);
        other.approve(address(marketplace), TOKEN_ID);
        marketplace.listItem(address(other), TOKEN_ID, HIGHER_PRICE);
        marketplace.cancelListing(address(other), TOKEN_ID);
        vm.stopPrank();

        NftMarketplace.Listing memory listing =
            marketplace.getListing(address(nft), TOKEN_ID);
        assertEq(listing.price, PRICE, "another collection's cancel reached this one");
        assertEq(listing.seller, seller);
        _assertNoListing(address(other), TOKEN_ID);
    }

    // PROPERTY: a listing that outlives a round trip of its token may only ever pay the
    // party that actually gives the token up. Worth knowing for the asymmetry it
    // documents: a single-token approve() is cleared by the transfer, so only
    // setApprovalForAll can bring a listing back to life this way
    function test_ListingSurvivingARoundTripPaysOnlyTheCurrentOwner() public {
        vm.startPrank(seller);
        nft.setApprovalForAll(address(marketplace), true);
        marketplace.listItem(address(nft), TOKEN_ID, PRICE);
        nft.transferFrom(seller, stranger, TOKEN_ID);
        vm.stopPrank();

        // While the token is away the listing is unbuyable, whatever it still says
        vm.expectRevert(
            abi.encodeWithSelector(
                NftMarketplace__ListingStale.selector, address(nft), TOKEN_ID
            )
        );
        vm.prank(buyer);
        marketplace.buyListing{value: PRICE}(address(nft), TOKEN_ID);

        vm.prank(stranger);
        nft.transferFrom(stranger, seller, TOKEN_ID);

        uint256 sellerProceedsBefore = marketplace.getProceeds(seller);
        uint256 buyerBefore = buyer.balance;

        vm.prank(buyer);
        try marketplace.buyListing{value: PRICE}(address(nft), TOKEN_ID) {
            assertEq(nft.ownerOf(TOKEN_ID), buyer, "the buyer paid for nothing");
            assertEq(
                marketplace.getProceeds(seller),
                sellerProceedsBefore + PRICE,
                "the money went to someone who gave up nothing"
            );
        } catch {
            // Refusing a listing whose token left and came back is equally acceptable —
            // then nothing may have moved at all
            assertEq(buyer.balance, buyerBefore);
            assertEq(nft.ownerOf(TOKEN_ID), seller);
        }
    }

    // FIXED: a listing whose token has moved to an address that can never call
    // cancelListing — the marketplace itself here, a vault, a bridge or a burn address in
    // the wild — used to be both unbuyable and unremovable, advertised for ever with
    // every buyer paying gas for a guaranteed revert. A cancel is now permissionless once
    // the listing is PROVABLY stale (ownerOf != seller), which takes nothing from anyone:
    // such a listing could never complete again anyway.
    function test_ProvablyStaleListingCanBeRetiredByAnyone() public {
        _list(TOKEN_ID, PRICE);

        vm.prank(seller);
        nft.transferFrom(seller, address(marketplace), TOKEN_ID);

        vm.expectRevert(
            abi.encodeWithSelector(
                NftMarketplace__ListingStale.selector, address(nft), TOKEN_ID
            )
        );
        vm.prank(buyer);
        marketplace.buyListing{value: PRICE}(address(nft), TOKEN_ID);

        // Nobody owns it who could ever call this, so somebody else must be allowed to —
        // and a passer-by is the harder half to get right, so it is the one asserted here
        vm.prank(stranger);
        marketplace.cancelListing(address(nft), TOKEN_ID);

        _assertNoListing(address(nft), TOKEN_ID);
    }
}
